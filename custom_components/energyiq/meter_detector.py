"""EnergyIQ whole-home meter discovery diagnostics."""
from __future__ import annotations

import re
import asyncio
from types import SimpleNamespace

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
import voluptuous as vol

from .const import DOMAIN


_POWER_UNITS = {"w", "kw"}
_ENERGY_UNITS = {"wh", "kwh", "mwh"}
_VOLTAGE_UNITS = {"v", "mv", "kv"}
_CURRENT_UNITS = {"a", "ma", "ka"}

_HOME_WORDS = (
    "total", "whole", "house", "home", "main", "mains", "grid",
    "utility", "service", "consumption", "import", "meter",
)
_PHASE_WORDS = ("phase", "leg", "l1", "l2", "l3", "channel", "ch1", "ch2", "ch3")
_METER_BRANDS = ("shelly", "emporia", "sense", "homewizard", "iotawatt", "eastron", "smappee")


def _number(state) -> float | None:
    try:
        value = float(state.state)
    except (TypeError, ValueError):
        return None
    return value if value == value and abs(value) != float("inf") else None


def _kind(state) -> str | None:
    attrs = state.attributes
    device_class = str(attrs.get("device_class") or "").casefold()
    unit = str(attrs.get("unit_of_measurement") or "").casefold()
    if device_class in {"power", "apparent_power"} or unit in _POWER_UNITS:
        return "power"
    if device_class == "energy" or unit in _ENERGY_UNITS:
        return "energy"
    if device_class == "voltage" or unit in _VOLTAGE_UNITS:
        return "voltage"
    if device_class == "current" or unit in _CURRENT_UNITS:
        return "current"
    return None


def _tokens(text: str) -> set[str]:
    return {x for x in re.split(r"[^a-z0-9]+", text.casefold()) if x}


def _entity_summary(hass: HomeAssistant, entry, device) -> list[dict]:
    registry = er.async_get(hass)
    rows = []
    for entity in registry.entities.values():
        if entity.device_id != device.id or entity.disabled_by is not None:
            continue
        state = hass.states.get(entity.entity_id)
        if state is None:
            continue
        kind = _kind(state)
        if kind is None:
            continue
        attrs = state.attributes
        rows.append({
            "entity_id": entity.entity_id,
            "name": str(attrs.get("friendly_name") or entity.name or entity.entity_id),
            "domain": entity.domain,
            "kind": kind,
            "device_class": attrs.get("device_class"),
            "unit": attrs.get("unit_of_measurement"),
            "state_class": attrs.get("state_class"),
            "state": state.state,
            "value": _number(state),
            "entity_category": str(entity.entity_category or ""),
            "disabled": entity.disabled_by is not None,
        })
    rows.sort(key=lambda x: ({"power": 0, "energy": 1, "voltage": 2, "current": 3}.get(x["kind"], 9), x["name"].casefold()))
    return rows


def _config_info(hass: HomeAssistant, entity) -> list[dict]:
    result = []
    config_ids = getattr(entity, "config_entry_ids", None)
    if config_ids is None:
        config_id = getattr(entity, "config_entry_id", None)
        config_ids = {config_id} if config_id else set()
    for config_entry_id in config_ids:
        entry = hass.config_entries.async_get_entry(config_entry_id)
        if entry is None:
            continue
        result.append({
            "entry_id": entry.entry_id,
            "domain": entry.domain,
            "title": entry.title,
        })
    return result


def _score_device(device, entities: list[dict], config_entries: list[dict]) -> tuple[int, list[str]]:
    text = " ".join([
        str(device.name or ""),
        str(device.name_by_user or ""),
        str(device.manufacturer or ""),
        str(device.model or ""),
        " ".join(e["name"] for e in entities),
        " ".join(e["entity_id"] for e in entities),
        " ".join(f"{c['domain']} {c['title']}" for c in config_entries),
    ]).casefold()
    tokens = _tokens(text)
    score = 0
    evidence: list[str] = []

    if any(word in tokens for word in _HOME_WORDS):
        score += 8
        evidence.append("home/total meter naming")
    if any(word in tokens for word in _METER_BRANDS):
        score += 5
        evidence.append("known energy-meter integration/brand")
    if any(c["domain"] in {"shelly", "emporia", "sense", "homewizard", "iotawatt"} for c in config_entries):
        score += 5
        evidence.append("known meter integration")
    kinds = {e["kind"] for e in entities}
    if "power" in kinds:
        score += 5
        evidence.append("active power")
    if "energy" in kinds:
        score += 3
        evidence.append("energy")
    voltage = [e for e in entities if e["kind"] == "voltage"]
    current = [e for e in entities if e["kind"] == "current"]
    phase_named = [e for e in entities if any(p in _tokens(e["name"] + " " + e["entity_id"]) for p in _PHASE_WORDS)]
    if voltage:
        score += 2
        evidence.append(f"{len(voltage)} voltage channel(s)")
    if current:
        score += 2
        evidence.append(f"{len(current)} current channel(s)")
    if len(phase_named) >= 2:
        score += 4
        evidence.append(f"{len(phase_named)} phase/channel-like entities")
    if len([e for e in entities if e["kind"] == "power"]) >= 3:
        score += 3
        evidence.append("multiple power channels")

    return score, evidence


