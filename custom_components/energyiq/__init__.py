"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import EnergyAttributionCoordinator
from .websocket import async_register as async_register_websocket
from .long_cycle import async_register as async_register_long_cycle
from .accounting import async_register as async_register_accounting
from .response_migration import migrate_response_log

PLATFORMS = ["sensor"]
URL_BASE = "/energyiq-static"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
        await async_register_long_cycle(hass)
        async_register_accounting(hass)
        data["_websocket_registered"] = True
    if not data.get("_panel_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(URL_BASE, hass.config.path("custom_components", DOMAIN, "www"), cache_headers=False)
        ])
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path="energyiq",
            webcomponent_name="energyiq-panel",
            module_url=f"{URL_BASE}/energyiq-panel-entry.js?v=2212",
            sidebar_title="EnergyIQ • v2.2.12",
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
    await coordinator.async_load_training()
    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator:
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status") == "active":
                await coordinator.async_stop_training(device_id)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok
