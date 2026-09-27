"""Persistent EnergyIQ-owned data independent of config-entry identity."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
SCHEMA_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.persistent"


def get_store(hass) -> Store[dict[str, Any]]:
    """Return the single persistent EnergyIQ data store."""
    return Store(hass, STORAGE_VERSION, STORAGE_KEY, private=True)


def migrate_snapshot(saved: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize a stored snapshot and provide an explicit schema boundary."""
    if not isinstance(saved, dict):
        return None

    snapshot = deepcopy(saved)
    version = int(snapshot.get("schema_version", 0))

    # Version 0 was the pre-schema format introduced by the first persistent
    # store implementation. Its fields are already compatible with v1.
    if version == 0:
        snapshot["schema_version"] = SCHEMA_VERSION
        return snapshot

    if version == SCHEMA_VERSION:
        return snapshot

    raise ValueError(f"Unsupported EnergyIQ persistence schema: {version}")


def build_snapshot(coordinator) -> dict[str, Any]:
    """Build the canonical persisted representation of EnergyIQ state."""
    return {
        "schema_version": SCHEMA_VERSION,
        "power_entity": coordinator.power_entity,
        "options": deepcopy(dict(coordinator.entry.options)),
        "candidate_devices": deepcopy(coordinator.candidate_devices),
        "device_classifications": deepcopy(coordinator.device_classifications),
        "commissioned_devices": deepcopy(coordinator.commissioned_devices),
        "monitored_entities": deepcopy(coordinator.monitored_entities),
        "training_state": deepcopy(coordinator.training_state),
        "training_samples": deepcopy(coordinator.training_samples),
        "last_training_device_id": coordinator.last_training_device_id,
    }


def build_entry_data(snapshot: dict[str, Any], power_entity: str | None = None) -> dict[str, Any]:
    """Build config-entry data used when restoring a saved EnergyIQ workspace."""
    selected_power = power_entity or snapshot.get("power_entity")
    options = dict(snapshot.get("options") or {})
    return {
        "power_entity": selected_power,
        "candidate_devices": deepcopy(snapshot.get("candidate_devices") or options.get("candidate_devices", {})),
        "monitored_entities": deepcopy(snapshot.get("monitored_entities") or options.get("monitored_entities", [])),
        "device_classifications": deepcopy(snapshot.get("device_classifications") or options.get("device_classifications", {})),
        "commissioned_devices": deepcopy(snapshot.get("commissioned_devices") or options.get("commissioned_devices", {})),
    }


def has_saved_data(snapshot: dict[str, Any] | None) -> bool:
    """Return True when the store contains a meaningful EnergyIQ workspace."""
    if not snapshot:
        return False
    return any(
        snapshot.get(key)
        for key in (
            "candidate_devices",
            "device_classifications",
            "commissioned_devices",
            "training_state",
            "training_samples",
        )
    )
