# Energy Attribution

A Home Assistant custom integration for attributing whole-home power consumption to selected Home Assistant electrical loads.

## Installation

Install through HACS as a custom repository of type **Integration**. After installation, add **Energy Attribution** from **Settings → Devices & services → Add Integration**.

## v0.3.0 commissioning model

The commissioning workflow is deliberately separated into three stages:

1. **Discovery/filtering** — the integration scans the HA device/entity registry and keeps only devices with direct, valid power or cumulative energy measurements. Disabled/config/diagnostic entities, environmental-only entities, controls without measurements, and the selected whole-home meter device are excluded.
2. **Bulk selection** — every filtered device is adopted into Energy Attribution's own commissioning environment and is selected by default. The user can uncheck loads that should not be monitored. This is a single bulk screen, not a 1-device-at-a-time questionnaire.
3. **Training** — controlled appliance training will use only the devices selected for monitoring. Long-cycle appliances such as dishwashers and dryers will be trained as full temporal signatures rather than as a single wattage value.

The integration does not modify Home Assistant's device/entity registry. It stores its own monitor/ignore state and measurement mapping.

## Reopening commissioning

After setup, the same bulk commissioning screen is available from the Energy Attribution integration's configuration/options flow, allowing the monitored set to be changed without reinstalling the integration.

## Current status

v0.3.0 establishes the filtered, device-level commissioning environment. Attribution/NILM training and the dashboard are built on top of this base.
