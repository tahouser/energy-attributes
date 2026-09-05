"""Sensors for Energy Attribution."""

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
    """Set up Energy Attribution sensors."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([WholeHomePowerSensor(coordinator, entry.entry_id)])


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
