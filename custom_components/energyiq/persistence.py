"""Persistent commissioning state for EnergyIQ.

This store is intentionally separate from ConfigEntry.options and from the
Recorder database. It contains only the user-owned commissioning state that
must survive integration code/HACS updates: monitored device IDs and training
state.
"""
from __future__ import annotations

from typing import Any

from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORE_VERSION = 1


def _store(hass, entry_id: str) -> Store:
    return Store(hass, STORE_VERSION, f"{DOMAIN}.commissioning.{entry_id}", private=True)


def _monitored_entity_ids(coordinator) -> list[str]:
    """Rebuild the derived monitored entity list from persisted device IDs."""
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


def _payload(coordinator) -> dict[str, Any]:
    monitored_devices = [
        did
        for did in coordinator.candidate_devices
        if coordinator.device_classifications.get(did, "ignore") == "monitor"
    ]
    return {
        "version": STORE_VERSION,
        "monitored_devices": monitored_devices,
        "training_state": coordinator.training_state,
        "training_samples": coordinator.training_samples,
        "last_training_device_id": coordinator.last_training_device_id,
    }


async def async_load(coordinator) -> bool:
    """Load the isolated commissioning store into the coordinator.

    Returns True when a persisted commissioning record exists. A missing store
    is deliberately treated as a first-run migration from the v3.1.79 state.
    """
    saved = await _store(coordinator.hass, coordinator.entry.entry_id).async_load()
    if not isinstance(saved, dict):
        await async_save(coordinator)
        return False

    monitored = saved.get("monitored_devices")
    if isinstance(monitored, list):
        monitored_set = {str(did) for did in monitored}
        coordinator.device_classifications = {
            did: "monitor" if did in monitored_set else "ignore"
            for did in coordinator.candidate_devices
        }
        coordinator.monitored_entities = _monitored_entity_ids(coordinator)

    training_state = saved.get("training_state")
    if isinstance(training_state, dict):
        coordinator.training_state = training_state

    training_samples = saved.get("training_samples")
    if isinstance(training_samples, dict):
        coordinator.training_samples = training_samples

    last_training_device_id = saved.get("last_training_device_id")
    if isinstance(last_training_device_id, str) or last_training_device_id is None:
        coordinator.last_training_device_id = last_training_device_id

    return True


async def async_save(coordinator) -> None:
    """Save only monitored/trained commissioning state."""
    await _store(coordinator.hass, coordinator.entry.entry_id).async_save(_payload(coordinator))