def _infer_electrical_system(device, entities: list[dict]) -> dict:
    """Make conservative inferences; never claim certainty from model alone."""
    voltage = [e for e in entities if e["kind"] == "voltage" and e["value"] is not None]
    power = [e for e in entities if e["kind"] == "power"]
    names = " ".join([str(device.manufacturer or ""), str(device.model or ""), str(device.name or "")]).casefold()

    active_voltage = [e["value"] for e in voltage if abs(e["value"]) > 1]
    around_120 = [v for v in active_voltage if 105 <= v <= 135]
    around_230 = [v for v in active_voltage if 210 <= v <= 250]
    phase_like = [
        e for e in entities
        if any(p in _tokens(e["name"] + " " + e["entity_id"]) for p in ("l1", "l2", "l3", "phase", "leg"))
    ]

    if "shelly" in names and ("3em" in names or "pro 3em" in names):
        meter_model = "Shelly Pro 3EM family"
    else:
        meter_model = None

    inference = "unknown"
    confidence = "low"
    reasons = []

    if len(around_230) >= 3:
        inference = "likely 230 V multi-phase service"
        confidence = "medium"
        reasons.append("three or more live voltage channels near 230 V")
    elif len(around_120) >= 2 and len(around_120) <= 3:
        inference = "likely 120 V multi-channel / split-phase measurement"
        confidence = "medium"
        reasons.append("multiple live voltage channels near 120 V")
    elif len(phase_like) >= 3:
        inference = "multi-channel meter detected; service topology not proven"
        confidence = "low"
        reasons.append("multiple phase/channel entities are present")
    elif len(power) >= 3:
        inference = "multi-channel power meter detected; service topology not proven"
        confidence = "low"
        reasons.append("multiple power channels are present")

    if meter_model:
        reasons.append("Shelly Pro 3EM model metadata is visible in Home Assistant")
    if not reasons:
        reasons.append("Home Assistant metadata does not expose enough evidence")

    return {
        "inference": inference,
        "confidence": confidence,
        "reasons": reasons,
        "meter_model": meter_model,
        "voltage_channels": len(voltage),
        "live_voltage_channels": len(active_voltage),
        "power_channels": len(power),
    }


def _channel_label(row: dict) -> str:
    """Best-effort channel label from the HA entity name."""
    text = f"{row.get('name','')} {row.get('entity_id','')}".casefold()
    match = re.search(r"(?:^|[^a-z0-9])(l[123]|phase[_ -]?[123]|channel[_ -]?[123]|ch[123])(?:$|[^a-z0-9])", text)
    if match:
        return re.sub(r"[_ -]+", " ", match.group(1)).upper()
    return "unlabeled"

async def _probe_entities(hass: HomeAssistant, entities: list[dict]) -> list[dict]:
    """Sample HA live meter entities so channel activity is observed, not guessed."""
    samples = {e["entity_id"]: [] for e in entities}
    started = asyncio.get_running_loop().time()
    while asyncio.get_running_loop().time() - started < 30:
        now = asyncio.get_running_loop().time()
        for entity in entities:
            state = hass.states.get(entity["entity_id"])
            value = _number(state) if state is not None else None
            samples[entity["entity_id"]].append((now, value, state.state if state is not None else "unavailable"))
        await asyncio.sleep(2)
    results = []
    for entity in entities:
        series = samples[entity["entity_id"]]
        numeric = [x[1] for x in series if x[1] is not None]
        if not numeric:
            status = "unavailable"
        else:
            peak = max(abs(v) for v in numeric)
            span = max(numeric) - min(numeric)
            threshold = {"power": 1.0, "current": 0.02, "voltage": 5.0, "energy": 0.0001}.get(entity["kind"], 0.0)
            status = "active signal" if peak > threshold or span > threshold else "reporting zero"
        results.append({"entity_id": entity["entity_id"], "name": entity["name"], "kind": entity["kind"], "unit": entity["unit"], "channel": _channel_label(entity), "samples": len(series), "numeric_samples": len(numeric), "min": min(numeric) if numeric else None, "max": max(numeric) if numeric else None, "range": (max(numeric)-min(numeric)) if numeric else None, "status": status})
    return results
