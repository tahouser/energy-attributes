"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry, ConfigEntryChange, SIGNAL_CONFIG_ENTRY_CHANGED
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN
from .coordinator import EnergyAttributionCoordinator
from .websocket import async_register as async_register_websocket
from .accounting import async_register as async_register_accounting
from .response_migration import migrate_response_log
from .persistence import async_load as async_load_persistence
from .persistence import async_save as async_save_persistence

PLATFORMS = ["sensor"]
URL_BASE = "/energyiq-static"
FRONTEND_VERSION = "31790"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up EnergyIQ services and the training frontend."""
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
        async_register_accounting(hass)
        data["_websocket_registered"] = True
    if not data.get("_panel_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(URL_BASE, hass.config.path("custom_components", DOMAIN, "www"), cache_headers=False)
        ])
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path="energyiq",
            webcomponent_name="energyiq-panel-training-v179",
            module_url=f"{URL_BASE}/energyiq-training-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.84",
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

    # v3.1.79 remains the functional baseline. Load its existing training
    # Store first, then let the isolated commissioning Store become the source
    # of truth for monitored/trained state. No ConfigEntry options are written
    # during startup.
    await coordinator.async_load_training()
    await async_load_persistence(coordinator)

    original_persist = coordinator._persist
    last_commissioning_persist = 0.0

    async def persist_with_commissioning_store(force: bool = False):
        nonlocal last_commissioning_persist
        await original_persist(force=force)
        now = hass.loop.time()
        if force or now - last_commissioning_persist >= 5.0:
            last_commissioning_persist = now
            await async_save_persistence(coordinator)

    coordinator._persist = persist_with_commissioning_store

    @callback
    def _entry_changed(change: ConfigEntryChange, changed_entry: ConfigEntry) -> None:
        if change is not ConfigEntryChange.UPDATED or changed_entry.entry_id != entry.entry_id:
            return
        current = hass.data.get(DOMAIN, {}).get(entry.entry_id)
        if current is coordinator:
            hass.async_create_task(async_save_persistence(coordinator))

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, _entry_changed)
    )

    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator:
        await async_save_persistence(coordinator)
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status") == "active":
                await coordinator.async_stop_training(device_id)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok