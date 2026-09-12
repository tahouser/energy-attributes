"""WebSocket API for the high-rate instrument display."""
from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import callback

from . import DOMAIN


def async_register(hass) -> None:
    websocket_api.async_register_command(hass, ws_get_snapshot)
    websocket_api.async_register_command(hass, ws_subscribe)


@websocket_api.websocket_command({"type": "energyiq_instrument/snapshot"})
@websocket_api.async_response
async def ws_get_snapshot(hass, connection, msg):
    coordinator = next((v for v in hass.data.get(DOMAIN, {}).values() if hasattr(v, "data")), None)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Instrument is not configured")
        return
    connection.send_result(msg["id"], coordinator.data or {})


@websocket_api.websocket_command({"type": "energyiq_instrument/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass, connection, msg):
    coordinator = next((v for v in hass.data.get(DOMAIN, {}).values() if hasattr(v, "data")), None)
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Instrument is not configured")
        return

    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], coordinator.data or {}))

    remove = coordinator.async_add_listener(forward)
    connection.subscriptions[msg["id"]] = remove
    connection.send_result(msg["id"], {"subscribed": True})
