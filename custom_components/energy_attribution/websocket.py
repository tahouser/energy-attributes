"""WebSocket API for the Energy Attribution workspace."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def _coordinator(hass: HomeAssistant, entry_id: str):
    coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
    if coordinator is None or not hasattr(coordinator, "entry"):
        raise ValueError("Energy Attribution entry not loaded")
    return coordinator


@websocket_api.websocket_command({vol.Required("type"): "energy_attribution/list_entries"})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_list_entries(hass, connection, msg):
    entries = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if not hasattr(coordinator, "entry"):
            continue
        entries.append({"entry_id": entry_id, "title": coordinator.entry.title})
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/workspace",
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_workspace(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    rows = []
    for candidate in coordinator.candidate_devices.values():
        did = candidate["device_id"]
        rows.append({
            "device_id": did,
            "name": candidate.get("name", did),
            "area": candidate.get("area", ""),
            "manufacturer": candidate.get("manufacturer", ""),
            "model": candidate.get("model", ""),
            "evidence": candidate.get("evidence", ""),
            "controls": candidate.get("controls", []),
            "classification": coordinator.device_classifications.get(did, "ignore"),
            "training": coordinator.training_state.get(did, {}),
        })
    state = hass.states.get(coordinator.power_entity)
    connection.send_result(msg["id"], {
        "entry_id": msg["entry_id"],
        "power_entity": coordinator.power_entity,
        "whole_home_power": state.state if state else None,
        "devices": rows,
    })


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/set_monitoring",
    vol.Required("entry_id"): str,
    vol.Required("device_ids"): [str],
})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_set_monitoring(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    selected = set(msg["device_ids"])
    valid = set(coordinator.candidate_devices)
    selected &= valid
    coordinator.device_classifications = {
        did: "monitor" if did in selected else "ignore" for did in valid
    }
    coordinator.monitored_entities = [
        m["entity_id"]
        for did, candidate in coordinator.candidate_devices.items()
        if did in selected
        for m in candidate.get("measurements", [])
    ]
    hass.config_entries.async_update_entry(
        coordinator.entry,
        options={
            **coordinator.entry.options,
            "monitored_entities": coordinator.monitored_entities,
            "device_classifications": coordinator.device_classifications,
            "candidate_devices": coordinator.candidate_devices,
        },
    )
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/start_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Required("method"): vol.In(["quick", "full_cycle"]),
})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_start_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    if coordinator.device_classifications.get(msg["device_id"]) != "monitor":
        raise ValueError("Device must be monitored before training")
    result = await coordinator.async_start_training(msg["device_id"], msg["method"])
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/retry_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_retry_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    method = coordinator.training_state.get(msg["device_id"], {}).get("method", "quick")
    await coordinator.async_reset_training(msg["device_id"])
    result = await coordinator.async_start_training(msg["device_id"], method)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/stop_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
})
@websocket_api.async_response
@websocket_api.require_admin
async def ws_stop_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    await coordinator.async_stop_training(msg["device_id"])
    connection.send_result(msg["id"], {"stopped": True})


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (ws_list_entries, ws_workspace, ws_set_monitoring, ws_start_training, ws_retry_training, ws_stop_training):
        websocket_api.async_register_command(hass, handler)
