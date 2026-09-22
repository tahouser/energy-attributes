"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.components import panel_custom
from homeassistant.components.lovelace.const import LOVELACE_DATA
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
FRONTEND_VERSION = "31413"
CARD_URL = f"{URL_BASE}/energyiq-card.js?v={FRONTEND_VERSION}"


async def _async_register_card_resource(hass: HomeAssistant) -> None:
    """Register the EnergyIQ Lovelace card as a dashboard module resource."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None

    if resources is not None and hasattr(resources, "async_create_item"):
        try:
            await resources.async_get_info()
            if any(item.get("url") == CARD_URL for item in resources.async_items()):
                return
            await resources.async_create_item({
                "url": CARD_URL,
                "res_type": "module",
            })
            return
        except Exception:
            # Fall through to the legacy extra-JS loader for YAML-mode/older HA.
            pass

    # Fallback for YAML-mode Lovelace or older Home Assistant releases.
    from homeassistant.components import frontend
    frontend.add_extra_js_url(hass, CARD_URL)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up EnergyIQ services and the single frontend application."""
    data = hass.data.setdefault(DOMAIN, {})

    if not data.get("_websocket_registered"):
        async_register_websocket(hass)
        await async_register_long_cycle(hass)
        async_register_accounting(hass)
        data["_websocket_registered"] = True

    if not data.get("_panel_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig(
                URL_BASE,
                hass.config.path("custom_components", DOMAIN, "www"),
                cache_headers=False,
            ),
            StaticPathConfig(
                "/energyiq-brand",
                hass.config.path("custom_components", DOMAIN, "brand"),
                cache_headers=False,
            )
        ])
        await _async_register_card_resource(hass)
        await panel_custom.async_register_panel(
            hass=hass,
            frontend_url_path="energyiq",
            webcomponent_name="energyiq-panel-v339",
            module_url=f"{URL_BASE}/energyiq-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.138",
            sidebar_icon="mdi:home-lightning-bolt-outline",
            require_admin=False,
        )
        data["_panel_registered"] = True

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load one EnergyIQ configuration entry."""
    response_log_path = migrate_response_log(hass)
    coordinator = EnergyAttributionCoordinator(hass, entry)
    coordinator._response_log_path = response_log_path
    entry.runtime_data = coordinator

    await coordinator.async_load_training()
    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload EnergyIQ integration cleanly."""
    coordinator = entry.runtime_data
    if coordinator:
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status") == "active":
                await coordinator.async_stop_training(device_id)

    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    return ok
