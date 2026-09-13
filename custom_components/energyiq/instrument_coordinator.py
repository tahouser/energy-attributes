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

from .const import CONF_HOST, DEFAULT_HOST, EM_ID

_LOGGER = logging.getLogger(__name__)
ACQUISITION_INTERVAL = 0.25
REQUEST_TIMEOUT = 0.8


class InstrumentCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Acquire the Shelly Energy Meter directly and continuously."""

    def __init__(self, hass, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.host = str(entry.data.get(CONF_HOST, DEFAULT_HOST)).strip()
        self.em_id = int(entry.data.get("em_id", EM_ID))
        self.samples: deque[tuple[float, float]] = deque(maxlen=600)
        self.intervals: deque[float] = deque(maxlen=300)
        self._last_sample_time: float | None = None
        self._last_value: float | None = None
        self._live_value: float | None = None
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
        url = f"http://{self.host}/rpc/EM.GetStatus?id={self.em_id}"
        try:
            async with self._session.get(url, timeout=REQUEST_TIMEOUT) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except Exception as err:
            self._record_error(str(err))
            self.async_set_updated_data(self._snapshot())
            return

        latency_ms = (time.monotonic() - started) * 1000.0
        value = self._extract_total_power(payload)
        if value is None:
            self._record_error("Shelly response did not contain total_act_power")
            self.async_set_updated_data(self._snapshot())
            return

        now = time.monotonic()
        if self._last_sample_time is not None:
            self.intervals.append(now - self._last_sample_time)
        self._last_sample_time = now
        self._live_value = value
        self.samples.append((now, value))
        self._source_updates += 1
        self._last_success_time = now
        self._last_latency_ms = latency_ms
        self._last_error = None

        if self._last_value is not None and value == self._last_value:
            self._duplicate_updates += 1
        else:
            self._new_value_updates += 1
        self._last_value = value
        self.async_set_updated_data(self._snapshot())

    def _record_error(self, message: str) -> None:
        self._request_errors += 1
        self._last_error = message

    @staticmethod
    def _extract_total_power(payload: Any) -> float | None:
        if not isinstance(payload, dict):
            return None
        value = payload.get("total_act_power")
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if number == number else None

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
