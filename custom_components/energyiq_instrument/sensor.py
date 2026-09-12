"""Sensor entities for the EnergyIQ Instrument."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.const import UnitOfPower
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import DOMAIN
from .coordinator import InstrumentCoordinator


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator: InstrumentCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        InstrumentPowerSensor(coordinator),
        InstrumentStatSensor(coordinator, "sample_rate_hz", "Sample Rate", "Hz"),
        InstrumentStatSensor(coordinator, "sample_interval_ms", "Sample Interval", "ms"),
    ])


class InstrumentPowerSensor(CoordinatorEntity, SensorEntity):
    _attr_name = "Total Electrical Load"
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_icon = "mdi:lightning-bolt"

    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_power"

    @property
    def native_value(self):
        return self.coordinator.data.get("power_w") if self.coordinator.data else None

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data or {}
        return {
            "source_entity": data.get("source_entity"),
            "min_w": data.get("min_w"),
            "max_w": data.get("max_w"),
            "avg_w": data.get("avg_w"),
            "source_updates": data.get("source_updates", 0),
            "duplicate_updates": data.get("duplicate_updates", 0),
        }


class InstrumentStatSensor(CoordinatorEntity, SensorEntity):
    def __init__(self, coordinator, key, name, unit):
        super().__init__(coordinator)
        self.key = key
        self._attr_name = name
        self._attr_native_unit_of_measurement = unit
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{key}"
        self._attr_icon = "mdi:chart-line"

    @property
    def native_value(self):
        return (self.coordinator.data or {}).get(self.key)
