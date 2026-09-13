"""High-rate whole-home measurement coordinator for EnergyIQ."""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections import deque
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_POWER_ENTITY

_LOGGER = logging.getLogger(__name__)


class InstrumentCoordinator(DataUpdateCoordinator[dict]):
    """Capture pushed HA measurements without tying acquisition to UI polling."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.power_entity = entry.options.get(CONF_POWER_ENTITY, entry.data[CONF_POWER_ENTITY])
        self.samples: deque[tuple[float, float]] = deque(maxlen=600)
        self.sample_intervals: deque[float] = deque(maxlen=300)
        self._last_sample_time: float | None = None
        self._last_source_value: float | None = None
        self._unsub_state = None
        self._publish_task: asyncio.Task | None = None
        self._last_publish = 0.0
        self._live_value: float | None = None
        self._source_updates = 0
        self._duplicate_updates = 0
        super().__init__(hass, logger=_LOGGER, name="energyiq_instrument", update_interval=timedelta(seconds=60))

    async def async_config_entry_first_refresh(self) -> None:
        await super().async_config_entry_first_refresh()
        self._unsub_state = async_track_state_change_event(self.hass, [self.power_entity], self._state_changed)

    async def _async_update_data(self) -> dict:
        state = self.hass.states.get(self.power_entity)
        if state is None:
            raise UpdateFailed("Whole-home power entity is unavailable")
        value = self._to_watts(state.state, state.attributes.get("unit_of_measurement"))
        if value is None:
            raise UpdateFailed("Whole-home power entity is not a numeric power sensor")
        self._capture(time.monotonic(), value)
        self._live_value = value
        return self._snapshot()

    @callback
    def _state_changed(self, event) -> None:
        new_state = event.data.get("new_state")
        if new_state is None:
            return
        value = self._to_watts(new_state.state, new_state.attributes.get("unit_of_measurement"))
        if value is None:
            return
        self._capture(time.monotonic(), value)
        self._live_value = value
        self._source_updates += 1
        self._publish_task = self.hass.async_create_task(self._publish_live())

    def _capture(self, now: float, watts: float) -> None:
        if self._last_sample_time is not None:
            self.sample_intervals.append(now - self._last_sample_time)
        if self._last_source_value is not None and watts == self._last_source_value:
            self._duplicate_updates += 1
        self._last_sample_time = now
        self._last_source_value = watts
        self.samples.append((now, watts))

    async def _publish_live(self) -> None:
        now = time.monotonic()
        wait = max(0.0, 0.05 - (now - self._last_publish))
        if wait:
            await asyncio.sleep(wait)
        self._last_publish = time.monotonic()
        self.async_set_updated_data(self._snapshot())

    def _snapshot(self) -> dict:
        values = [v for _, v in self.samples]
        intervals = list(self.sample_intervals)
        return {
            "power_w": self._live_value,
            "source_entity": self.power_entity,
            "sample_count": len(self.samples),
            "source_updates": self._source_updates,
            "duplicate_updates": self._duplicate_updates,
            "sample_rate_hz": 1.0 / statistics.median(intervals) if intervals else None,
            "sample_interval_ms": statistics.median(intervals) * 1000.0 if intervals else None,
            "min_w": min(values) if values else None,
            "max_w": max(values) if values else None,
            "avg_w": statistics.fmean(values) if values else None,
        }

    @staticmethod
    def _to_watts(value, unit) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if unit and str(unit).casefold() == "kw":
            number *= 1000.0
        return number if number == number else None

    async def async_shutdown(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        if self._publish_task and not self._publish_task.done():
            self._publish_task.cancel()