_DEVICE_EXCLUDE_WORDS = (
    "plug", "smart plug", "outlet", "switch", "dishwasher", "refrigerator",
    "fridge", "washer", "dryer", "oven", "range", "microwave", "television",
    "tv", "lamp", "light", "fan", "thermostat", "climate",
)

def _is_meter_candidate(device, entities: list[dict], config_entries: list[dict], score: int) -> bool:
    """Require meter-like evidence; ordinary loads are not meter candidates."""
    text = " ".join([
        str(device.name or ""),
        str(device.name_by_user or ""),
        str(device.manufacturer or ""),
        str(device.model or ""),
        " ".join(e["name"] for e in entities),
        " ".join(e["entity_id"] for e in entities),
        " ".join(f"{c['domain']} {c['title']}" for c in config_entries),
    ]).casefold()
    tokens = _tokens(text)
    explicit_meter = bool(tokens & set(_HOME_WORDS)) or bool(tokens & set(_METER_BRANDS))
    excluded_load = any(word in text for word in _DEVICE_EXCLUDE_WORDS)

    kinds = {e["kind"] for e in entities}
    power_count = sum(1 for e in entities if e["kind"] == "power")
    energy_count = sum(1 for e in entities if e["kind"] == "energy")
    voltage_count = sum(1 for e in entities if e["kind"] == "voltage")
    current_count = sum(1 for e in entities if e["kind"] == "current")

    meter_domain = any(
        c["domain"].casefold() in {"shelly", "emporia", "sense", "homewizard", "iotawatt", "smappee"}
        for c in config_entries
    )
    meter_model = "3em" in text or "energy meter" in text or "power meter" in text

    strong_measurement_set = (
        ("power" in kinds and energy_count > 0)
        or voltage_count > 0
        or current_count > 0
        or power_count >= 3
    )

    if meter_model and ("power" in kinds or "energy" in kinds):
        return True
    if meter_domain and strong_measurement_set and not (excluded_load and power_count < 2):
        return True
    if explicit_meter and strong_measurement_set and not excluded_load:
        return True
    return False


def _meter_class(device, entities: list[dict], config_entries: list[dict]) -> str:
    """Classify the quality/depth of an electrical measurement source."""
    kinds = {e["kind"] for e in entities}
    text = " ".join([
        str(device.name or ""), str(device.name_by_user or ""),
        str(device.manufacturer or ""), str(device.model or ""),
        " ".join(e["name"] for e in entities),
        " ".join(f"{x['domain']} {x['title']}" for x in config_entries),
    ]).casefold()
    if any(word in text for word in ("battery", "smoke detector", "smoke alarm")) and not (kinds & {"power", "energy", "voltage", "current"}):
        return "D"
    power_count = sum(1 for e in entities if e["kind"] == "power")
    energy_count = sum(1 for e in entities if e["kind"] == "energy")
    voltage_count = sum(1 for e in entities if e["kind"] == "voltage")
    current_count = sum(1 for e in entities if e["kind"] == "current")
    text = " ".join([
        str(device.name or ""), str(device.name_by_user or ""),
        str(device.manufacturer or ""), str(device.model or ""),
        " ".join(e["name"] for e in entities),
        " ".join(f"{x['domain']} {x['title']}" for x in config_entries),
    ]).casefold()
    if power_count >= 3 or (voltage_count >= 2 and current_count >= 2):
        return "A"
    if "power" in kinds and energy_count > 0:
        return "B"
    if "power" in kinds or "energy" in kinds or current_count or voltage_count:
        return "C"
    return "D"


