"""Config flow for Energy Attribution."""

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import CONF_MONITORED_ENTITIES, CONF_POWER_ENTITY, DOMAIN


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle configuration of Energy Attribution."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Select the whole-home power entity."""
        if user_input is not None:
            self._power_entity = user_input[CONF_POWER_ENTITY]
            return await self.async_step_entities()

        schema = vol.Schema(
            {
                vol.Required(CONF_POWER_ENTITY): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="sensor",
                        device_class="power",
                        multiple=False,
                    )
                )
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_entities(self, user_input=None):
        """Select HA entities that can participate in attribution."""
        if user_input is not None:
            return self.async_create_entry(
                title="Energy Attribution",
                data={
                    CONF_POWER_ENTITY: self._power_entity,
                    CONF_MONITORED_ENTITIES: user_input.get(CONF_MONITORED_ENTITIES, []),
                },
            )

        schema = vol.Schema(
            {
                vol.Optional(CONF_MONITORED_ENTITIES, default=[]): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain=[
                            "switch",
                            "light",
                            "fan",
                            "climate",
                            "humidifier",
                            "cover",
                            "media_player",
                            "binary_sensor",
                            "input_boolean",
                        ],
                        multiple=True,
                    )
                )
            }
        )
        return self.async_show_form(step_id="entities", data_schema=schema)
