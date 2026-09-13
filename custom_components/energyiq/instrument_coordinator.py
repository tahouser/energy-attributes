"""Direct electrical measurement engine for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import deque
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_HOST, DEFAULT_HOST

_LOGGER = logging.getLogger(__name__)
ACQUISITION_INTERVAL = 0.25
REQUEST_TIMEOUT = 0.8


class InstrumentCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Acquire the Shelly Pro 3EM directly through Shelly.GetStatus."""

    def __init__(self, hass, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.host = str(entry.data.get(CONF_HOST, DEFAULT_HOST)).strip()
        self.samples: deque[tuple[float, float]] = deque(maxlen=600)
        self.intervals: deque[float] = deque(maxlen=300)
        self._last_sample_time: float | None = None
        self._last_value: float | None = None
        self._live_value: float | None = None
        self._phase_power: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._phase_voltage: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._phase_current: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._phase_pf: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._phase_freq: dict[str, float | None] = {"0": None, "1": None, "2": None}
        self._source_updates = 0
        self._new_value_updates = 0
        self._duplicate_updates = 0
        self._request_errors = 0
        self._last_error: str | None = None
        self._last_success_time: float | None = None
        self._last_latency_ms: float | None = None
        self._poll_task: asyncio.Task | None = None
        self._session = async_get_clientsession(hass)
        super().__init__(
            hass,
            logger=_LOGGER,
            name="energyiq_instrument",
            update_interval=timedelta(seconds=60),
        )

    async def async_config_entry_first_refresh(self) -> None:
        """Take an initial direct reading, then start continuous acquisition."""
        await self._poll_once()
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = self.hass.async_create_task(self._poll_loop())
        self.async_set_updated_data(self._snapshot())

    async def _poll_loop(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self._record_error(str(err))
                _LOGGER.exception("EnergyIQ acquisition loop error")
                self.async_set_updated_data(self._snapshot())
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(0.0, ACQUISITION_INTERVAL - elapsed))

    async def _poll_once(self) -> None:
        started = time.monotonic()
        url = f"http://{self.host}/rpc/Shelly.GetStatus"
        try:
            async with self._session.get(url, timeout=REQUEST_TIMEOUT) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except Exception as err:
            self._record_error(str(err))
            self.async_set_updated_data(self._snapshot())
            return

        latency_ms = (time.monotonic() - started) * 1000.0
        readings = self._extract_readings(payload)
        if readings is None:
            self._record_error("Shelly response did not contain all three em1 channels")
            self.async_set_updated_data(self._snapshot())
            return

        total_power, phase_power, phase_voltage, phase_current, phase_pf, phase_freq = readings
        now = time.monotonic()
        if self._last_sample_time is not None:
            self.intervals.append(now - self._last_sample_time)
        self._last_sample_time = now
        self._live_value = total_power
        self._phase_power = phase_power
        self._phase_voltage = phase_voltage
        self._phase_current = phase_current
        self._phase_pf = phase_pf
        self._phase_freq = phase_freq
        self.samples.append((now, total_power))
        self._source_updates += 1
        self._last_success_time = now
        self._last_latency_ms = latency_ms
        self._last_error = None

        if self._last_value is not None and total_power == self._last_value:
            self._duplicate_updates += 1
        else:
            self._new_value_updates += 1
        self._last_value = total_power
        self.async_set_updated_data(self._snapshot())

    def _record_error(self, message: str) -> None:
        self._request_errors += 1
        self._last_error = message

    @staticmethod
    def _number(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if number == number else None

    @classmethod
    def _extract_readings(
        cls, payload: Any
    ) -> tuple[
        float,
        dict[str, float | None],
        dict[str, float | None],
        dict[str, float | None],
        dict[str, float | None],
        dict[str, float | None],
    ] | None:
        if not isinstance(payload, dict):
            return None

        phase_power: dict[str, float | None] = {}
        phase_voltage: dict[str, float | None] = {}
        phase_current: dict[str, float | None] = {}
        phase_pf: dict[str, float | None] = {}
        phase_freq: dict[str, float | None] = {}
        total = 0.0

        for channel in range(3):
            item = payload.get(f"em1:{channel}")
            if not isinstance(item, dict):
                return None
            power = cls._number(item.get("act_power"))
            if power is None:
                return None
            key = str(channel)
            phase_power[key] = power
            phase_voltage[key] = cls._number(item.get("voltage"))
            phase_current[key] = cls._number(item.get("current"))
            phase_pf[key] = cls._number(item.get("pf"))
            phase_freq[key] = cls._number(item.get("freq"))
            total += power

        return total, phase_power, phase_voltage, phase_current, phase_pf, phase_freq

    def _snapshot(self) -> dict[str, Any]:
        values = [value for _, value in self.samples]
        intervals = list(self.intervals)
        now = time.monotonic()
        live = self._last_success_time is not None and (now - self._last_success_time) < 1.5
        return {
            "power_w": self._live_value,
            "source": f"Shelly {self.host}",
            "host": self.host,
            "acquisition": "direct_rpc",
            "status": "LIVE" if live else ("ERROR" if self._last_error else "WAITING"),
            "sample_count": len(self.samples),
            "source_updates": self._source_updates,
            "new_value_updates": self._new_value_updates,
            "duplicate_updates": self._duplicate_updates,
            "request_errors": self._request_errors,
            "sample_rate_hz": 1.0 / statistics.median(intervals) if intervals else None,
            "sample_interval_ms": statistics.median(intervals) * 1000.0 if intervals else None,
            "min_w": min(values) if values else None,
            "max_w": max(values) if values else None,
            "avg_w": statistics.fmean(values) if values else None,
            "request_latency_ms": self._last_latency_ms,
            "phase_power_w": self._phase_power,
            "phase_voltage_v": self._phase_voltage,
            "phase_current_a": self._phase_current,
            "phase_pf": self._phase_pf,
            "phase_frequency_hz": self._phase_freq,
            "error": self._last_error,
        }

    async def async_shutdown(self) -> None:
        """Stop acquisition cleanly."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
