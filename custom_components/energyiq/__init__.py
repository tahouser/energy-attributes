"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
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
            sidebar_title="EnergyIQ • v3.1.85",
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

    # Preserve the exact v3.1.79 startup order. The legacy training Store is
    # loaded first, then the coordinator discovers/refreshes its candidates.
    await coordinator.async_load_training()
    await coordinator.async_config_entry_first_refresh()

    # Only after the coordinator is fully populated do we apply commissioning
    # persistence. Startup never writes an empty commissioning record.
    await async_load_persistence(coordinator)

    # Training completion/reset already funnels through _persist(). Mirror
    # forced persistence writes to the commissioning Store as well.
    original_persist = coordinator._persist

    async def persist_with_commissioning_store(force: bool = False):
        await original_persist(force=force)
        if force:
            await async_save_persistence(coordinator)

    coordinator._persist = persist_with_commissioning_store

    # Monitoring changes are made through ConfigEntry option updates by the
    # existing v3.1.79 websocket/config-flow code. Observe those updates only
    # after startup loading is complete, so an upgrade cannot save a transient
    # empty state back over the persistent commissioning record.
    entry.async_on_unload(
        async_dispatcher_connect(
            hass,
            "config_entry_changed",
            lambda change, changed_entry: (
                hass.async_create_task(async_save_persistence(coordinator))
                if getattr(change, "value", change) == "updated"
                and changed_entry.entry_id == entry.entry_id
                else None
            ),
        )
    )

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