def discover_meters(hass: HomeAssistant) -> dict:
    registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    candidates = []

    device_entities: dict[str, list] = {}
    unattached = []
    for entity in entity_registry.entities.values():
        if entity.disabled_by is not None or entity.domain != "sensor":
            continue
        state = hass.states.get(entity.entity_id)
        if state is None or _kind(state) is None:
            continue
        if entity.device_id:
            device_entities.setdefault(entity.device_id, []).append(entity)
        else:
            unattached.append(entity)

    for device_id, registry_entities in device_entities.items():
        device = registry.async_get(device_id)
        if device is None:
            continue
        # Only show devices with at least one electrical measurement.
        entities = []
        config_entries = []
        seen_configs = set()
        for entity in registry_entities:
            state = hass.states.get(entity.entity_id)
            if state is None:
                continue
            attrs = state.attributes
            kind = _kind(state)
            if kind is None:
                continue
            entities.append({
                "entity_id": entity.entity_id,
                "name": str(attrs.get("friendly_name") or entity.name or entity.entity_id),
                "domain": entity.domain,
                "kind": kind,
                "device_class": attrs.get("device_class"),
                "unit": attrs.get("unit_of_measurement"),
                "state_class": attrs.get("state_class"),
                "state": state.state,
                "value": _number(state),
            })
            for info in _config_info(hass, entity):
                if info["entry_id"] not in seen_configs:
                    seen_configs.add(info["entry_id"])
                    config_entries.append(info)

        score, evidence = _score_device(device, entities, config_entries)

        candidates.append({
            "device_id": device.id,
            "name": device.name_by_user or device.name or device.model or device.id,
            "manufacturer": device.manufacturer or "",
            "model": device.model or "",
            "sw_version": device.sw_version or "",
            "hw_version": device.hw_version or "",
            "area_id": device.area_id or "",
            "identifiers": [[str(a), str(b)] for a, b in sorted(device.identifiers)],
            "connections": [[str(a), str(b)] for a, b in sorted(device.connections)],
            "config_entries": config_entries,
            "entities": sorted(entities, key=lambda x: (x["kind"], x["name"].casefold())),
            "score": score,
            "meter_class": _meter_class(device, entities, config_entries),
            "evidence": evidence,
            "inference": _infer_electrical_system(device, entities),
        })

