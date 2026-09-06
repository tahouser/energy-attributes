"""Coordinator for Energy Attribution."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY


class EnergyAttributionCoordinator(DataUpdateCoordinator[dict]):
    """Collect the current whole-home and selected-entity state."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.entry = entry
        self.power_entity = entry.data[CONF_POWER_ENTITY]
        self.monitored_entities = entry.data.get(CONF_MONITORED_ENTITIES, [])
        self.device_classifications = entry.data.get("device_classifications", {})
        self.commissioned_devices = entry.data.get("commissioned_devices", {})
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name="energy_attribution",
            update_interval=timedelta(seconds=5),
        )

    async def _async_update_data(self) -> dict:
        """Read current HA states."""
        states = self.hass.states
        whole = states.get(self.power_entity)
        whole_power = None
        if whole is not None:
            try:
                whole_power = float(whole.state)
            except (TypeError, ValueError):
                pass

        return {
            "whole_home_power": whole_power,
            "entities": {
                entity_id: states.get(entity_id)
                for entity_id in self.monitored_entities
                if states.get(entity_id) is not None
            },
        }
