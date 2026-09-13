"""Config flow for the EnergyIQ measurement instrument."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from aiohttp import ClientError
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_HOST, DOMAIN, EM_ID


class EnergyIQConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure the physical electrical measurement source."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Ask for the Shelly address, never an HA power entity."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input["host"].strip()
            try:
                status = await self._read_status(host)
            except (ClientError, TimeoutError, ValueError):
                errors["base"] = "cannot_connect"
            else:
                device_id = status.get("src") or status.get("mac") or host
                await self.async_set_unique_id(str(device_id))
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"EnergyIQ · Shelly {host}",
                    data={"host": host, "em_id": EM_ID},
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required("host", default=DEFAULT_HOST): str}
            ),
            errors=errors,
        )

    async def _read_status(self, host: str) -> dict[str, Any]:
        """Verify that the address exposes an Energy Meter total."""
        session = async_get_clientsession(self.hass)
        async with session.get(
            f"http://{host}/rpc/EM.GetStatus?id={EM_ID}", timeout=2.0
        ) as response:
            response.raise_for_status()
            payload = await response.json(content_type=None)
        if not isinstance(payload, dict) or payload.get("total_act_power") is None:
            raise ValueError("Energy Meter response did not contain total_act_power")
        return payload