def _physical_group_key(candidate: dict) -> tuple[str, str, str]:
    """Build a conservative logical-source key for HA device records.

    HA can expose one physical meter as several device records. Prefer an
    explicit physical serial-like identity for known multi-channel meters;
    otherwise normalize only obvious channel suffixes and require the same
    manufacturer/model/name family.
    """
    manufacturer = str(candidate["manufacturer"]).casefold().strip()
    model = str(candidate["model"]).casefold().strip()
    name = str(candidate["name"]).casefold().strip()

    # Shelly Pro 3EM channel records commonly retain the same physical
    # device serial in the generated name. Group those records even when HA
    # appends a channel/phase suffix to the device name.
    shelly_3em = re.search(r"(shellypro3em[-_][0-9a-f]{12})", name)
    if "shelly" in manufacturer and ("3em" in model or "3em" in name) and shelly_3em:
        return (manufacturer, model, shelly_3em.group(1))

    normalized = re.sub(r"[._-]+", " ", name)
    normalized = re.sub(r"\b(?:phase|channel|ch|l)\s*[123]\b", "", normalized)
    normalized = re.sub(r"\b[abc]\b$", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return (manufacturer, model, normalized)


    # Group HA device records that represent the same physical electrical source.
    # A physical meter can appear as multiple HA device records for channels.
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for candidate in candidates:
        grouped.setdefault(_physical_group_key(candidate), []).append(candidate)

    merged_candidates = []
    for members in grouped.values():
        if len(members) == 1:
            item = members[0]
            item["group_id"] = item["device_id"]
            item["member_device_ids"] = [item["device_id"]]
            merged_candidates.append(item)
            continue

        primary = members[0]
        all_entities = []
        all_configs = []
        member_ids = []
        evidence = []
        seen_entities = set()
        seen_configs = set()
        for member in members:
            member_ids.append(member["device_id"])
            for entity in member["entities"]:
                if entity["entity_id"] not in seen_entities:
                    seen_entities.add(entity["entity_id"])
                    all_entities.append(entity)
            for config in member["config_entries"]:
                if config["entry_id"] not in seen_configs:
                    seen_configs.add(config["entry_id"])
                    all_configs.append(config)
            for note in member["evidence"]:
                if note not in evidence:
                    evidence.append(note)

        score = max(member["score"] for member in members)
        if len([e for e in all_entities if e["kind"] == "power"]) >= 3:
            score += 3
            if "multiple power channels" not in evidence:
                evidence.append("multiple power channels")

        group_id = "group:" + primary["device_id"]
        group_device = SimpleNamespace(
            name=primary["name"], name_by_user=primary["name"],
            manufacturer=primary["manufacturer"], model=primary["model"],
        )
        merged_candidates.append({
            **primary,
            "device_id": group_id,
            "group_id": group_id,
            "member_device_ids": member_ids,
            "config_entries": all_configs,
            "entities": sorted(all_entities, key=lambda x: (x["kind"], x["name"].casefold(), x["entity_id"])),
            "score": score,
            "meter_class": _meter_class(group_device, all_entities, all_configs),
            "evidence": evidence + [f"{len(members)} HA device records grouped as one physical source"],
            "inference": _infer_electrical_system(group_device, all_entities),
        })

    candidates = merged_candidates
    candidates.sort(key=lambda x: (-x["score"], x["name"].casefold()))

    unattached_rows = []
    for entity in unattached:
        state = hass.states.get(entity.entity_id)
        if state is None:
            continue
        kind = _kind(state)
        if kind is None:
            continue
        unattached_rows.append({
            "entity_id": entity.entity_id,
            "name": str(state.attributes.get("friendly_name") or entity.name or entity.entity_id),
            "kind": kind,
            "unit": state.attributes.get("unit_of_measurement"),
            "state": state.state,
        })

    return {
        "candidate_count": len(candidates),
        "candidates": candidates[:20],
        "unattached": unattached_rows[:100],
        "analysis_notes": [
            "This diagnostic uses Home Assistant's device registry, entity registry, entity metadata, current states, and config-entry/integration metadata.",
            "It does not connect directly to a Shelly device or make network/API calls to the meter.",
            "A Shelly Pro 3EM model plus its voltage/power channel set can provide strong clues, but service topology such as split-phase versus three-phase is not always provable from HA metadata alone.",
        ],
    }


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/meter_detector",
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_meter_detector(hass: HomeAssistant, connection, msg) -> None:
    """Return a non-destructive whole-home meter discovery report."""
    try:
        result = discover_meters(hass)
    except Exception as err:
        result = {
            "candidate_count": 0,
            "candidates": [],
            "unattached": [],
            "analysis_notes": ["Detector backend exception"],
            "error": f"{type(err).__name__}: {err}",
        }
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/meter_detector_probe",
    vol.Optional("device_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_meter_detector_probe(hass: HomeAssistant, connection, msg) -> None:
    """Interrogate the selected meter channels for a short live window."""
    report = discover_meters(hass)
    candidates = report.get("candidates", [])
    device_id = msg.get("device_id")
    candidate = next((c for c in candidates if c.get("group_id", c["device_id"]) == device_id or c["device_id"] == device_id), None) if device_id else (candidates[0] if candidates else None)
    if candidate is None:
        raise ValueError("No meter candidate is available to interrogate")
    probe = await _probe_entities(hass, candidate["entities"])
    by_channel = {}
    for row in probe:
        channel = row["channel"]
        item = by_channel.setdefault(channel, {"channel": channel, "entities": [], "active": False, "reporting": False})
        item["entities"].append(row)
        item["reporting"] = item["reporting"] or row["numeric_samples"] > 0
        item["active"] = item["active"] or row["status"] == "active signal"
    channels = list(by_channel.values())
    for item in channels:
        item["assessment"] = ("likely populated / carrying measurable signal" if item["active"] else "reporting, but zero during the probe — cannot prove CT is absent" if item["reporting"] else "not reporting during the probe")
    active_channels = sum(1 for x in channels if x["active"])
    connection.send_result(msg["id"], {"device_id": candidate["device_id"], "device_name": candidate["name"], "model": candidate["model"], "probe_seconds": 30, "sample_interval_seconds": 2, "channels": channels, "active_channel_count": active_channels, "channel_count_observed": len(channels), "conclusion": f"{active_channels} channel(s) showed measurable activity during the 30-second probe. Channel count is reported separately from electrical topology; an exposed CT input is not treated as a phase.", "limitations": ["A populated CT with no load can look exactly like an unused CT during a quiet window.", "A channel is labeled likely populated only when HA reports a measurable signal; zero-only channels remain indeterminate.", "This probe interrogates Home Assistant live entity state. It does not directly call the Shelly network API."]})

def async_register(hass: HomeAssistant) -> None:
    """Register the detector WebSocket command."""
    websocket_api.async_register_command(hass, ws_meter_detector)
