"""Persistent commissioning state for EnergyIQ."""
from __future__ import annotations

from typing import Any

from homeassistant.helpers.storage import Store

from .const import CONF_MONITORED_ENTITIES, DOMAIN

STORE_VERSION = 1


def _store(hass, entry_id: str) -> Store:
    return Store(hass, STORE_VERSION, f"{DOMAIN}.commissioning.{entry_id}", private=True)


def _monitored_entity_ids(coordinator) -> list[str]:
    """Rebuild the derived monitored entity list from monitored device IDs."""
    result: list[str] = []
    seen: set[str] = set()
    for did, candidate in coordinator.candidate_devices.items():
        if coordinator.device_classifications.get(did, "ignore") != "monitor":
            continue
        measurements = candidate.get("measurements", []) or []
        controls = candidate.get("controls", []) or []
        for item in [*measurements, *controls]:
            entity_id = item.get("entity_id") if isinstance(item, dict) else None
            if entity_id and entity_id not in seen:
                seen.add(entity_id)
                result.append(entity_id)
    return result


def _monitored_device_ids(coordinator) -> list[str]:
    return [
        did for did in coordinator.candidate_devices
        if coordinator.device_classifications.get(did, "ignore") == "monitor"
    ]


def _payload(coordinator) -> dict[str, Any]:
    return {
        "version": STORE_VERSION,
        "monitored_devices": _monitored_device_ids(coordinator),
        "training_state": coordinator.training_state,
        "training_samples": coordinator.training_samples,
        "last_training_device_id": coordinator.last_training_device_id,
    }


def _option_monitored_devices(coordinator) -> list[str]:
    """Recover monitored device IDs from the pre-3.1.84 ConfigEntry state."""
    classifications = coordinator.entry.options.get("device_classifications")
    if isinstance(classifications, dict):
        selected = [
            did for did, value in classifications.items()
            if value == "monitor" and did in coordinator.candidate_devices
        ]
        if selected:
            return selected

    monitored_entities = coordinator.entry.options.get(CONF_MONITORED_ENTITIES)
    if not isinstance(monitored_entities, list) or not monitored_entities:
        return []
    monitored_set = {str(entity_id) for entity_id in monitored_entities}
    selected: list[str] = []
    for did, candidate in coordinator.candidate_devices.items():
        measurements = candidate.get("measurements", []) or []
        controls = candidate.get("controls", []) or []
        attached = [*measurements, *controls]
        if any(
            isinstance(item, dict) and item.get("entity_id") in monitored_set
            for item in attached
        ):
            selected.append(did)
    return selected


async def async_load(coordinator) -> bool:
    """Load commissioning state after candidate discovery.

    A missing store is seeded from the existing v3.1.79 ConfigEntry state.
    An existing store with an empty monitored list is not allowed to erase a
    still-valid v3.1.79 configuration; this is important when recovering from
    an interrupted upgrade. Training state is similarly merged with the
    surviving legacy training Store when the new record is empty.
    """
    saved = await _store(coordinator.hass, coordinator.entry.entry_id).async_load()
    option_devices = _option_monitored_devices(coordinator)
    option_training = coordinator.training_state
    option_samples = coordinator.training_samples

    if not isinstance(saved, dict):
        if option_devices:
            monitored_set = set(option_devices)
            coordinator.device_classifications = {
                did: "monitor" if did in monitored_set else "ignore"
                for did in coordinator.candidate_devices
            }
            coordinator.monitored_entities = _monitored_entity_ids(coordinator)
        await async_save(coordinator)
        return False

    saved_monitored = saved.get("monitored_devices")
    if isinstance(saved_monitored, list) and saved_monitored:
        monitored_set = {str(did) for did in saved_monitored}
        coordinator.device_classifications = {
            did: "monitor" if did in monitored_set else "ignore"
            for did in coordinator.candidate_devices
        }
        coordinator.monitored_entities = _monitored_entity_ids(coordinator)
    elif option_devices:
        # Never let a stale empty store erase valid existing commissioning.
        monitored_set = set(option_devices)
        coordinator.device_classifications = {
            did: "monitor" if did in monitored_set else "ignore"
            for did in coordinator.candidate_devices
        }
        coordinator.monitored_entities = _monitored_entity_ids(coordinator)

    saved_training = saved.get("training_state")
    if isinstance(saved_training, dict) and saved_training:
        coordinator.training_state = saved_training
    elif option_training:
        coordinator.training_state = option_training

    saved_samples = saved.get("training_samples")
    if isinstance(saved_samples, dict) and saved_samples:
        coordinator.training_samples = saved_samples
    elif option_samples:
        coordinator.training_samples = option_samples

    last_training_device_id = saved.get("last_training_device_id")
    if isinstance(last_training_device_id, str) or last_training_device_id is None:
        if last_training_device_id is not None or not coordinator.last_training_device_id:
            coordinator.last_training_device_id = last_training_device_id

    # If recovery used the legacy options, immediately replace the empty/stale
    # commissioning record with the recovered state. This is the only startup
    # write and happens after candidate discovery is complete.
    if option_devices and (not isinstance(saved_monitored, list) or not saved_monitored):
        await async_save(coordinator)
    elif (not isinstance(saved_training, dict) or not saved_training) and option_training:
        await async_save(coordinator)
    return True


async def async_save(coordinator) -> None:
    """Save only user-owned monitored/training commissioning state."""
    await _store(coordinator.hass, coordinator.entry.entry_id).async_save(_payload(coordinator))
