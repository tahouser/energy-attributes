"""Pure, side-effect-free HA Device Intelligence discriminator.

This module consumes the normalized evidence produced by the standalone analyzer.
It deliberately does not call Home Assistant or EnergyIQ.
"""
from __future__ import annotations

import re

SCHEMA = "ha-device-intelligence-v2"
CONTROL_DOMAINS = {"light", "switch", "fan", "climate", "humidifier", "media_player", "vacuum", "water_heater", "cover", "valve", "number"}

POSITIVE_AGGREGATE_TERMS = {
    "total": 18, "aggregate": 18, "whole": 18, "home": 14, "house": 14,
    "system": 12, "consumption": 12, "usage": 8, "active_power": 12,
    "power_flow": 12, "demand": 6,
}
NEGATIVE_PHASE_TERMS = {
    "phase_a": -28, "phase_b": -28, "phase_c": -28,
    "phase_1": -28, "phase_2": -28, "phase_3": -28,
    "l1": -28, "l2": -28, "l3": -28,
    "channel_1": -24, "channel_2": -24, "channel_3": -24,
    "energy_meter_0": -24, "energy_meter_1": -24, "energy_meter_2": -24,
}
EXPORT_TERMS = {"export", "returned", "return", "production", "solar", "generation"}
IMPORT_TERMS = {"import", "consumption", "usage"}
METER_TERMS = {"meter", "energy_meter", "3em", "p1", "dsmr", "powerfox", "homewizard", "iammeter", "eastron", "sdm630", "discovergy", "inexogy"}


def _norm(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")


def _text(entity):
    return " ".join(_norm(entity.get(k)) for k in ("entity_id", "name", "friendly_name"))


def source_entities(entity):
    attrs = entity.get("current_state", {}).get("attributes", {}) or {}
    out = attrs.get("entity_id") or attrs.get("source_entity_ids") or attrs.get("source_entities") or []
    if isinstance(out, str):
        out = [out]
    return [x for x in out if isinstance(x, str) and "." in x]


def _same_meter_family(source_rows, entity_by_id):
    devices = []
    for sid in source_rows:
        e = entity_by_id.get(sid)
        if not e:
            continue
        devices.append((e.get("device_id"), e.get("platform"), _norm(e.get("name"))))
    if len(devices) < 2:
        return False
    ids = {x[0] for x in devices if x[0]}
    platforms = {x[1] for x in devices if x[1]}
    source_ids = [_norm(entity_by_id.get(sid, {}).get("entity_id")) for sid in source_rows]
    if len(ids) >= 2 and len(platforms) == 1 and source_ids and all(
        any(t in n for t in METER_TERMS) for n in source_ids
    ):
        return True
    return len(ids) == 1 and len(ids) > 0


def score_whole_home_power(entity, entity_by_id):
    if entity.get("measurement_class") != "power":
        return None
    if entity.get("platform") == "energyiq":
        return {"score": -999, "role": "excluded", "reasons": ["EnergyIQ-created entity; not an initial-install source"]}

    text = _text(entity)
    score = 35
    reasons = ["power measurement"]
    attrs = entity.get("current_state", {}).get("attributes", {}) or {}
    if attrs.get("device_class") == "power":
        score += 8
        reasons.append("device_class=power")
    if attrs.get("state_class") == "measurement":
        score += 5
        reasons.append("state_class=measurement")

    for term, points in POSITIVE_AGGREGATE_TERMS.items():
        if term in text:
            score += points
            reasons.append(f"aggregate term: {term}")
    for term, points in NEGATIVE_PHASE_TERMS.items():
        if term in text:
            score += points
            reasons.append(f"phase/channel term: {term}")

    sources = source_entities(entity)
    if len(sources) >= 2:
        score += 12
        reasons.append(f"derived from {len(sources)} source entities")
        if _same_meter_family(sources, entity_by_id):
            score += 22
            reasons.append("source entities form a common meter family")
    if entity.get("device_id") is None and not sources:
        score -= 8
        reasons.append("no device relationship or source list")

    role = "whole_home_power_candidate" if score >= 70 else "power_candidate_review"
    return {"score": score, "role": role, "reasons": reasons, "source_entities": sources}


def _meter_like_entity(entity):
    text = _text(entity)
    if any(t in text for t in {"whole_home", "whole_house", "house_energy", "home_energy", "grid_import", "grid_consumption"}):
        return True
    if entity.get("device_id") and any(t in text for t in METER_TERMS):
        return True
    return (
        not entity.get("device_id")
        and entity.get("platform") in {"template", "integration", "utility_meter"}
        and any(t in text for t in {"house", "home", "whole", "grid"})
    )


def score_whole_home_energy(entity, entity_by_id):
    if entity.get("measurement_class") != "energy":
        return None
    if entity.get("platform") == "energyiq":
        return {"score": -999, "role": "excluded", "reasons": ["EnergyIQ-created entity; not an initial-install source"]}

    text = _text(entity)
    score = 25
    reasons = ["energy measurement"]
    attrs = entity.get("current_state", {}).get("attributes", {}) or {}
    if attrs.get("device_class") == "energy":
        score += 8
        reasons.append("device_class=energy")
    if attrs.get("state_class") in {"total", "total_increasing"}:
        score += 8
        reasons.append(f"state_class={attrs.get('state_class')}")
    for term in IMPORT_TERMS:
        if term in text:
            score += 10
            reasons.append(f"consumption term: {term}")
    for term in EXPORT_TERMS:
        if term in text:
            score -= 24
            reasons.append(f"generation/export term: {term}")
    for term, points in POSITIVE_AGGREGATE_TERMS.items():
        if term in text:
            score += min(points, 12)
            reasons.append(f"aggregate term: {term}")

    meter_like = _meter_like_entity(entity)
    if meter_like:
        score += 20
        reasons.append("whole-home/meter semantic")
    elif entity.get("device_id") is not None:
        score -= 25
        reasons.append("device-bound energy meter is more likely a device load")

    role = "whole_home_energy_candidate" if score >= 50 and meter_like else "energy_candidate_review"
    return {"score": score, "role": role, "reasons": reasons}


def classify_device(device, entity_by_id):
    ids = device.get("entities", [])
    entities = [entity_by_id[eid] for eid in ids if eid in entity_by_id]
    power = [e for e in entities if e.get("measurement_class") == "power" and e.get("platform") != "energyiq"]
    energy = [e for e in entities if e.get("measurement_class") == "energy" and e.get("platform") != "energyiq"]
    domains = {e.get("domain") for e in entities}
    control = sorted(d for d in domains if d in CONTROL_DOMAINS)
    meter_words = _text(device)

    whole_home_like = any(
        (score_whole_home_power(e, entity_by_id) or {}).get("role") == "whole_home_power_candidate"
        for e in power
    )
    if whole_home_like:
        method = "system_meter"
    elif any(t in meter_words for t in METER_TERMS):
        method = "review"
    elif power:
        method = "auto_train"
    elif control:
        method = "quick"
    else:
        method = "manual"

    return {
        "device_id": device.get("device_id"),
        "name": device.get("name"),
        "manufacturer": device.get("manufacturer"),
        "model": device.get("model"),
        "area": device.get("area"),
        "measurement": {
            "power": [e.get("entity_id") for e in power],
            "energy": [e.get("entity_id") for e in energy],
        },
        "control_domains": control,
        "training_method": method,
    }


def discriminate(report):
    entities = report.get("entities", [])
    devices = report.get("devices", [])
    entity_by_id = {e.get("entity_id"): e for e in entities if e.get("entity_id")}

    power = []
    energy = []
    for entity in entities:
        if entity.get("measurement_class") == "power":
            assessment = score_whole_home_power(entity, entity_by_id)
            if assessment and assessment.get("role") != "excluded":
                power.append({"entity_id": entity.get("entity_id"), **assessment})
        elif entity.get("measurement_class") == "energy":
            assessment = score_whole_home_energy(entity, entity_by_id)
            if assessment and assessment.get("role") != "excluded":
                energy.append({"entity_id": entity.get("entity_id"), **assessment})

    power.sort(key=lambda x: x["score"], reverse=True)
    energy.sort(key=lambda x: x["score"], reverse=True)
    device_assessments = [classify_device(device, entity_by_id) for device in devices]

    secondary = {"grid_import": [], "grid_export": [], "generation": [], "storage": []}
    for entity in entities:
        text = _text(entity)
        if entity.get("measurement_class") not in {"power", "energy"}:
            continue
        if "import" in text:
            secondary["grid_import"].append(entity.get("entity_id"))
        if any(t in text for t in {"export", "returned", "return"}):
            secondary["grid_export"].append(entity.get("entity_id"))
        if any(t in text for t in {"solar", "production", "generation"}):
            secondary["generation"].append(entity.get("entity_id"))
        if any(t in text for t in {"battery", "storage", "charge", "discharge"}):
            secondary["storage"].append(entity.get("entity_id"))

    return {
        "schema": SCHEMA,
        "discriminator": "deterministic-evidence-v1",
        "whole_home": {
            "power_candidates": power,
            "energy_candidates": energy,
            "selected_power": power[0]["entity_id"] if power and power[0]["role"] == "whole_home_power_candidate" else None,
            "selected_energy": energy[0]["entity_id"] if energy and energy[0]["role"] == "whole_home_energy_candidate" else None,
        },
        "secondary_energy_sources": secondary,
        "device_assessments": device_assessments,
        "user_decision_required": True,
        "raw_evidence_preserved": True,
    }
