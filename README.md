# EnergyIQ v2.0.0

EnergyIQ is a Home Assistant custom integration for whole-home electrical intelligence and load identification.

## v2.0.0
- Resets the Home Assistant integration domain to `energyiq` for a clean long-term product identity.
- Uses the `custom_components/energyiq` integration path.
- Adds automatic migration of the legacy `energy_attribution_response.csv` training log to `energyiq_response.csv` and removes the legacy file only after successful verification.
- Removes committed Python cache artifacts from the integration package.
- Uses EnergyIQ branding consistently in the Home Assistant integration.

## v1.7.22
- Added the EnergyIQ Power & Control integration icon using the light-background design.

## v1.7.21
- Removed the old `AAA` prefix from user-facing commissioning and integration branding.
- Uses **EnergyIQ** consistently as the visible product name.

## v1.7.20
- Keeps Trained active watts as the primary value in the existing Trained active watts tile.
- Adds Trained inactive watts as a secondary value in that same tile, avoiding another dashboard tile.
- Calculates trained inactive watts as learned trained-load capacity minus currently active trained watts.
- Cache-busts the accounting frontend extension.

## v1.7.19
- Makes the EnergyIQ panel itself vertically scrollable on iOS/mobile layouts.
- Preserves horizontal table panning with direction-aware touch handling.
- Forces fresh frontend module URLs for the repaired panel.
