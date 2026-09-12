"""Configuration flow for the EnergyIQ Instrument."""
from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.selector import EntitySelector, EntitySelectorConfig

DOMAIN = "energyiq_instrument"


class EnergyIQInstrumentConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            entity_id = user_input["power_entity"]
            state = self.hass.states.get(entity_id)
            if state is None:
                errors["power_entity"] = "entity_not_found"
            else:
                unit = str(state.attributes.get("unit_of_measurement") or "").casefold()
                if state.attributes.get("device_class") != "power" or unit not in {"w", "kw"}:
                    errors["power_entity"] = "not_power_sensor"
                else:
                    await self.async_set_unique_id(f"{DOMAIN}_{entity_id}")
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(
                        title="Total Electrical Load",
                        data={"power_entity": entity_id},
                    )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required("power_entity"): EntitySelector(
                    EntitySelectorConfig(domain="sensor", device_class="power")
                )
            }),
            errors=errors,
        )
