"""WebSocket API for the Energy Attribution workspace."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import device_registry as dr
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN



def _candidate_current_power(hass: HomeAssistant, candidate: dict, training: dict | None = None):
    """Return the current watt estimate for a candidate.

    For a trained controllable device, the learned signature is used while the
    device is actually ON. A live HA power sensor is preferred when it reports
    a positive value. Energy (kWh) sensors are never treated as instantaneous
    watts.
    """
    direct_power = 0.0
    found_power = False
    for measurement in candidate.get("measurements", []):
        if measurement.get("kind") != "power":
            continue
        entity_id = measurement.get("entity_id")
        state = hass.states.get(entity_id) if entity_id else None
        if state is None:
            continue
        try:
            value = float(state.state)
        except (TypeError, ValueError):
            continue
        unit = str(state.attributes.get("unit_of_measurement") or measurement.get("unit") or "").casefold()
        if unit not in {"w", "kw"}:
            continue
        if unit == "kw":
            value *= 1000
        direct_power += max(0.0, value)
        found_power = True

    training = training or {}
    signature = training.get("learned_signature") or {}
    try:
        learned_w = float(signature.get("load_w"))
    except (TypeError, ValueError):
        learned_w = None

    controls = candidate.get("controls", [])
    control_on = any(
        (hass.states.get(c.get("entity_id")) is not None
         and hass.states.get(c.get("entity_id")).state == "on")
        for c in controls if isinstance(c, dict) and c.get("entity_id")
    )

    if training.get("status") == "complete" and control_on and learned_w is not None and learned_w > 0:
        # A positive direct measurement is the best live value. If HA exposes
        # a power entity but it currently reports zero, use the trained load
        # estimate so a trained ON light/switch does not incorrectly display 0 W.
        return direct_power if found_power and direct_power > 0 else learned_w

    if found_power:
        return direct_power

    if controls:
        return 0.0
    return None

def _trained_live_power(hass: HomeAssistant, candidates: dict, training_state: dict) -> tuple[float, int]:
    """Sum the current watts of completed trained loads that are active.

    The whole-home meter remains the authoritative total. This value is only
    the portion EnergyIQ can currently account for from trained devices: a
    direct live power sensor when available, otherwise the learned signature
    while the associated HA load entity is ON. Historical training wattage is
    never counted while a device is OFF.
    """
    total = 0.0
    live_count = 0
    for did, candidate in candidates.items():
        training = training_state.get(did, {})
        if training.get("status") != "complete":
            continue
        watts = _candidate_current_power(hass, candidate, training)
        if watts is None or watts <= 0:
            continue
        total += watts
        live_count += 1
    return total, live_count

def _monitored_entity_ids(coordinator) -> list[str]:
    """Return HA entities belonging to currently monitored EnergyIQ loads.

    The EnergyIQ workspace is candidate/load based, not entity-list based.
    Keep this legacy field synchronized with both measurement entities and
    controllable load entities so adding a control-only load does not vanish
    from persisted monitoring state.
    """
    result: list[str] = []
    seen: set[str] = set()
    for did, candidate in coordinator.candidate_devices.items():
        if coordinator.device_classifications.get(did, "ignore") != "monitor":
            continue
        for item in (*candidate.get("measurements", []), *candidate.get("controls", [])):
            entity_id = item.get("entity_id") if isinstance(item, dict) else None
            if entity_id and entity_id not in seen:
                seen.add(entity_id)
                result.append(entity_id)
    return result


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
            "current_power": _candidate_current_power(hass, candidate, coordinator.training_state.get(did, {})),
        })
    state = hass.states.get(coordinator.power_entity)
    trained_live_w, trained_live_count = _trained_live_power(
        hass, coordinator.candidate_devices, coordinator.training_state
    )
    connection.send_result(msg["id"], {
        "entry_id": msg["entry_id"],
        "power_entity": coordinator.power_entity,
        "whole_home_power": state.state if state else None,
        "trained_live_power_w": trained_live_w,
        "trained_live_count": trained_live_count,
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
    coordinator.monitored_entities = _monitored_entity_ids(coordinator)
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
    monitored_entities = set()
    entity_candidate = {}
    for did, candidate in coordinator.candidate_devices.items():
        is_monitored = coordinator.device_classifications.get(did, "ignore") == "monitor"
        for m in candidate.get("measurements", []):
            entity_id = m.get("entity_id")
            if entity_id:
                used.add(entity_id)
                entity_candidate[entity_id] = did
                if is_monitored:
                    monitored_entities.add(entity_id)
        for c in candidate.get("controls", []):
            entity_id = c.get("entity_id")
            if entity_id:
                used.add(entity_id)
                entity_candidate[entity_id] = did
                if is_monitored:
                    monitored_entities.add(entity_id)
    entities = []
    for entry in registry.entities.values():
        # The Add Entity dialog is a complete browser of enabled HA entities,
        # not an electrical-load candidate filter. Keep disabled registry
        # entries out because they are not selectable in HA, but include every
        # enabled domain and entities without a current State object.
        if entry.disabled_by is not None:
            continue
        state = hass.states.get(entry.entity_id)
        attrs = state.attributes if state is not None else {}
        matches = []
        for did, candidate in coordinator.candidate_devices.items():
            attached = [*(candidate.get("measurements", []) or []), *(candidate.get("controls", []) or [])]
            if any(isinstance(item, dict) and item.get("entity_id") == entry.entity_id for item in attached):
                matches.append({
                    "device_id": did,
                    "name": candidate.get("name", did),
                    "classification": coordinator.device_classifications.get(did, "ignore"),
                    "source": candidate.get("source", "ha"),
                })
        entities.append({
            "entity_id": entry.entity_id,
            "name": attrs.get("friendly_name") or entry.name or entry.original_name or entry.entity_id,
            "domain": entry.domain,
            "device_id": entry.device_id,
            "state": state.state if state is not None else "unavailable",
            "hvac_action": attrs.get("hvac_action") if entry.domain == "climate" else None,
            "already_added": bool(matches),
            "monitored": any(m["classification"] == "monitor" for m in matches),
            "candidate_device_id": matches[0]["device_id"] if matches else None,
            "candidate_matches": matches,
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
    # The initial EnergyIQ inventory is intentionally curated at the HA-device
    # level. Add Entity is the escape hatch for a specific HA entity that was
    # not included in that initial inventory. A selected entity is therefore
    # its own EnergyIQ load unless that exact entity is already attached to an
    # existing candidate. Do NOT inherit the HA device candidate merely because
    # the device already has another monitored entity; that made unrelated
    # entities appear as "Already monitored" and prevented them from being
    # added as their own load.
    existing_did = None
    for candidate_did, existing_candidate in coordinator.candidate_devices.items():
        attached = [
            *(existing_candidate.get("measurements", []) or []),
            *(existing_candidate.get("controls", []) or []),
        ]
        if any(isinstance(item, dict) and item.get("entity_id") == entity_id for item in attached):
            existing_did = candidate_did
            break

    did = existing_did or "entity_" + entity_id.replace(".", "_")
    if did in coordinator.candidate_devices and existing_did is None:
        base_did = did
        n = 2
        while did in coordinator.candidate_devices:
            did = f"{base_did}_{n}"
            n += 1
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
    coordinator.monitored_entities = _monitored_entity_ids(coordinator)
    # Persist the complete candidate/classification state. This is deliberately
    # separate from the legacy monitored_entities list: the workspace is load
    # based, while monitored_entities is only a compatibility/index field.
    hass.config_entries.async_update_entry(
        coordinator.entry,
        options={
            **coordinator.entry.options,
            "candidate_devices": coordinator.candidate_devices,
            "device_classifications": coordinator.device_classifications,
            "monitored_entities": coordinator.monitored_entities,
        },
    )
    # Return enough ownership information to diagnose stale/duplicate entity
    # associations instead of allowing the UI to report only "Already Monitored".
    matches = []
    for candidate_did, existing_candidate in coordinator.candidate_devices.items():
        attached = [*(existing_candidate.get("measurements", []) or []), *(existing_candidate.get("controls", []) or [])]
        if any(isinstance(item, dict) and item.get("entity_id") == entity_id for item in attached):
            matches.append({
                "device_id": candidate_did,
                "name": existing_candidate.get("name", candidate_did),
                "classification": coordinator.device_classifications.get(candidate_did, "ignore"),
                "source": existing_candidate.get("source", "ha"),
            })
    connection.send_result(
        msg["id"],
        {
            "saved": True,
            "action": "already_monitored" if existing_did else "added_to_monitoring",
            "device": candidate,
            "device_id": did,
            "entity_id": entity_id,
            "candidate_matches": matches,
        },
    )


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
    vol.Required("type"): "energy_attribution/bulk_auto_training",
    vol.Required("entry_id"): str,
    vol.Required("device_ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_bulk_auto_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    result = await coordinator.async_bulk_auto_training(msg["device_ids"])
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/bulk_training_state",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_bulk_training_state(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    connection.send_result(msg["id"], coordinator.bulk_training_state)


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
    for handler in (ws_list_entries, ws_workspace, ws_set_monitoring, ws_add_manual_device, ws_list_available_entities, ws_add_entity, ws_start_training, ws_bulk_auto_training, ws_bulk_training_state, ws_retry_training, ws_stop_training):
        websocket_api.async_register_command(hass, handler)
