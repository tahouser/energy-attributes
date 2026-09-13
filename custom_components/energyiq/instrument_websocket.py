"""Live websocket API for the EnergyIQ instrument."""
from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import callback

from . import DOMAIN


def async_register(hass) -> None:
    websocket_api.async_register_command(hass, ws_snapshot)
    websocket_api.async_register_command(hass, ws_subscribe)


def _coordinator(hass):
    return next((v for v in hass.data.get(DOMAIN, {}).values() if hasattr(v, "data") and hasattr(v, "power_entity")), None)


@websocket_api.websocket_command({"type": "energyiq/snapshot"})
@websocket_api.async_response
async def ws_snapshot(hass, connection, msg):
    coordinator = _coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "EnergyIQ is not configured")
        return
    connection.send_result(msg["id"], coordinator.data or {})


@websocket_api.websocket_command({"type": "energyiq/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass, connection, msg):
    coordinator = _coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "EnergyIQ is not configured")
        return

    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], coordinator.data or {}))

    remove = coordinator.async_add_listener(forward)
    connection.subscriptions[msg["id"]] = remove
    connection.send_result(msg["id"], {"subscribed": True})
