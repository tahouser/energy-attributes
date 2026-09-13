"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

import asyncio

from homeassistant.config_entries import ConfigEntry
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import EnergyAttributionCoordinator
from .websocket import async_register as async_register_websocket
from .accounting import async_register as async_register_accounting
from .response_migration import migrate_response_log

PLATFORMS = ["sensor"]
URL_BASE = "/energyiq-static"
FRONTEND_VERSION = "31950"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up EnergyIQ services and the training frontend."""
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
        async_register_accounting(hass)
        data["_websocket_registered"] = True
    if not data.get("_panel_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                URL_BASE,
                hass.config.path("custom_components", DOMAIN, "www"),
                cache_headers=False,
            )
        ])
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path="energyiq",
            webcomponent_name="energyiq-panel-training-v179",
            module_url=f"{URL_BASE}/energyiq-training-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.95",
            sidebar_icon="mdi:lightning-bolt",
            require_admin=True,
        )
        data["_panel_registered"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    response_log_path = migrate_response_log(hass)
    coordinator = EnergyAttributionCoordinator(hass, entry)
    coordinator._response_log_path = response_log_path
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Keep the proven v3.1.79 startup path intact. The commissioning Store is
    # loaded only after the coordinator has discovered its candidate devices.
    await coordinator.async_load_training()
    await coordinator.async_config_entry_first_refresh()

    # Import persistence lazily so an isolated persistence module failure can
    # never prevent Home Assistant from importing EnergyIQ's config flow.
    from .persistence import async_load as async_load_persistence
    from .persistence import async_save as async_save_persistence
    from .bulk_training import async_run as async_run_bulk

    await async_load_persistence(coordinator)

    original_persist = coordinator._persist

    async def persist_with_commissioning_store(force: bool = False):
        await original_persist(force=force)
        if force:
            await async_save_persistence(coordinator)

    coordinator._persist = persist_with_commissioning_store

    # Run bulk training in the background so the websocket returns immediately.
    # The frontend polls bulk_training_state while the worker owns the queue.
    async def start_bulk_training(device_ids: list[str]) -> dict:
        existing = getattr(coordinator, "_bulk_training_task", None)
        if existing and not existing.done():
            raise RuntimeError("Bulk training is already running")
        task = hass.async_create_task(async_run_bulk(coordinator, device_ids))
        coordinator._bulk_training_task = task
        return {
            "status": "running",
            "queue": list(device_ids),
            "current_index": 0,
            "total": len(device_ids),
            "current_device_id": device_ids[0] if device_ids else None,
            "completed": 0,
            "skipped": [],
            "failed": [],
        }

    coordinator.async_bulk_auto_training = start_bulk_training

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator:
        from .persistence import async_save as async_save_persistence
        await async_save_persistence(coordinator)
        bulk_task = getattr(coordinator, "_bulk_training_task", None)
        if bulk_task and not bulk_task.done():
            bulk_task.cancel()
            try:
                await bulk_task
            except asyncio.CancelledError:
                pass
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status") == "active":
                await coordinator.async_stop_training(device_id)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok
