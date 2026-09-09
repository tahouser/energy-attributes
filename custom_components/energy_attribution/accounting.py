"""EnergyIQ accounting extensions: reference maximum and load-coverage metrics."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api

from .const import DOMAIN


def _coordinator(hass, entry_id):
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None:
        raise LookupError("Energy Attribution config entry not found")
    coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
    if coordinator is None:
        raise LookupError("Energy Attribution config entry is not loaded")
    return coordinator


def _learned_capacity(coordinator) -> float:
    total = 0.0
    for did in coordinator.candidate_devices:
        if coordinator.device_classifications.get(did, "ignore") != "monitor":
            continue
        state = coordinator.training_state.get(did, {})
        if state.get("status") != "complete":
            continue
        sig = state.get("learned_signature") or {}
        try:
            watts = float(sig.get("load_w"))
        except (TypeError, ValueError):
            continue
        if watts > 0:
            total += watts
    return total


def _current_home_power(hass, coordinator):
    state = hass.states.get(coordinator.power_entity)
    if state is None:
        return None
    try:
        value = float(state.state)
    except (TypeError, ValueError):
        return None
    return max(0.0, value)


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/accounting_state",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_accounting_state(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    current = _current_home_power(hass, coordinator)
    options = coordinator.entry.options
    reference = options.get("reference_max_w")
    observed = options.get("observed_peak_w")
    try:
        reference = float(reference) if reference is not None else None
    except (TypeError, ValueError):
        reference = None
    try:
        observed = float(observed) if observed is not None else None
    except (TypeError, ValueError):
        observed = None

    if current is not None and (observed is None or current > observed):
        observed = current
        hass.config_entries.async_update_entry(
            coordinator.entry,
            options={**coordinator.entry.options, "observed_peak_w": round(observed, 1)},
        )

    learned = _learned_capacity(coordinator)
    mystery = max(0.0, reference - learned) if reference is not None else None
    coverage = (learned / reference * 100.0) if reference and reference > 0 else None
    connection.send_result(msg["id"], {
        "reference_max_w": reference,
        "observed_peak_w": observed,
        "learned_capacity_w": learned,
        "mystery_w": mystery,
        "training_coverage_pct": min(100.0, max(0.0, coverage)) if coverage is not None else None,
    })


@websocket_api.websocket_command({
    vol.Required("type"): "energy_attribution/set_reference_max",
    vol.Required("entry_id"): str,
    vol.Required("reference_max_w"): vol.Coerce(float),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_set_reference_max(hass, connection, msg):
    coordinator = _coordinator(hass, msg["entry_id"])
    value = float(msg["reference_max_w"])
    if value <= 0 or value > 1_000_000:
        raise ValueError("Reference maximum must be between 1 W and 1,000,000 W")
    hass.config_entries.async_update_entry(
        coordinator.entry,
        options={**coordinator.entry.options, "reference_max_w": round(value, 1)},
    )
    connection.send_result(msg["id"], {"saved": True, "reference_max_w": round(value, 1)})


def async_register(hass) -> None:
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("_accounting_registered"):
        return
    websocket_api.async_register_command(hass, ws_accounting_state)
    websocket_api.async_register_command(hass, ws_set_reference_max)
    data["_accounting_registered"] = True
