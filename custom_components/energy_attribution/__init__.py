"""Energy Attribution integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.components import panel_custom, frontend
from homeassistant.components.http import StaticPathConfig

from .const import DOMAIN
from .coordinator import EnergyAttributionCoordinator
from .websocket import async_register as async_register_websocket

PLATFORMS = ["sensor"]
URL_BASE = "/energy-attribution-static"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
        data["_websocket_registered"] = True
    if not data.get("_panel_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(URL_BASE, hass.config.path("custom_components", DOMAIN, "www"), cache_headers=False)
        ])
        frontend.add_extra_js_url(hass, f"{URL_BASE}/energy-attribution-card.js?v=13")
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path="energy-attribution",
            webcomponent_name="energy-attribution-panel-v13",
            module_url=f"{URL_BASE}/energy-attribution-panel.js?v=13",
            sidebar_title="Energy Attribution",
            sidebar_icon="mdi:flash-circle",
            require_admin=True,
        )
        data["_panel_registered"] = True
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = EnergyAttributionCoordinator(hass, entry)
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
