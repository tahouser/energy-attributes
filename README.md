# EnergyIQ

EnergyIQ is a Home Assistant custom integration for whole-home electrical intelligence and load attribution.

**Project status:** EnergyIQ is being offered to the Home Assistant community for use and possible handoff to a future maintainer. It is not actively maintained by the original project owner, and no ongoing support or update schedule is promised. Community contributions and a willing successor are welcome, but are not guaranteed.

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

## Installation

EnergyIQ is a Home Assistant custom integration. Install it through HACS when available in your setup, or manually by placing the `energyiq` integration directory under `custom_components` in your Home Assistant configuration. Restart Home Assistant and follow the integration's configuration flow.

Back up your Home Assistant configuration before installing, upgrading, or removing the integration. Preserve EnergyIQ's stored data if you intend to continue with an existing setup.

## Frontend

The workspace is a single Home Assistant panel application. The active runtime frontend files are:

- `custom_components/energyiq/www/energyiq-panel.js`
- `custom_components/energyiq/www/energyiq-meter-detector.js`
- `custom_components/energyiq/www/energyiq-card.js`

Historical versioned card files remain in the repository history and runtime directory for compatibility with existing dashboards; the active card entry point is `energyiq-card.js`.

The functional specification is documented in [`ENERGYIQ_DESIGN.md`](ENERGYIQ_DESIGN.md). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system overview and [`CHANGE_PROCEDURE.md`](CHANGE_PROCEDURE.md) for the data-preservation and validation rules.

## Maintenance and support

The project is provided as-is. There is no guarantee of future fixes, compatibility updates, or support. Before making changes, review the design, architecture, state, and change-procedure documents. In particular, preserve existing configuration, entity associations, exclusions, and learned training data unless a change explicitly intends otherwise and provides a safe migration.

## License

EnergyIQ is licensed under the [MIT License](LICENSE). You may use, modify, and redistribute the software, including commercially, subject to the license terms. The software is provided without warranty.
