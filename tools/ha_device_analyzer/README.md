# HA Device Intelligence Analyzer — V1

Standalone, read-only tooling for inspecting a Home Assistant installation.

## V1 scope

V1 is independent of EnergyIQ. It can be executed from a Home Assistant environment or another machine that can reach the HA API.

It collects:

- Device Registry
- Entity Registry
- Area Registry
- Current entity states
- Electrical measurement candidates
- Historical behavior for electrical candidates

It records evidence such as:

- measurement class
- unit, device class, state class
- sample count
- minimum and maximum
- zero percentage
- identical-reading percentage
- distinct values
- longest observed gap
- median update interval
- unavailable and unknown counts
- possible low-resolution or rounding signal

V1 does not decide that a device is safe for EnergyIQ Auto-Train. It supplies the evidence for that later decision.

## Run

No third-party Python package is required.

Create a Home Assistant long-lived access token, then run:

    export HA_URL="http://homeassistant.local:8123"
    export HA_TOKEN="YOUR_TOKEN"
    python3 ha_device_analyzer.py --hours 24 --out ha-device-analyzer-v1.json

Or pass the values directly:

    python3 ha_device_analyzer.py --url "http://homeassistant.local:8123" --token "YOUR_TOKEN" --hours 24

The token is used only for read-only API calls. The analyzer never writes to Home Assistant.

## Output

The JSON report contains:

- schema and generation time
- analyzer scope
- device summary
- complete device inventory
- complete entity inventory
- electrical measurement candidates
- historical evidence for those candidates

## Important HA 2026.9 behavior

Home Assistant 2026.9 includes child devices in the device registry. V1 recognizes parent_device_id and falls back to the parent's area when a child has no area of its own.

Current devices use config_entry_id and config_subentry_id. V1 uses those current fields and does not depend on the deprecated multi-config-entry properties.

## Design boundary

V1 is evidence collection, not EnergyIQ.

It does not:

- install or import EnergyIQ
- modify Home Assistant
- modify registries, entities, or helpers
- create EnergyIQ entities
- perform attribution calculations
- train or commission devices
- automatically adopt devices

The next step after V1 is to run it against the real HA installation and inspect what it finds before defining Auto-Train eligibility rules.
