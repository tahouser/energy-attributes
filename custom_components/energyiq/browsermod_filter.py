"""Filter Browser Mod devices out of EnergyIQ's automatic load inventory."""
from __future__ import annotations

from homeassistant.helpers import entity_registry as er


def _candidate_uses_browser_mod(hass, candidate: dict) -> bool:
    """Return True when any entity attached to a candidate belongs to Browser Mod."""
    registry = er.async_get(hass)
    for item in (*candidate.get("measurements", []), *candidate.get("controls", [])):
        entity_id = item.get("entity_id") if isinstance(item, dict) else None
        if not entity_id:
            continue
        entry = registry.async_get(entity_id)
        if entry is None or not entry.config_entry_id:
            continue
        config_entry = hass.config_entries.async_get_entry(entry.config_entry_id)
        if config_entry and config_entry.domain == "browser_mod":
            return True
    return False


def filter_browser_mod_candidates(coordinator) -> int:
    """Remove Browser Mod candidates and persist the filtered inventory."""
    removed = [
        device_id
        for device_id, candidate in list(coordinator.candidate_devices.items())
        if _candidate_uses_browser_mod(coordinator.hass, candidate)
    ]
    if not removed:
        return 0

    for device_id in removed:
        coordinator.candidate_devices.pop(device_id, None)
        coordinator.device_classifications.pop(device_id, None)
        coordinator.training_state.pop(device_id, None)
        coordinator.training_samples.pop(device_id, None)

    coordinator.monitored_entities = [
        entity_id
        for candidate in coordinator.candidate_devices.values()
        for measurement in candidate.get("measurements", [])
        if (entity_id := measurement.get("entity_id"))
    ]
    coordinator.hass.config_entries.async_update_entry(
        coordinator.entry,
        options={
            **coordinator.entry.options,
            "candidate_devices": coordinator.candidate_devices,
            "device_classifications": coordinator.device_classifications,
            "monitored_entities": coordinator.monitored_entities,
        },
    )
    return len(removed)
