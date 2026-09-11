# EnergyIQ

EnergyIQ is a Home Assistant custom integration for whole-home electrical intelligence and load attribution.

## What it does

EnergyIQ uses the configured whole-home power meter as the authoritative total and tracks individual electrical loads. Completed training allows EnergyIQ to estimate attributable active load power.

**Mystery Watts = Whole-home power − attributable trained active load power**

## Main workflow

1. Configure the whole-home power entity.
2. EnergyIQ builds a curated initial candidate inventory.
3. Select loads with **Monitor**.
4. Use **Add Device / Entity** when a load is missing from the curated inventory.
5. Train monitored loads with Quick ON/OFF, Full Cycle, or Manual Training.
6. Watch live Home Power, Trained Active Watts, and Mystery Watts.

## Frontend

The workspace is a single Home Assistant panel application. The active runtime frontend is:

`custom_components/energyiq/www/energyiq-panel.js`

There are no versioned frontend copies or compatibility loaders.

The functional specification is documented in [`ENERGYIQ_DESIGN.md`](ENERGYIQ_DESIGN.md).

## Release discipline

The repository uses one authoritative version/release workflow. The version is finalized only after the complete code and runtime file tree has been validated. Historical implementations remain in Git history rather than the runtime directory.

