"""WebSocket API for the Energy Attribution workspace."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import device_registry as dr
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .persistence import get_store, validate_import_snapshot
from .meter_detector import discover_meters, ws_meter_detector, ws_meter_detector_probe, _power_role

_MANIFEST_VERSION = json.loads((Path(__file__).with_name("manifest.json")).read_text(encoding="utf-8"))["version"]


def _candidate_current_power(hass: HomeAssistant, candidate: dict, training: dict | None = None):
    """Return the current watt estimate for a candidate."""
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

    def _control_is_active(control: dict) -> bool:
        entity_id = control.get("entity_id")
        state = hass.states.get(entity_id) if entity_id else None
        if state is None:
            return False
        domain = str(control.get("domain") or entity_id.split(".", 1)[0]).casefold()
        value = str(state.state).casefold()
        if value in {"off", "unavailable", "unknown", "none"}:
            return False
        if domain == "climate":
            action = str(state.attributes.get("hvac_action") or "").casefold()
            if action in {"heating", "cooling", "fan", "drying", "idle"}:
                return action != "idle"
            return value not in {"off", "auto_off"}
        return value in {"on", "active", "running", "playing", "heating", "cooling"}

    control_on = any(
        _control_is_active(c)
        for c in controls if isinstance(c, dict) and c.get("entity_id")
    )

    if training.get("status") == "complete" and control_on and learned_w is not None and learned_w > 0:
        return direct_power if found_power and direct_power > 0 else learned_w

    if found_power:
        return direct_power

    if controls:
        return 0.0
    return None


def _trained_live_power(hass: HomeAssistant, candidates: dict, training_state: dict) -> tuple[float, int]:
    """Sum the current watts of completed trained loads that are active."""
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


def _meter_summary(hass: HomeAssistant, coordinator) -> list[dict]:
    """Discover live power/energy/voltage/current meters attached to the configured source device."""
    registry = er.async_get(hass)
    source_entry = registry.async_get(coordinator.power_entity)
    if source_entry is None or not source_entry.device_id:
        return []

    device_id = source_entry.device_id
    entities = []
    for entry in registry.entities.values():
        if entry.device_id != device_id or entry.domain != "sensor" or entry.disabled_by is not None:
            continue
        state = hass.states.get(entry.entity_id)
        if state is None:
            continue
        attrs = state.attributes
        unit = str(attrs.get("unit_of_measurement") or "").casefold()
        device_class = str(attrs.get("device_class") or "").casefold()
        name = str(attrs.get("friendly_name") or entry.name or entry.entity_id)
        entities.append((entry, state, unit, device_class, name))

    def number(item):
        try:
            return float(item[1].state)
        except (TypeError, ValueError):
            return None

    def meter_key(name: str):
        text = name.casefold()
        match = __import__("re").search(r"(?:meter|phase|leg)[ _-]*(\d+)", text)
        if match:
            return f"meter-{match.group(1)}"
        for token in ("l1", "l2", "l3"):
            if token in text:
                return token
        return None

    power = []
    for item in entities:
        entry, state, unit, device_class, name = item
        if device_class == "power" or unit in {"w", "kw"}:
            if entry.entity_id == coordinator.power_entity:
                continue
            value = number(item)
            if value is None:
                continue
            if unit == "kw":
                value *= 1000
            power.append((item, value))

    energy = [item for item in entities if str(item[3]).casefold() == "energy" or item[2] in {"kwh", "wh"}]
    voltage = [item for item in entities if item[2] in {"v", "volt", "volts"} or item[3] == "voltage"]
    current = [item for item in entities if item[2] in {"a", "amp", "amps"} or item[3] == "current"]

    def best_match(power_item, pool):
        pkey = meter_key(power_item[4])
        if pkey:
            keyed = [item for item in pool if meter_key(item[4]) == pkey]
            if keyed:
                return keyed[0]
        p_tokens = {x for x in __import__("re").split(r"[^a-z0-9]+", power_item[4].casefold()) if x and x not in {"power", "energy", "voltage", "current", "meter"}}
        scored = []
        for item in pool:
            tokens = {x for x in __import__("re").split(r"[^a-z0-9]+", item[4].casefold()) if x and x not in {"power", "energy", "voltage", "current", "meter"}}
            score = len(p_tokens & tokens)
            if score:
                scored.append((score, item))
        return max(scored, key=lambda x: x[0])[1] if scored else None

    result = []
    for item, watts in power:
        entry, state, unit, device_class, name = item
        energy_item = best_match(item, energy)
        voltage_item = best_match(item, voltage)
        current_item = best_match(item, current)
        label_key = meter_key(name)
        if label_key and label_key.startswith("meter-"):
            label = f"Meter {label_key.split('-', 1)[1]}"
        elif label_key:
            label = label_key.upper()
        else:
            label = name
        result.append({
            "label": label,
            "name": name,
            "source": entry.entity_id,
            "power": watts,
            "energy": number(energy_item) if energy_item else None,
            "voltage": number(voltage_item) if voltage_item else None,
            "current": number(current_item) if current_item else None,
        })

    result.sort(key=lambda item: (
        0 if __import__("re").match(r"Meter \d+$", item["label"]) else 1,
        item["label"].casefold(),
    ))
    return result


def _monitored_entity_ids(coordinator) -> list[str]:
    """Return HA entities belonging to currently monitored EnergyIQ loads."""
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


def _save_options(coordinator, **updates) -> None:
    """Persist EnergyIQ-owned options without rebuilding unrelated state."""
    options = dict(coordinator.entry.options)
    options.update(updates)
    coordinator.hass.config_entries.async_update_entry(
        coordinator.entry,
        options=options,
    )
    coordinator.hass.async_create_task(
        coordinator.async_persist_owned_state(options=options)
    )


def _coordinator(hass: HomeAssistant, entry_id: str):
    """Return a loaded coordinator for a real config entry."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None:
        raise LookupError("Energy Attribution config entry not found")
    coordinator = getattr(entry, "runtime_data", None)
    if coordinator is None:
        coordinator = hass.data.get(DOMAIN, {}).get("_coordinators", {}).get(entry_id)
    if coordinator is None or not hasattr(coordinator, "entry"):
        raise LookupError("Energy Attribution config entry is not loaded")
    return coordinator


