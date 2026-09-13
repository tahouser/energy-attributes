"""Config flow for the EnergyIQ measurement instrument."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from aiohttp import ClientError
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_HOST, DOMAIN


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure the physical electrical measurement source."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Ask for the Shelly address and verify its monophase EM1 channels."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input["host"].strip()
            try:
                status = await self._read_status(host)
            except (ClientError, TimeoutError):
                errors["base"] = "cannot_connect"
            except ValueError:
                errors["base"] = "invalid_device"
            else:
                sys_status = status.get("sys", {})
                device_id = sys_status.get("mac") or host
                await self.async_set_unique_id(str(device_id))
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"EnergyIQ · Shelly {host}",
                    data={"host": host},
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required("host", default=DEFAULT_HOST): str}
            ),
            errors=errors,
        )

    async def _read_status(self, host: str) -> dict[str, Any]:
        """Verify the Shelly exposes all three monophase EM1 channels."""
        session = async_get_clientsession(self.hass)
        async with session.get(
            f"http://{host}/rpc/Shelly.GetStatus", timeout=2.0
        ) as response:
            response.raise_for_status()
            payload = await response.json(content_type=None)
        if not isinstance(payload, dict):
            raise ValueError("Shelly.GetStatus did not return an object")

        for channel in range(3):
            item = payload.get(f"em1:{channel}")
            if not isinstance(item, dict) or item.get("act_power") is None:
                raise ValueError(f"Missing em1:{channel} active power")
        return payload
