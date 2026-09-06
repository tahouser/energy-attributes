"""Energy Attribution integration."""
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from .const import DOMAIN
from .coordinator import EnergyAttributionCoordinator
from .panel import async_register_panel, async_unregister_panel
from .websocket import async_register as async_register_websocket
PLATFORMS=["sensor"]
async def async_setup_entry(hass:HomeAssistant, entry:ConfigEntry)->bool:
    coordinator=EnergyAttributionCoordinator(hass,entry)
    await coordinator.async_load_training()
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN,{})[entry.entry_id]=coordinator
    await hass.config_entries.async_forward_entry_setups(entry,PLATFORMS)
    if not hass.data[DOMAIN].get("_websocket_registered"):
        async_register_websocket(hass)
        hass.data[DOMAIN]["_websocket_registered"] = True
    if not hass.data[DOMAIN].get("_panel_registered"):
        await async_register_panel(hass)
        hass.data[DOMAIN]["_panel_registered"] = True
    return True
async def async_unload_entry(hass:HomeAssistant, entry:ConfigEntry)->bool:
    coordinator=hass.data.get(DOMAIN,{}).get(entry.entry_id)
    if coordinator:
        for device_id in list(coordinator.training_state):
            if coordinator.training_state[device_id].get("status")=="active":
                await coordinator.async_stop_training(device_id)
    ok=await hass.config_entries.async_unload_platforms(entry,PLATFORMS)
    if ok: hass.data[DOMAIN].pop(entry.entry_id,None)
    return ok
