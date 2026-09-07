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


## v0.4.0 commissioning workflow

Initial installation only asks for the whole-home aggregate power sensor.
The integration then adopts all devices that pass the electrical-load filter
into its private Energy Attribution environment.

Commissioning is intentionally separate from installation. Open the
Energy Attribution integration's **Configure** action to review the complete
candidate list on one bulk-selection screen. Candidates with direct
power/energy measurements are shown first; controllable load-style devices
such as lights, switches/outlets, fans, climate devices, media players/TVs,
vacuums and water heaters are also included so the user can decide what is
worth monitoring.

The underlying Home Assistant entities and devices are never modified.


## v0.5.0 workspace workflow

Initial setup only chooses the whole-home meter. The integration's Configure action is the persistent workspace and offers two paths: **Adopt / review devices** and **Train a device**. Adoption is a bulk selection screen. Training is a separate controlled workflow for one monitored device at a time.


## v0.6.0 evaluation workflow

Configure is the permanent commissioning workspace. The selected device
environment is retained independently of the initial installation flow.

Training is modeled as persistent device state (`idle`, `armed`, `active`,
`complete`). An armed/active long-cycle training session is stored in the
config entry so the Configure page can be closed while the coordinator
continues monitoring the whole-home power stream. Training metadata includes
device identity, HA-derived category, baseline, peak delta and captured
samples. The current prototype exposes training state for evaluation; a
future custom frontend can provide per-row Train buttons and the full
interactive waveform/confirmation experience without changing this data model.


## v0.6.1

Training actions are restricted to devices currently classified as **Monitor**.
Ignored devices remain adopted in the private environment but do not appear in
the training list.


## v0.7.0

The Configure workspace now routes the Train action into a persistent,
multi-step training wizard:

1. Prepare / identify the device.
2. Arm and start training.
3. Active training state.
4. Review and confirm or retry.

The training state is stored in the config entry so a long-cycle capture can
remain active while the Configure page is closed. The current evaluation build
uses the whole-home sensor as the capture source; live transition sampling and
waveform rendering are the next implementation layer.


## v0.8.0 training interaction

Training no longer uses ambiguous Ready/Finish/Confirm switches. The wizard
explicitly explains the action at each stage:

- choose Quick ON/OFF or Full cycle;
- explicitly START active monitoring;
- follow device-specific instructions;
- finish the capture;
- review the captured behavior and explicitly save or retry.

There is no hard-coded requirement to toggle a device three times. Quick tests
look for consistent transitions; full-cycle loads are captured as a complete
temporal sequence.


## Dashboard card

The integration registers a custom Lovelace card automatically. Add a **Manual** card to a dashboard with:

```yaml
type: custom:energy-attribution-card
```

The card shows the current whole-home power, monitored devices, learned devices, remaining training count, and the current/recent training state. It is intentionally a commissioning/status view until the attribution engine is implemented; it does not invent appliance-level power estimates.

## Version 1.3.2

- Fixed the training completion panel so it displays the device from the session that just finished.
- Stabilized the custom card and panel element names so Lovelace configuration does not change between releases.
- Dashboard card remains responsive on mobile.


## 1.4.4
- Manual-created devices show a dedicated Manual Training action.
- Integration display name is AAA Energy Attribution to keep iterative installs easy to find.
- Auto Quick behavior remains unchanged.
