# EnergyIQ Project State

**Current revision:** v1.7.13
**Recovery baseline:** v1.7.9
**Purpose:** Whole-home electrical attribution using the Shelly Pro 3EM aggregate power signal.

## Core purpose

EnergyIQ is an energy-attribution system, not simply an HA device inventory. The whole-home meter is the authoritative total. EnergyIQ maintains individual electrical-load candidates and learns their electrical signatures so current whole-home power can be divided into attributable trained loads and unexplained **Mystery Watts**.

**Whole-home power − currently attributable trained load power = Mystery Watts**

## Initial candidate inventory vs. Add Entity browser

These are intentionally different.

### Initial installation / discovery

EnergyIQ builds a **curated candidate inventory** from HA devices. The candidate builder intentionally looks for electrical-load evidence and load-like controllable domains such as light, switch, fan, climate, humidifier, media_player, vacuum, water_heater, and direct power/energy measurements. The initial list is deliberately useful rather than every HA entity.

### Add Device / Entity

Add Entity is the **escape hatch**. It must allow the user to find an enabled HA entity that was not included in the initial curated candidate inventory and bring that load into EnergyIQ later.

The Add Entity browser may search the complete enabled HA entity registry. This does **not** mean the installation candidate list should contain all ~2,400 HA entities.

## EnergyIQ load model

An EnergyIQ candidate represents an individual electrical load. A candidate may have HA control entities, HA power/energy measurement entities, a learned signature, area/name/model/category, Monitor/Ignore classification, and training state.

A physical device with no HA entity is supported as a **Manual Electrical Device** and can be trained without sending commands to HA.

## Dashboard/reporting

The workspace exposes:

- **Home power now** — live whole-home meter
- **Trained active watts** — wattage EnergyIQ can currently account for from completed trained loads that are active
- **Mystery watts** — live whole-home total minus currently attributable trained active load
- **Monitored loads** — individual EnergyIQ loads selected for monitoring
- **Trained** — completed monitored loads / monitored loads
- **Untrained** — monitored loads without completed training

Training wattage must not be counted while a device is OFF. A positive live HA power measurement is preferred when available; otherwise a learned signature can be used while an associated HA load is ON.

## Training architecture

### Quick ON/OFF

For controllable loads, Quick Training uses controlled ON/OFF tests. The v1.7.3 work established 3 controlled cycles, approximately 2.5 seconds of ON measurement using the later ON plateau, approximately 1.5 seconds of OFF settling using the post-OFF plateau, and cycle load = ON plateau − OFF plateau. The device is turned OFF by timing rather than waiting for a power threshold.

### Full Cycle

Used for loads whose electrical behavior changes throughout operation, including HVAC and appliances such as washers, dryers, and ovens.

### Manual Training

For a physical load that cannot be controlled by HA. No HA command is sent; the user operates the appliance normally while EnergyIQ watches the whole-home signal.

## Entity browser history and current bug

v1.7.7 hid entities already associated with EnergyIQ candidates. v1.7.8 intentionally changed the Add Entity browser to show all enabled HA entities, including already-adopted ones, with search by friendly name, entity ID, domain, state, and HVAC action.

The user then found `climate.main_floor` in the browser, but it showed **Already monitored** while the user had inspected all 119 monitored rows and could not find it. This proved the browser's association state and visible candidate inventory were inconsistent.

The underlying implementation uses the exact entity attachment as the authoritative relationship for Add Entity; HA device ID alone must not make an unrelated entity appear already monitored.

## v1.7.13 diagnostic/repair revision

The GitHub repository is now connected and is the authoritative working repository: `tahouser/energy-attributes`.

A branch named `fix/entity-monitoring-1.7.13` was created from `main`.

v1.7.13 changes the panel/frontend diagnostics so the selected HA entity's EnergyIQ ownership is explicitly displayed. The selection button can no longer become a dead-end simply because the entity is reported as monitored: it offers **Verify / Repair Monitoring** and reports the EnergyIQ load name and candidate ID when an association exists.

The panel JavaScript tag was bumped to `energy-attribution-panel-v35`, the integration manifest is 1.7.13, and the panel cache version was bumped to 60.

### Important implementation discovery

The v1.7.12 frontend contained a JavaScript ordering defect: it attempted `modal.querySelector('#entity-ownership')` **before** inserting the `#entity-ownership` element. v1.7.13 corrects that ordering by inserting the ownership element first and then obtaining the reference. This is significant because it can prevent the diagnostic UI from functioning even when the backend is correct.

## What is deliberately not changed

- Initial candidate-domain filtering
- Whole-home power source
- Mystery-Watts calculation
- Training engine
- Quick Training timing/algorithm
- Full-Cycle training
- Manual-device workflow
- Shelly Energy Meter exclusion
- Existing training persistence

## Recovery rules

1. Do not replace the curated initial candidate list with all HA entities.
2. Do not remove the complete HA entity browser; it is needed for later additions.
3. Do not automatically create a separate EnergyIQ load for every HA entity.
4. Do not collapse unrelated electrical loads merely because HA assigns them a device ID.
5. Preserve the distinction between EnergyIQ electrical load, HA entity, and HA device.
6. Keep manual physical loads possible when no HA entity exists.
7. Treat Mystery Watts as a primary project output.
8. Do not modify the training algorithm while fixing entity/inventory behavior unless explicitly addressing training.
9. Validate Python syntax, JavaScript syntax, ZIP integrity, manifest version, and frontend/cache identifiers before presenting a revision.
10. Use the archived conversation as project-history/design reference and the GitHub repository as the working code source.

## Immediate v1.7.13 test

Use `climate.main_floor` in Add Device / Entity.

Expected:

1. Search and select the entity.
2. The dialog displays its EnergyIQ ownership, if any.
3. The button is actionable rather than an unexplained disabled button.
4. If an existing association is reported, its EnergyIQ load name and candidate ID are visible.
5. If no association exists, the entity can be added as a new EnergyIQ load.
6. After the operation, the workspace is refreshed and the resulting load appears in the selected Monitored list.

If the reported candidate does not appear in the workspace, the candidate ID becomes the exact target for the next repair rather than requiring another guess.

## Project history

The original concept was a whole-home event/signature discovery system: detect recurring electrical events, label them, learn signatures, recognize known loads, and expose the residual unknown consumption. The longer-term value is:

**Total house consumption − known loads = unknown consumption**

That residual is the basis of Mystery Watts and is one of the primary reasons EnergyIQ exists.
