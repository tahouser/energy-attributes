"""Sensors for EnergyIQ."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.const import UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import EnergyAttributionCoordinator
from .const import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up EnergyIQ sensors."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([WholeHomePowerSensor(coordinator, entry.entry_id), TrainingStatusSensor(coordinator)])


class WholeHomePowerSensor(CoordinatorEntity[EnergyAttributionCoordinator], SensorEntity):
    """Expose the selected whole-home power reading."""

    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_icon = "mdi:flash"

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry_id}_whole_home_power"
        self._attr_name = "Whole Home Power"

    @property
    def native_value(self):
        """Return the current whole-home power."""
        return self.coordinator.data.get("whole_home_power")


class TrainingStatusSensor(SensorEntity):
    """Expose the persistent EnergyIQ training state."""

    _attr_name = "EnergyIQ Training"
    _attr_icon = "mdi:school"

    def __init__(self, coordinator):
        self.coordinator = coordinator
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_training"

    @property
    def native_value(self):
        states = self.coordinator.training_state or {}
        active = [
            s for s in states.values()
            if s.get("status") in {"armed", "active"}
        ]
        if active:
            return "active"
        complete = [
            s for s in states.values()
            if s.get("status") == "complete"
        ]
        return "complete" if complete else "idle"

    @property
    def extra_state_attributes(self):
        return {"training": self.coordinator.training_state or {}}

    async def async_added_to_hass(self):
        self.async_on_remove(
            self.coordinator.async_add_listener(self.async_write_ha_state)
        )
