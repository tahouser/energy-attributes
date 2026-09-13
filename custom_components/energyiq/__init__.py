"""EnergyIQ Home Assistant integration."""
from __future__ import annotations

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
FRONTEND_VERSION = "31810"


def _backup_persistent_state(coordinator: EnergyAttributionCoordinator, entry: ConfigEntry) -> None:
    """Keep a config-entry backup of EnergyIQ state.

    The HA Store remains the primary training store, but config-entry options
    provide a durable second copy so an integration/HACS code replacement does
    not require users to rebuild their monitored list or retrain every load.
    """
    hass = coordinator.hass
    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            "candidate_devices": coordinator.candidate_devices,
            "device_classifications": coordinator.device_classifications,
            "commissioned_devices": coordinator.commissioned_devices,
            "monitored_entities": coordinator.monitored_entities,
            "training_state": coordinator.training_state,
            "training_samples": coordinator.training_samples,
        },
    )


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
            webcomponent_name="energyiq-panel-training-v180",
            module_url=f"{URL_BASE}/energyiq-training-panel.js?v={FRONTEND_VERSION}",
            sidebar_title="EnergyIQ • v3.1.81",
            sidebar_icon="mdi:lightning-bolt",
            require_admin=True,
        )
        data["_panel_registered"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    response_log_path = migrate_response_log(hass)
    coordinator = EnergyAttributionCoordinator(hass, entry)
    coordinator._response_log_path = response_log_path

    # The HA Store is the primary source. If an older install has a populated
    # config-entry backup but the Store is empty, restore the backup first.
    if not coordinator.training_state and entry.options.get("training_state"):
        coordinator.training_state = entry.options["training_state"]
    if not coordinator.training_samples and entry.options.get("training_samples"):
        coordinator.training_samples = entry.options["training_samples"]

    # Wrap the coordinator's existing persistence method so every forced save
    # (training start/complete, bulk completion, etc.) also refreshes the durable
    # config-entry backup. The existing Store behavior remains unchanged.
    original_persist = coordinator._persist

    async def persist_with_backup(force: bool = False):
        await original_persist(force=force)
        if force:
            _backup_persistent_state(coordinator, entry)

    coordinator._persist = persist_with_backup
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await coordinator.async_load_training()

    # Establish the backup immediately after loading so the current installation
    # has a durable copy before any future HACS update/reload.
    _backup_persistent_state(coordinator, entry)

    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator:
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status") == "active":
                await coordinator.async_stop_training(device_id)
        _backup_persistent_state(coordinator, entry)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok
