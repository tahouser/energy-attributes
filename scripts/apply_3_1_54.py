from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 1) Product version / cache busting / sidebar branding.
manifest = ROOT / "custom_components/energyiq/manifest.json"
text = manifest.read_text()
text = text.replace('"version": "3.1.36"', '"version": "3.1.54"')
manifest.write_text(text)

init = ROOT / "custom_components/energyiq/__init__.py"
text = init.read_text()
text = text.replace('FRONTEND_VERSION = "31360"', 'FRONTEND_VERSION = "31540"')
text = text.replace('sidebar_title="EnergyIQ • v3.1.36"', 'sidebar_title="EnergyIQ • v3.1.54"')
text = text.replace('sidebar_icon="mdi:lightning-bolt"', 'sidebar_icon="mdi:home-lightning-bolt"')
init.write_text(text)

# 2) Frontend: use more of the available vertical space for the load table.
panel = ROOT / "custom_components/energyiq/www/energyiq-panel.js"
text = panel.read_text()
text = text.replace('const VERSION = "31360";', 'const VERSION = "31540";')
text = text.replace('max-height:calc(100vh - 330px)', 'max-height:calc(100vh - 240px)')
panel.write_text(text)

# 3) Automatic candidate discovery: exclude Browser Mod devices only.
# The complete Add Device / Entity browser is deliberately untouched.
config_flow = ROOT / "custom_components/energyiq/config_flow.py"
text = config_flow.read_text()
needle = '''    all_devices = [*devices.devices, *devices.child_devices]\n    _LOGGER.debug(\n'''
replacement = '''    all_devices = [*devices.devices, *devices.child_devices]\n    browser_mod_config_entry_ids = {\n        entry.entry_id for entry in hass.config_entries.async_entries("browser_mod")\n    }\n    _LOGGER.debug(\n'''
if needle not in text:
    raise SystemExit("Could not find candidate inventory insertion point")
text = text.replace(needle, replacement, 1)
needle = '''    for device in all_devices:\n        device_name = " ".join(\n'''
replacement = '''    for device in all_devices:\n        if browser_mod_config_entry_ids.intersection(getattr(device, "config_entries", set())):\n            continue\n\n        device_name = " ".join(\n'''
if needle not in text:
    raise SystemExit("Could not find device loop insertion point")
text = text.replace(needle, replacement, 1)
config_flow.write_text(text)
