# HA Device Intelligence Analyzer — V2

Standalone, read-only tooling for inspecting a Home Assistant installation and producing a deterministic evidence-based assessment.

## V2 scope

The scanner collects:

- Device Registry
- Entity Registry
- Area Registry
- Current entity states and attributes
- Electrical measurement candidates
- Optional historical behavior for electrical candidates

The discriminator then separates **evidence from assessment**.

### Whole-home targets

Primary:

- whole-home consumption power
- whole-home consumption energy

Secondary, when present:

- grid import
- grid export
- solar/generation
- battery/storage

The primary consumption source is not selected from an entity name alone. V2 considers Home Assistant measurement semantics, device relationships, derived-source relationships, aggregate/phase terminology, and meter-family topology.

An important case is a calculated HA entity such as a Min/Max sum sensor whose source list contains multiple phase/channel power entities. Home Assistant documents Min/Max as a calculated sensor that can combine multiple entities, so V2 preserves and evaluates those source relationships rather than treating the calculated entity as an unexplained orphan.

## Device/training assessment

Each device receives a provisional technical assessment:

- system_meter — appears to be the whole-home measurement system
- auto_train — direct usable power measurement associated with the device
- quick — controllable device without a direct power measurement
- manual — no direct power measurement and no controllable entity found
- review — ambiguous/system-like device requiring inspection

This is **not** the user's commissioning decision.

The user still decides:

- Keep/include
- Exclude
- Review

No device is silently removed from the raw inventory.

## EnergyIQ boundary

V2 remains independent of EnergyIQ.

It does not:

- install or import EnergyIQ
- modify Home Assistant
- modify registries, entities, or helpers
- create EnergyIQ entities
- perform attribution calculations
- train or commission devices
- automatically adopt devices

The output is intentionally shaped so the discriminator can later become the discovery/decision engine used by EnergyIQ without changing the underlying evidence model.

## Run

The CLI requires a Home Assistant long-lived access token:

    export HA_URL="http://homeassistant.local:8123"
    export HA_TOKEN="YOUR_TOKEN"
    python3 ha_device_analyzer.py --out ha-device-analyzer-v2.json

Or:

    python3 ha_device_analyzer.py --url "http://homeassistant.local:8123" --token "YOUR_TOKEN" --hours 24

History is disabled by default. The token is used only for read-only API calls.

## Output

The JSON report contains:

- raw registry evidence
- raw current-state evidence
- electrical measurement evidence
- optional historical evidence
- assessment.whole_home
- assessment.secondary_energy_sources
- assessment.device_assessments

The raw evidence remains in the same report so discriminator rules can be improved and rerun without rescanning HA.