@websocket_api.websocket_command({vol.Required("type"): "energy_attribution/export_data"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_export_data(hass, connection, msg):
    """Return the canonical EnergyIQ backup snapshot."""
    snapshot = await get_store(hass).async_load()
    if not isinstance(snapshot, dict):
        raise ValueError("No EnergyIQ data is currently saved.")
    connection.send_result(msg["id"], {"snapshot": snapshot, "version": _MANIFEST_VERSION})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/import_data",
    vol.Required("snapshot"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_data(hass, connection, msg):
    """Validate and replace the canonical EnergyIQ backup snapshot."""
    snapshot = validate_import_snapshot(msg["snapshot"])
    await get_store(hass).async_save(snapshot)
    connection.send_result(msg["id"], {"imported": True, "schema_version": snapshot["schema_version"]})


@websocket_api.websocket_command({vol.Required("type"): "energy_attribution/delete_data"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_data(hass, connection, msg):
    """Explicitly delete EnergyIQ-owned learned/configuration data."""
    coordinator = _coordinator(hass, msg["entry_id"])
    await coordinator.async_delete_owned_data()
    connection.send_result(msg["id"], {"deleted": True})


@websocket_api.websocket_command({vol.Required("type"): "energy_attribution/list_entries"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list_entries(hass, connection, msg):
    entries = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        coordinator = getattr(entry, "runtime_data", None)
        if coordinator is None:
            coordinator = hass.data.get(DOMAIN, {}).get("_coordinators", {}).get(entry.entry_id)
        if coordinator is None or not hasattr(coordinator, "entry"):
            continue
        entries.append({"entry_id": entry.entry_id, "title": entry.title})
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/set_power_source",
    vol.Required("entry_id"): str,
    vol.Required("entity_ids"): [str],
    vol.Optional("mode", default="single_channel"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_power_source(hass, connection, msg):
    """Set related active-power entities as one logical meter source."""
    coordinator = _coordinator(hass, msg["entry_id"])
    entity_ids = list(dict.fromkeys(str(x).strip() for x in msg["entity_ids"] if str(x).strip()))
    if not entity_ids:
        raise ValueError("Choose at least one active power sensor.")
    mode = str(msg.get("mode") or "single_channel")
    registry = er.async_get(hass)
    devices = set()
    rows = []
    for entity_id in entity_ids:
        entity = registry.async_get(entity_id)
        state = hass.states.get(entity_id)
        if entity is None or entity.disabled_by is not None or entity.domain != "sensor" or state is None:
            raise ValueError("Every selected meter channel must be an enabled Home Assistant sensor.")
        attrs = state.attributes
        device_class = str(attrs.get("device_class") or "").casefold()
        unit = str(attrs.get("unit_of_measurement") or "").casefold()
        if device_class == "apparent_power" or (device_class != "power" and unit not in {"w", "kw"}):
            raise ValueError("Every selected meter channel must be active power measured in W or kW.")
        try:
            numeric = float(state.state)
        except (TypeError, ValueError):
            raise ValueError("Every selected meter channel must currently report a numeric value.") from None
        if numeric != numeric or numeric in (float("inf"), float("-inf")):
            raise ValueError("Every selected meter channel must currently report a usable value.")
        role = _power_role(str(attrs.get("friendly_name") or entity.name or entity_id), entity_id)
        devices.add(entity.device_id)
        rows.append((entity_id, entity, state, role))
    if len(entity_ids) > 1:
        if None in devices or len(devices) != 1:
            raise ValueError("Combined meter channels must belong to the same Home Assistant device.")
        mode = "combined_channels"
    if len(entity_ids) == 1 and rows[0][3] == "phase":
        raise ValueError("A phase-only reading cannot be used as the whole-home meter by itself.")

    data = dict(coordinator.entry.data)
    data["power_entity"] = entity_ids[0]
    data["power_entities"] = entity_ids
    data["power_source_mode"] = mode
    options = dict(coordinator.entry.options)
    options["power_entities"] = entity_ids
    options["power_source_mode"] = mode
    hass.config_entries.async_update_entry(coordinator.entry, data=data, options=options)
    coordinator.power_entity = entity_ids[0]
    coordinator.power_entities = entity_ids
    coordinator.power_source_mode = mode
    await coordinator.async_persist_owned_state(options=options)
    watts = coordinator._whole_home_power_watts()
    connection.send_result(msg["id"], {
        "saved": True,
        "entity_ids": entity_ids,
        "entity_id": entity_ids[0],
        "mode": mode,
        "whole_home_power": watts,
    })


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/set_power_entity",
    vol.Required("entry_id"): str,
    vol.Required("entity_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_power_entity(hass, connection, msg):
    """Legacy single-source selector retained for compatibility."""
    legacy = dict(msg)
    legacy["entity_ids"] = [msg["entity_id"]]
    legacy["mode"] = "single_channel"
    await ws_set_power_source(hass, connection, legacy)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/update_configuration",
    vol.Required("entry_id"): str,
    vol.Required("updates"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_configuration(hass, connection, msg):
    """Save the consumer-facing EnergyIQ configuration sections."""
    coordinator = _coordinator(hass, msg["entry_id"])
    updates = msg["updates"]
    allowed = {
        "currency",
        "consumption_limits",
        "cost_limits",
        "peak_time_windows",
        "consumption_peak_schedule",
        "utility_zip_code",
        "utility_name",
        "utility_rate_plan",
        "utility_average_rate",
        "utility_peak_rate",
        "utility_off_peak_rate",
        "utility_lookup_year",
        "utility_lookup_source",
        "utility_costs",
    }
    unknown = set(updates) - allowed
    if unknown:
        raise ValueError("Unsupported EnergyIQ configuration setting.")

    clean = {}
    if "currency" in updates:
        currency = str(updates["currency"]).strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            raise ValueError("Currency must be a three-letter code such as USD.")
        clean["currency"] = currency

    for key in ("consumption_limits", "cost_limits"):
        if key not in updates:
            continue
        value = updates[key]
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be an object.")
        normalized = {}
        for period in ("peak", "off_peak"):
            item = value.get(period, {})
            if not isinstance(item, dict):
                raise ValueError(f"{key} contains an invalid period.")
            try:
                yellow = float(item["yellow"])
                red = float(item["red"])
            except (KeyError, TypeError, ValueError):
                raise ValueError(f"{key} requires yellow and red values for both periods.") from None
            if yellow < 0 or red < yellow:
                raise ValueError(f"{key} red threshold must be at least the yellow threshold.")
            normalized[period] = {"yellow": yellow, "red": red}
        clean[key] = normalized

    if "peak_time_windows" in updates:
        windows = updates["peak_time_windows"]
        if not isinstance(windows, list) or not 1 <= len(windows) <= 2:
            raise ValueError("Peak Time Window must contain one or two periods.")
        normalized_windows = []
        for window in windows:
            if not isinstance(window, dict):
                raise ValueError("Invalid peak period.")
            start = str(window.get("start", ""))[:8]
            end = str(window.get("end", ""))[:8]
            days = []
            for day in window.get("days", []):
                try:
                    day_int = int(day)
                except (TypeError, ValueError):
                    continue
                if 0 <= day_int <= 6 and day_int not in days:
                    days.append(day_int)
            if start == end or not days:
                raise ValueError("Each peak period needs different start/end times and at least one day.")
            normalized_windows.append({"start": start, "end": end, "days": sorted(days)})
        clean["peak_time_windows"] = normalized_windows
        clean["consumption_peak_schedule"] = dict(normalized_windows[0])

    if "consumption_peak_schedule" in updates and "peak_time_windows" not in clean:
        schedule = updates["consumption_peak_schedule"]
        if not isinstance(schedule, dict):
            raise ValueError("Invalid Peak Time Window.")
        start = str(schedule.get("start", ""))[:8]
        end = str(schedule.get("end", ""))[:8]
        days = sorted({int(day) for day in schedule.get("days", []) if str(day).isdigit() and 0 <= int(day) <= 6})
        if start == end or not days:
            raise ValueError("Peak Time Window needs different start/end times and at least one day.")
        clean["consumption_peak_schedule"] = {"start": start, "end": end, "days": days}

    utility_numeric = ("utility_average_rate", "utility_peak_rate", "utility_off_peak_rate")
    for key in utility_numeric:
        if key in updates:
            value = updates[key]
            if value in (None, ""):
                clean[key] = None
            else:
                try:
                    number = float(value)
                except (TypeError, ValueError):
                    raise ValueError(f"{key} must be numeric.") from None
                if number < 0:
                    raise ValueError(f"{key} cannot be negative.")
                clean[key] = number

    for key in ("utility_zip_code", "utility_name", "utility_rate_plan", "utility_lookup_source"):
        if key in updates:
            clean[key] = str(updates[key]).strip()
    if "utility_lookup_year" in updates:
        value = updates["utility_lookup_year"]
        clean["utility_lookup_year"] = int(value) if value not in (None, "") else None
    if "utility_costs" in updates:
        costs = updates["utility_costs"]
        if not isinstance(costs, list) or len(costs) > 4:
            raise ValueError("You can add up to four additional utility costs.")
        normalized_costs = []
        for cost in costs:
            if not isinstance(cost, dict):
                continue
            name = str(cost.get("name", "")).strip()
            basis = str(cost.get("basis", "")).strip().lower()
            try:
                amount = float(cost.get("amount"))
            except (TypeError, ValueError):
                raise ValueError("Each additional utility cost needs a numeric amount.") from None
            if not name or basis not in {"monthly", "daily", "per_kwh", "percentage"} or amount < 0:
                raise ValueError("Each additional utility cost needs a name, valid basis, and non-negative amount.")
            normalized_costs.append({"name": name, "basis": basis, "amount": amount})
        clean["utility_costs"] = normalized_costs

    if clean:
        _save_options(coordinator, **clean)
    connection.send_result(msg["id"], {"saved": True, "updates": clean})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/utility_lookup",
    vol.Required("entry_id"): str,
    vol.Required("zip_code"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_utility_lookup(hass, connection, msg):
    """Look up a utility by ZIP without leaving the EnergyIQ panel."""
    zip_code = str(msg["zip_code"]).strip()
    if len(zip_code) != 5 or not zip_code.isdigit():
        raise ValueError("Enter a five-digit ZIP code.")
    from .config_flow import _lookup_utility_by_zip
    result = await _lookup_utility_by_zip(hass, zip_code)
    if not result:
        connection.send_result(msg["id"], {"found": False, "zip_code": zip_code})
        return
    connection.send_result(msg["id"], {"found": True, "zip_code": zip_code, **result})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/workspace",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_workspace(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    coordinator.refresh_ha_metadata()
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
    whole_home_power = coordinator._whole_home_power_watts()
    trained_live_w, trained_live_count = _trained_live_power(hass, coordinator.candidate_devices, coordinator.training_state)
    connection.send_result(msg["id"], {
        "entry_id": msg["entry_id"],
        "version": _MANIFEST_VERSION,
        "power_entity": coordinator.power_entity,
        "power_entities": list(getattr(coordinator, "power_entities", [coordinator.power_entity])),
        "power_source_mode": getattr(coordinator, "power_source_mode", "single_channel"),
        "currency": coordinator.entry.options.get("currency", "USD"),
        "whole_home_power": whole_home_power,
        "trained_live_power_w": trained_live_w,
        "trained_live_count": trained_live_count,
        "meters": _meter_summary(hass, coordinator),
        "devices": rows,
        "last_training_device_id": getattr(coordinator, "last_training_device_id", None),
        "consumption_thresholds": coordinator.entry.options.get("consumption_thresholds", {}),
        "consumption_limits": coordinator.entry.options.get("consumption_limits", {}),
        "cost_limits": coordinator.entry.options.get("cost_limits", {}),
        "peak_time_windows": coordinator.entry.options.get("peak_time_windows", []),
        "utility": {
            "zip_code": coordinator.entry.options.get("utility_zip_code", ""),
            "name": coordinator.entry.options.get("utility_name", ""),
            "rate_plan": coordinator.entry.options.get("utility_rate_plan", ""),
            "average_rate": coordinator.entry.options.get("utility_average_rate"),
            "peak_rate": coordinator.entry.options.get("utility_peak_rate"),
            "off_peak_rate": coordinator.entry.options.get("utility_off_peak_rate"),
            "lookup_year": coordinator.entry.options.get("utility_lookup_year"),
            "lookup_source": coordinator.entry.options.get("utility_lookup_source", ""),
            "costs": coordinator.entry.options.get("utility_costs", []),
        },
        "consumption_peak_schedule": coordinator.entry.options.get(
            "consumption_peak_schedule",
            {"start": "15:00:00", "end": "19:00:00", "days": [1, 2, 3, 4, 5]},
        ),
        "consumption_accounting": coordinator.consumption_accounting,
        "consumption_period_totals": {
            "day": coordinator.consumption_period_totals("day"),
            "week": coordinator.consumption_period_totals("week"),
            "month": coordinator.consumption_period_totals("month"),
        },
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
    coordinator.device_classifications = {did: "monitor" if did in selected else "ignore" for did in valid}
    coordinator.monitored_entities = _monitored_entity_ids(coordinator)
    _save_options(
        coordinator,
        monitored_entities=coordinator.monitored_entities,
        device_classifications=coordinator.device_classifications,
        candidate_devices=coordinator.candidate_devices,
    )
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/remove_devices",
    vol.Required("entry_id"): str,
    vol.Required("device_ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_remove_devices(hass, connection, msg):
    """Remove excluded candidates from the EnergyIQ inventory."""
    coordinator = _coordinator(hass, msg["entry_id"])
    requested = set(msg["device_ids"])
    removed = []
    rejected = []

    for did in requested:
        if did not in coordinator.candidate_devices:
            continue
        if coordinator.device_classifications.get(did, "ignore") == "monitor":
            rejected.append(did)
            continue
        coordinator.candidate_devices.pop(did, None)
        coordinator.device_classifications.pop(did, None)
        coordinator.training_state.pop(did, None)
        if getattr(coordinator, "last_training_device_id", None) == did:
            coordinator.last_training_device_id = None
        removed.append(did)

    coordinator.monitored_entities = _monitored_entity_ids(coordinator)
    _save_options(
        coordinator,
        candidate_devices=coordinator.candidate_devices,
        device_classifications=coordinator.device_classifications,
        monitored_entities=coordinator.monitored_entities,
    )
    connection.send_result(msg["id"], {
        "saved": True,
        "removed": removed,
        "rejected": rejected,
    })


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
    _save_options(
        coordinator,
        candidate_devices=coordinator.candidate_devices,
        device_classifications=coordinator.device_classifications,
        monitored_entities=coordinator.monitored_entities,
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
    entities = []
    for entry in registry.entities.values():
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
            "disabled": entry.disabled_by is not None,
            "disabled_by": str(entry.disabled_by) if entry.disabled_by is not None else None,
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
        raise ValueError("HA entity was not found or is disabled; enable it in Home Assistant first")
    state = hass.states.get(entity_id)
    name = state.attributes.get("friendly_name") if state else None
    existing_did = None
    for candidate_did, existing_candidate in coordinator.candidate_devices.items():
        attached = [*(existing_candidate.get("measurements", []) or []), *(existing_candidate.get("controls", []) or [])]
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
        candidate = {"device_id": did, "name": name or entry.name or entry.original_name or entity_id, "area": "", "manufacturer": "", "model": "", "evidence": "", "controls": [], "measurements": [], "source": "ha", "category": "", "manual_added": True, "ha_device_id": entry.device_id or ""}
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
    _save_options(
        coordinator,
        candidate_devices=coordinator.candidate_devices,
        device_classifications=coordinator.device_classifications,
        monitored_entities=coordinator.monitored_entities,
    )
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
    connection.send_result(msg["id"], {
        "saved": True,
        "action": "already_monitored" if existing_did else "added_to_monitoring",
        "device": candidate,
        "device_id": did,
        "entity_id": entity_id,
        "candidate_matches": matches,
    })


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
    vol.Required("type"): "energy_attribution/confirm_long_cycle",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Required("accepted"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_confirm_long_cycle(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"]); device_id = msg["device_id"]
    if coordinator._training_device != device_id or coordinator._training_engine is None: raise ValueError("No active training session exists for this device")
    engine=coordinator._training_engine
    if engine.method != "full_cycle": raise ValueError("This control is only available for Full Cycle training")
    result=engine.confirm_full_cycle(msg["accepted"], hass.loop.time()); state=coordinator.training_state.get(device_id,{})
    state.update({k:result.get(k) for k in ("phase","baseline_w","peak_delta_w","duration_s","energy_wh")}); state["result"]=result
    if result.get("failed"): state["status"]="error"; state["error"]=result.get("failure_reason"); state["instruction"]=result.get("failure_reason")
    elif result.get("phase")=="capturing": state["instruction"]="Capturing power. Leave the device ON, then press Stop & Save when the cycle is complete."
    else: state["instruction"]="Waiting for the target load to be ON. Press Start Power Capture when ready."
    await coordinator._persist(force=True); connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/end_long_cycle",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
    vol.Optional("force", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_end_long_cycle(hass, connection, msg):
    coordinator=_coordinator(hass,msg["entry_id"]); device_id=msg["device_id"]
    if coordinator._training_device != device_id or coordinator._training_engine is None: raise ValueError("No active training session exists for this device")
    engine=coordinator._training_engine
    if engine.method != "full_cycle": raise ValueError("This control is only available for Full Cycle training")
    now=hass.loop.time(); result=engine.end_full_cycle(force=msg["force"]); state=coordinator.training_state.get(device_id,{})
    state.update({k:result.get(k) for k in ("phase","baseline_w","peak_delta_w","duration_s","energy_wh")}); state["result"]=result
    if result.get("action")=="end_warning": state["instruction"]="Not ready to save: keep the device ON for at least 30 seconds before pressing Stop & Save."
    elif result.get("completed"):
        state.update({"status":"complete","learned":True,"completed":True,"completed_at":now})
        state["learned_signature"]={"method":"full_cycle","baseline_w":result.get("baseline_w"),"load_w":result.get("peak_delta_w"),"duration_s":result.get("duration_s"),"energy_wh":result.get("energy_wh"),"events_detected":result.get("events_detected",0),"observations":result.get("observations",[])}
        coordinator.last_training_device_id=device_id
        if coordinator._direct_rpc_task and not coordinator._direct_rpc_task.done(): coordinator._direct_rpc_task.cancel()
    await coordinator._persist(force=True); connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/stop_training",
    vol.Required("entry_id"): str,
    vol.Required("device_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_stop_training(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    device_id = msg["device_id"]
    if coordinator._training_device != device_id or coordinator._training_engine is None:
        raise ValueError("No active training session exists for this device")
    state = coordinator.training_state.get(device_id, {})
    state["status"] = "stopped"
    state["phase"] = "stopped"
    state["instruction"] = "Training stopped without saving a new signature."
    state["completed"] = False
    state["learned"] = False
    task = coordinator._training_task
    coordinator._training_engine = None
    coordinator._training_device = None
    if coordinator._direct_rpc_task and not coordinator._direct_rpc_task.done():
        coordinator._direct_rpc_task.cancel()
        try:
            await coordinator._direct_rpc_task
        except asyncio.CancelledError:
            pass
    if task and not task.done() and task is not asyncio.current_task():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    coordinator._training_task = None
    await coordinator._persist(force=True)
    connection.send_result(msg["id"], {"stopped": True})


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (ws_list_entries, ws_workspace, ws_export_data, ws_import_data, ws_delete_data, ws_set_monitoring, ws_remove_devices, ws_add_manual_device, ws_list_available_entities, ws_add_entity, ws_set_power_source, ws_set_power_entity, ws_update_configuration, ws_utility_lookup, ws_start_training, ws_bulk_auto_training, ws_bulk_training_state, ws_confirm_long_cycle, ws_end_long_cycle, ws_stop_training, ws_meter_detector, ws_meter_detector_probe):
        websocket_api.async_register_command(hass, handler)
