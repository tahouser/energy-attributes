"""WebSocket API for the Energy Attribution training workspace."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def _coordinator(hass: HomeAssistant, entry_id: str):
    coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
    if coordinator is None:
        raise ValueError("Energy Attribution entry not loaded")
    return coordinator


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/list_entries",
})
@websocket_api.async_response
async def ws_list_entries(hass, connection, msg):
    entries = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        entries.append({
            "entry_id": entry_id,
            "title": coordinator.entry.title,
            "power_entity": coordinator.power_entity,
        })
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/workspace",
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
async def ws_workspace(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    candidates = list(coordinator.candidate_devices.values())
    classifications = coordinator.device_classifications
    rows = []
    for candidate in candidates:
        did = candidate["device_id"]
        state = coordinator.training_state.get(did, {})
        rows.append({
            "device_id": did,
            "name": candidate.get("name", did),
            "area": candidate.get("area", ""),
            "manufacturer": candidate.get("manufacturer", ""),
            "model": candidate.get("model", ""),
            "evidence": candidate.get("evidence", ""),
            "controls": candidate.get("controls", []),
            "classification": classifications.get(did, "ignore"),
            "training": state,
        })
    connection.send_result(msg["id"], {
        "entry_id": msg["entry_id"],
        "power_entity": coordinator.power_entity,
        "whole_home_power": coordinator.hass.states.get(coordinator.power_entity).state
        if coordinator.hass.states.get(coordinator.power_entity) else None,
        "devices": rows,
    })


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/start_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Optional("method"): vol.In(["quick", "full_cycle"]),
})
@websocket_api.async_response
async def ws_start_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    device_id = msg["device_id"]
    method = msg.get("method", "quick")
    result = await coordinator.async_start_training(device_id, method)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/retry_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
})
@websocket_api.async_response
async def ws_retry_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    device_id = msg["device_id"]
    await coordinator.async_reset_training(device_id)
    result = await coordinator.async_start_training(device_id, "quick")
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/stop_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
})
@websocket_api.async_response
async def ws_stop_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    await coordinator.async_stop_training(msg["device_id"])
    connection.send_result(msg["id"], {"stopped": True})


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_list_entries)
    websocket_api.async_register_command(hass, ws_workspace)
    websocket_api.async_register_command(hass, ws_start_training)
    websocket_api.async_register_command(hass, ws_retry_training)
    websocket_api.async_register_command(hass, ws_stop_training)
