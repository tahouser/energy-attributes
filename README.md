# EnergyIQ v1.7.17

EnergyIQ is a Home Assistant custom integration for electrical-load commissioning and attribution.

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

## v1.7.0
- Uses a local Shelly Pro 3EM RPC reading as the preferred whole-home measurement source during controlled training when EnergyIQ can automatically resolve the Shelly config entry.
- Keeps the existing Home Assistant power entity as the normal dashboard/monitoring source.
- Falls back to the HA power entity when a unique Shelly local connection cannot be resolved.
- Preserves the established Quick training timing and safety behavior: 3-second baseline, automatic ON, 1.5-second measurement, automatic OFF, 1.5-second recovery, 0.5-second cooldown, three cycles.
- Logs the measurement source and Shelly host at training completion.

## Automatic local meter resolution
EnergyIQ first checks the selected whole-home power entity's Shelly config entry, then the entity's device and parent device config entries. If exactly one Shelly integration entry exists, it can be used as a safe fallback. Multiple unrelated Shelly entries are not guessed.

A future setup revision can expose an explicit local-meter selection/IP fallback when automatic resolution is unavailable. Non-Shelly local-meter adapters should be added by protocol rather than assuming every meter uses Shelly RPC.
