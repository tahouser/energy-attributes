"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

import json
from pathlib import Path

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
FRONTEND_VERSION = "33000"

_MANIFEST_PATH = Path(__file__).with_name("manifest.json")
INTEGRATION_VERSION = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))["version"]
CARD_PATH = f"{URL_BASE}/energyiq-card-3.1.194.js"
CARD_URL = f"{CARD_PATH}?v={FRONTEND_VERSION}"


async def _async_register_card_resource(hass: HomeAssistant) -> None:
    """Register the EnergyIQ Lovelace card as a dashboard module resource."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None

    if resources is not None and hasattr(resources, "async_create_item"):
        try:
            await resources.async_get_info()
            # Remove every existing EnergyIQ card resource before registering the
            # current URL. This includes the same card path with an older query
            # string: HA otherwise keeps serving the already-registered resource
            # and the browser can continue executing the previous frontend.
            old_prefix = f"{URL_BASE}/energyiq-card"
            for item in list(resources.async_items()):
                url = str(item.get("url", "")).split("?")[0]
                if url.startswith(old_prefix):
                    await resources.async_delete_item(item["id"])
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
            sidebar_title=f"EnergyIQ • v{INTEGRATION_VERSION}",
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

    await coordinator.async_persist_owned_state()
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Keep EnergyIQ data when the config entry is removed.

    Persistent EnergyIQ data intentionally lives outside the config entry so a
    HACS update, reload, or reinstall does not erase learned state. Explicit
    deletion of that store is a separate user action.
    """
    return
