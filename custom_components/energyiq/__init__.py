"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .instrument_coordinator import InstrumentCoordinator
from .instrument_websocket import async_register as async_register_websocket

PLATFORMS: list[str] = []
URL_BASE = "/energyiq-static"
FRONTEND_VERSION = "31650"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
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
            webcomponent_name="energyiq-panel-v365",
            module_url=f"{URL_BASE}/energyiq-instrument-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.65",
            sidebar_icon="mdi:home-lightning-bolt",
            require_admin=True,
        )
        data["_panel_registered"] = True
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = InstrumentCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if coordinator:
        await coordinator.async_shutdown()
    return True
