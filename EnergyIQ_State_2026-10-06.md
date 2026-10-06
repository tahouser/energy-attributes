# EnergyIQ State — 2026-10-06

## Project
- Repository: tahouser/energy-attributes
- Integration: EnergyIQ
- Current working version: 3.1.375
- Current working baseline: 3.1.375
- Dashboard/resource repair in 3.1.375 has been installed by the user and is confirmed working.
- 3.1.375 restored the current dashboard card code and corrected Lovelace resource registration behavior.
- Do not disturb the working dashboard/resource implementation while Cost is being diagnosed.

## Current Priority
### Cost functionality is the immediate priority
The user explicitly wants Cost functionality fixed before any other architectural or UI work.

Current sequence:
1. Verify Cost values after the 7 PM Peak → Off-Peak transition.
2. Compare EnergyIQ values with underlying HA/DTE data.
3. Identify the source of the discrepancy.
4. Fix the cost calculation/data model.
5. Verify the corrected values.
6. Only then refine/redesign the Cost page presentation.
7. Only after Cost functionality is correct, begin the new EnergyIQ Configuration Hub.

## Cost Problem
- EnergyIQ Cost values are currently significantly wrong.
- We deliberately waited until after 7 PM to obtain a clean Peak → Off-Peak transition for diagnosis.
- Do not guess at the cause.
- Check, in order:
  - cumulative energy deltas
  - rate application
  - Peak/Off-Peak classification
  - period boundaries
  - day/week/month aggregation
  - history/reset behavior
- Existing DTE entities include:
  - sensor.dte_peak_energy_cost
  - sensor.dte_off_peak_energy_cost
  - sensor.dte_house_energy_peak
  - sensor.dte_house_energy_off_peak
  - input_number.dte_peak_base_rate
  - input_number.dte_off_peak_base_rate
  - select.dte_house_energy
  - automation.dte_peak_start
  - automation.dte_peak_end
- EnergyIQ helper history currently includes:
  - input_number.energyiq_peak_cost_history
  - input_number.energyiq_off_peak_cost_history
- Existing temporary sampler/reset architecture should not be assumed correct; verify it before replacing it.

## Cost Architecture Direction
Long-term goal is for EnergyIQ to own its own cost configuration and calculations rather than requiring users to create external HA helpers/automations.
Desired eventual setup:
- User selects the whole-home energy/power source.
- User configures Peak rate.
- User configures Off-Peak rate.
- User configures Peak schedule/days.
- EnergyIQ calculates and stores/derives the required history internally.
- Users should not need to understand or manually create the DTE helper/automation machinery.

Preferred calculation model:
- Interval energy = cumulative meter at end − cumulative meter at start.
- Interval cost = interval kWh × applicable rate.
- Period cost = sum of interval costs within the requested period.
- Day/week/month must respect actual period boundaries.
- Peak/Off-Peak classification must use configured schedule, not hardcoded times.

## Configuration Architecture — PRIORITY AFTER COST
The user approved the concept of a new EnergyIQ Configuration Hub, but explicitly wants Cost functionality fixed first.

Desired future design:
- Keep the EnergyIQ gear entry point on the Home Assistant EnergyIQ integration page.
- Initial installation can remain a guided wizard.
- Ongoing configuration should NOT force the user through Sensor → Device Inclusion → Consumption and other steps sequentially.
- Configuration Hub should show all available configuration areas as stacked, single-line rows.
- Each row is collapsed by default.
- Clicking a row expands that section to show its full configuration.
- Only the selected section needs to be open.
- Collapsed rows should ideally show a concise summary of current settings.

Proposed sections:
- Energy Source
- Devices
- Consumption
- Cost
- Training
- Dashboard
- Advanced, if eventually needed

Example collapsed summaries:
- Energy Source — Whole Home: <entity>
- Devices — <N> monitored / <N> excluded
- Consumption — <yellow>/<red> kWh, Peak <start>-<end>
- Cost — Peak <rate>, Off-Peak <rate>
- Training — <N> trained / <N> pending
- Dashboard — current display preference

Important:
- This Configuration Hub is not to be implemented yet.
- Do not let this architecture work interfere with Cost diagnosis.
- Initial setup wizard and ongoing configuration are conceptually separate.

## Locked / Protected Areas
- Consumption chart behavior/design is considered complete/locked except for its configuration/setpoints page.
- Mystery Watts is complete/locked. Do not modify unless explicitly requested.
- Dashboard overall design is not to be redesigned during Cost diagnosis.
- The current working dashboard loader/resource behavior in 3.1.375 is protected.

## Consumption Configuration Work Already Completed
The new Consumption configuration uses native HA collapsible sections:
- Peak Period
  - Peak start
  - Peak end
  - Peak days
- Consumption Limits
  - Green → Yellow threshold
  - Yellow → Red threshold

Stored options:
- consumption_thresholds = { yellow: <number>, red: <number> }
- consumption_peak_schedule = { start: <time>, end: <time>, days: [0-6] }

Validation:
- Peak start and end cannot be equal.
- Red threshold must be >= yellow threshold.
- At least one Peak day is required.

There were previously UI issues with blank time defaults and weekday selector presentation. Do not reopen those issues unless they are encountered again in testing.

## Version / Safe-Point History
- Historical emergency restore point: v3.1.36
- Earlier accepted core persistence safe point: v3.1.211
- Earlier accepted UI/card safe point: v3.1.194
- Current working dashboard/resource version: v3.1.375
- 3.1.373 introduced the new Consumption configuration architecture.
- 3.1.374 had a dashboard card regression because its card file was accidentally based on older 3.1.371 code.
- 3.1.375 corrected that and restored the current dashboard card.

## 3.1.375 Verification
User has installed 3.1.375 and confirmed:
- Dashboard loads correctly.
- Previous red generic Lovelace “Configuration error” is gone.
- Therefore the 3.1.375 dashboard/resource repair is confirmed working in HA.

## Development Rules
- Do not stack speculative fixes.
- Diagnose with actual HA data before changing Cost calculations.
- Keep working areas untouched while diagnosing another area.
- Do not claim a fix is verified until the user tests it in HA.
- When modifying the repository, make focused changes and validate syntax/structure before asking the user to install.
- Preserve the current working 3.1.375 dashboard/resource implementation.

## Next Action
After the 7 PM Peak → Off-Peak transition:
- Collect/compare actual EnergyIQ Cost values and underlying DTE sensor values.
- Determine exactly where the cost calculation diverges.
- Fix Cost functionality first.
- Then refine the Cost page UI.
