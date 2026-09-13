"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import InstrumentCoordinator
from .websocket import async_register as async_register_websocket

PLATFORMS = ["sensor"]
URL_BASE = "/energyiq-static"
FRONTEND_VERSION = "31600"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up EnergyIQ as the electrical measurement instrument."""
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
            webcomponent_name="energyiq-panel-v360",
            module_url=f"{URL_BASE}/energyiq-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.60",
            sidebar_icon="mdi:home-lightning-bolt",
            require_admin=True,
        )
        data["_panel_registered"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the EnergyIQ measurement source."""
    coordinator = InstrumentCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload EnergyIQ cleanly."""
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator:
        await coordinator.async_shutdown()
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok
