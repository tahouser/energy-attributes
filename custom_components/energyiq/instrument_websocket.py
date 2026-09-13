"""Websocket API for the EnergyIQ instrument display."""
from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import callback

from .const import DOMAIN


def async_register(hass) -> None:
    websocket_api.async_register_command(hass, ws_snapshot)
    websocket_api.async_register_command(hass, ws_subscribe)


def _coordinator(hass):
    return next(
        (
            value
            for value in hass.data.get(DOMAIN, {}).values()
            if hasattr(value, "data") and hasattr(value, "host")
        ),
        None,
    )


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
        connection.send_message(
            websocket_api.event_message(msg["id"], coordinator.data or {})
        )

    remove = coordinator.async_add_listener(forward)
    connection.subscriptions[msg["id"]] = remove
    connection.send_result(msg["id"], {"subscribed": True})
