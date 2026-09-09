"""Register the Energy Attribution interactive training panel."""
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

DOMAIN_PANEL = "energy-attribution"


async def async_register_panel(hass: HomeAssistant) -> None:
    www = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths([
        StaticPathConfig("/energy-attribution-static", str(www), False)
    ])
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="energy-attribution-panel",
        frontend_url_path=DOMAIN_PANEL,
        module_url="/energy-attribution-static/energy-attribution-panel.js?v=0.9.5",
        sidebar_title="EnergyIQ",
        sidebar_icon="mdi:flash-outline",
        require_admin=False,
        config={},
        config_panel_domain="energy_attribution",
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    frontend.async_remove_panel(hass, DOMAIN_PANEL)
