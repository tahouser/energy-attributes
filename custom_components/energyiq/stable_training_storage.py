"""Stable persistence bridge for EnergyIQ learned training data.

Home Assistant config-entry IDs can change when an integration is removed and
re-added.  Learned EnergyIQ data must therefore live under a stable Store key.
This module bridges the existing entry-scoped Store to one common Store without
requiring a destructive migration of existing installations.
"""
from __future__ import annotations

from functools import wraps
from typing import Any, Awaitable, Callable

from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
STABLE_STORAGE_KEY = f"{DOMAIN}.training"


async def prepare_training_storage(coordinator: Any) -> None:
    """Migrate/seed training storage and keep the stable store synchronized.

    Existing installations have learned data in the legacy key
    ``energyiq.training.<entry_id>``.  On first run, that data is copied to the
    stable key ``energyiq.training``.  On later installs, the stable data is
    copied into the newly-created entry-scoped store so the existing coordinator
    loading code remains compatible.
    """
    stable_store = Store(coordinator.hass, STORAGE_VERSION, STABLE_STORAGE_KEY, private=True)
    stable_data = await stable_store.async_load()

    if not isinstance(stable_data, dict):
        legacy_data = await coordinator._store.async_load()
        if isinstance(legacy_data, dict):
            stable_data = legacy_data
            await stable_store.async_save(stable_data)
    else:
        # Seed the current entry-scoped store so the existing loader sees the
        # same learned data even if Home Assistant assigned a new entry_id.
        await coordinator._store.async_save(stable_data)

    original_persist = coordinator._persist

    @wraps(original_persist)
    async def persist_with_stable_store(force: bool = False) -> None:
        await original_persist(force=force)
        if force or coordinator._last_persist:
            await stable_store.async_save(
                {
                    "training_state": coordinator.training_state,
                    "training_samples": coordinator.training_samples,
                    "last_training_device_id": coordinator.last_training_device_id,
                    "active": coordinator.training_state.get(coordinator._training_device)
                    if coordinator._training_device
                    else None,
                }
            )

    coordinator._persist = persist_with_stable_store
    coordinator._stable_training_store = stable_store
