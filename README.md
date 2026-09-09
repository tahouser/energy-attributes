# EnergyIQ v1.7.19

EnergyIQ is a Home Assistant custom integration for electrical-load commissioning and attribution.

## v1.7.19
- Makes the EnergyIQ panel itself vertically scrollable on iOS/mobile layouts.
- Preserves horizontal table panning with direction-aware touch handling.
- Forces fresh frontend module URLs for the repaired panel.

## v1.7.17
- Forces a fresh frontend module load so Home Assistant/mobile browsers cannot continue using the stale v1.7.13 panel bundle.
- Keeps the current accounting, monitored-load, entity-selection, and supervised Long Cycle frontend modules on explicit cache-busted URLs.
- Bumps the integration version so the installed version can be verified independently of the GitHub README.

## v1.7.16
- Added accounting for Home Power, Trained Active, Unaccounted Now, Mystery Watts, Training Coverage, and an explicit observed reference maximum.
- Added mobile/table scrolling improvements and frontend rendering protections.

## v1.7.15
- Added supervised Long Cycle training for HVAC and other loads with multi-stage behavior.
- Long Cycle waits for the first significant event, asks the user to confirm the load, captures the complete cycle, and supports manual end-of-training.
