"""High-rate whole-home measurement coordinator for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import deque
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_POWER_ENTITY

_LOGGER = logging.getLogger(__name__)
SHELLY_HOST = "192.168.1.251"
POLL_INTERVAL = 0.25


class InstrumentCoordinator(DataUpdateCoordinator[dict]):
    """Acquire whole-home power directly from the Shelly at 4 Hz."""

    def __init__(self, hass, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.power_entity = entry.options.get(CONF_POWER_ENTITY, entry.data.get(CONF_POWER_ENTITY, "sensor.power"))
        self.samples: deque[tuple[float, float]] = deque(maxlen=600)
        self.sample_intervals: deque[float] = deque(maxlen=300)
        self._last_sample_time = None
        self._last_source_value = None
        self._live_value = None
        self._source_updates = 0
        self._duplicate_updates = 0
        self._poll_task = None
        self._last_error = None
        self._session = async_get_clientsession(hass)
        super().__init__(hass, logger=_LOGGER, name="energyiq_instrument", update_interval=timedelta(seconds=60))

    async def async_config_entry_first_refresh(self) -> None:
        await self._poll_once()
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
                self._last_error = str(err)
                _LOGGER.warning("EnergyIQ direct Shelly read failed: %s", err)
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(0.0, POLL_INTERVAL - elapsed))

    async def _poll_once(self) -> None:
        url = f"http://{SHELLY_HOST}/rpc/EM.GetStatus?id=0"
        try:
            async with self._session.get(url, timeout=0.8) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except Exception as err:
            self._last_error = str(err)
            return

        value = self._extract_power(payload)
        if value is None:
            self._last_error = "Shelly response did not contain total_act_power"
            return

        now = time.monotonic()
        self._capture(now, value)
        self._live_value = value
        self._source_updates += 1
        self._last_error = None
        self.async_set_updated_data(self._snapshot())

    @staticmethod
    def _extract_power(payload) -> float | None:
        if not isinstance(payload, dict):
            return None
        value = payload.get("total_act_power")
        if value is None:
            value = payload.get("act_power")
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if number == number else None

    def _capture(self, now: float, watts: float) -> None:
        if self._last_sample_time is not None:
            self.sample_intervals.append(now - self._last_sample_time)
        if self._last_source_value is not None and watts == self._last_source_value:
            self._duplicate_updates += 1
        self._last_sample_time = now
        self._last_source_value = watts
        self.samples.append((now, watts))

    def _snapshot(self) -> dict:
        values = [v for _, v in self.samples]
        intervals = list(self.sample_intervals)
        return {
            "power_w": self._live_value,
            "source_entity": self.power_entity,
            "source": f"Shelly {SHELLY_HOST}",
            "acquisition": "direct_rpc",
            "sample_count": len(self.samples),
            "source_updates": self._source_updates,
            "duplicate_updates": self._duplicate_updates,
            "sample_rate_hz": 1.0 / statistics.median(intervals) if intervals else None,
            "sample_interval_ms": statistics.median(intervals) * 1000.0 if intervals else None,
            "min_w": min(values) if values else None,
            "max_w": max(values) if values else None,
            "avg_w": statistics.fmean(values) if values else None,
            "error": self._last_error,
        }

    async def async_shutdown(self) -> None:
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
