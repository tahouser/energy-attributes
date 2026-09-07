"""WebSocket API for the Energy Attribution workspace."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import device_registry as dr
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def _coordinator(hass: HomeAssistant, entry_id: str):
    """Return a loaded coordinator for a real config entry."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None:
        raise LookupError("Energy Attribution config entry not found")
    coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
    if coordinator is None or not hasattr(coordinator, "entry"):
        raise LookupError("Energy Attribution config entry is not loaded")
    return coordinator


@websocket_api.websocket_command({vol.Required("type"): "energy_attribution/list_entries"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list_entries(hass, connection, msg):
    entries = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if not isinstance(entry_id, str) or entry_id.startswith("_"):
            continue
        if not hasattr(coordinator, "entry"):
            continue
        entries.append({"entry_id": entry_id, "title": coordinator.entry.title})
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/workspace",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
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
            "source": candidate.get("source", "ha"),
            "category": candidate.get("category", ""),
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
        "last_training_device_id": getattr(coordinator, "last_training_device_id", None),
    })


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/set_monitoring",
    vol.Required("entry_id"): str,
    vol.Required("device_ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
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
    vol.Required("type"): "energy_attribution/add_manual_device",
    vol.Required("entry_id"): str,
    vol.Required("name"): str,
    vol.Optional("category", default="Appliance"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_add_manual_device(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    name = msg["name"].strip()
    category = msg.get("category", "Appliance").strip() or "Appliance"
    if not name:
        raise ValueError("Device name is required")
    # Manual devices deliberately have no HA entity/device. They live in the
    # same commissioning inventory as discovered HA candidates.
    base = "manual_" + __import__("re").sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    did = base or "manual_device"
    n = 2
    while did in coordinator.candidate_devices:
        did = f"{base}_{n}"
        n += 1
    candidate = {
        "device_id": did,
        "name": name,
        "area": "",
        "manufacturer": "",
        "model": "",
        "evidence": "Manual electrical device",
        "controls": [],
        "measurements": [],
        "source": "manual",
        "category": category,
    }
    coordinator.candidate_devices[did] = candidate
    coordinator.device_classifications[did] = "monitor"
    hass.config_entries.async_update_entry(
        coordinator.entry,
        options={
            **coordinator.entry.options,
            "candidate_devices": coordinator.candidate_devices,
            "device_classifications": coordinator.device_classifications,
            "monitored_entities": coordinator.monitored_entities,
        },
    )
    connection.send_result(msg["id"], {"saved": True, "device": candidate})

@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/list_available_entities",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list_available_entities(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    registry = er.async_get(hass)
    used = set()
    for candidate in coordinator.candidate_devices.values():
        used.update(m.get("entity_id") for m in candidate.get("measurements", []) if m.get("entity_id"))
        used.update(c.get("entity_id") for c in candidate.get("controls", []) if c.get("entity_id"))
    entities = []
    for entry in registry.entities.values():
        if entry.entity_id in used or entry.disabled_by is not None:
            continue
        state = hass.states.get(entry.entity_id)
        if state is None:
            continue
        if entry.domain not in {"light", "switch", "fan", "climate", "humidifier", "media_player", "vacuum", "water_heater", "sensor"}:
            continue
        entities.append({
            "entity_id": entry.entity_id,
            "name": state.attributes.get("friendly_name") or entry.name or entry.original_name or entry.entity_id,
            "domain": entry.domain,
            "device_id": entry.device_id,
        })
    entities.sort(key=lambda x: x["name"].casefold())
    connection.send_result(msg["id"], {"entities": entities})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/add_entity",
    vol.Required("entry_id"): str,
    vol.Required("entity_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_add_entity(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    entity_id = msg["entity_id"]
    registry = er.async_get(hass)
    entry = registry.async_get(entity_id)
    if entry is None or entry.disabled_by is not None:
        raise ValueError("HA entity was not found or is disabled")
    state = hass.states.get(entity_id)
    name = state.attributes.get("friendly_name") if state else None
    did = entry.device_id or "entity_" + entity_id.replace(".", "_")
    candidate = coordinator.candidate_devices.get(did)
    if candidate is None:
        candidate = {"device_id": did, "name": name or entry.name or entry.original_name or entity_id, "area": "", "manufacturer": "", "model": "", "evidence": "", "controls": [], "measurements": [], "source": "ha", "category": "", "manual_added": True}
        if entry.device_id:
            dev = dr.async_get(hass).async_get(entry.device_id)
            if dev:
                candidate.update({"name": dev.name_by_user or dev.name or candidate["name"], "manufacturer": dev.manufacturer or "", "model": dev.model or ""})
        coordinator.candidate_devices[did] = candidate
    existing_measurements = {m.get("entity_id") for m in candidate.get("measurements", [])}
    existing_controls = {c.get("entity_id") for c in candidate.get("controls", [])}
    if entry.domain == "sensor" and entity_id not in existing_measurements:
        attrs = state.attributes if state else {}
        candidate.setdefault("measurements", []).append({"entity_id": entity_id, "name": name or entity_id, "kind": attrs.get("device_class", "sensor"), "unit": attrs.get("unit_of_measurement", "")})
    elif entry.domain != "sensor" and entity_id not in existing_controls:
        candidate.setdefault("controls", []).append({"entity_id": entity_id, "name": name or entity_id, "domain": entry.domain})
    candidate["source"] = "ha"
    candidate["manual_added"] = True
    candidate["evidence"] = (candidate.get("evidence") + "; " if candidate.get("evidence") else "") + f"Manually selected HA entity: {entity_id}"
    coordinator.device_classifications[did] = "monitor"
    coordinator.monitored_entities = [m["entity_id"] for d,c in coordinator.candidate_devices.items() if coordinator.device_classifications.get(d)=="monitor" for m in c.get("measurements", []) if m.get("entity_id")]
    hass.config_entries.async_update_entry(coordinator.entry, options={**coordinator.entry.options, "candidate_devices": coordinator.candidate_devices, "device_classifications": coordinator.device_classifications, "monitored_entities": coordinator.monitored_entities})
    connection.send_result(msg["id"], {"saved": True, "device": candidate})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/start_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Required("method"): vol.In(["quick", "full_cycle", "manual"]),
})
@websocket_api.require_admin
@websocket_api.async_response
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
@websocket_api.require_admin
@websocket_api.async_response
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
@websocket_api.require_admin
@websocket_api.async_response
async def ws_stop_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    await coordinator.async_stop_training(msg["device_id"])
    connection.send_result(msg["id"], {"stopped": True})


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (ws_list_entries, ws_workspace, ws_set_monitoring, ws_add_manual_device, ws_list_available_entities, ws_add_entity, ws_start_training, ws_retry_training, ws_stop_training):
        websocket_api.async_register_command(hass, handler)
