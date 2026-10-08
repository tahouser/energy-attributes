# EnergyIQ Development State — 2026-10-07

## Purpose of this document

This is the current handoff/state document for the EnergyIQ project. It records the significant progress made in the Meter Detector work, the prior project constraints, the current known-good behavior, and the rules that should be preserved when continuing development.

**Repository:** `tahouser/energy-attributes`  
**Integration:** EnergyIQ  
**Current version:** **3.1.420**  
**Current focus:** Meter Detector / electrical-source discovery and commissioning  
**Consumption page:** COMPLETE / LOCKED  
**Cost page:** 3.1.404 behavior remains the baseline; do not disturb while Meter Detector work is underway unless explicitly requested.

---

# 1. Critical development rules

1. Do not modify working Consumption logic unless explicitly requested.
2. Do not modify Mystery Watts unless explicitly requested.
3. Do not start the broader Consumption Visual Redesign or Overall Card Design while the active task is still being evaluated.
4. If a revision breaks working functionality, do not stack unrelated fixes on top of the broken revision. Return to the latest known-good safe point and make the next sequential revision.
5. Preserve the user's working HACS/custom-component workflow. Do not require manual rebuild/tag/release procedures that the existing workflow does not need.
6. The Meter Detector should perform useful investigation automatically. The user should not have to manually conduct diagnostics that the detector can perform itself.
7. Keep the Meter Detector compact. Information that is not useful to the commissioning decision should not occupy screen space.
8. Broad discovery is intentional. Do not aggressively filter out smart plugs, appliance meters, or other electrical sources simply because they are not whole-home meters. Users may want to monitor a single load.
9. Classification is a view of discovered electrical sources, not destructive filtering.
10. The user wants the detector to reason from actual Home Assistant entities and live state, not merely vendor metadata.

---

# 2. Major breakthrough: Meter Detector now works as intended

The Meter Detector has progressed from a metadata experiment into a working electrical-source discovery and interrogation tool.

The current successful behavior is demonstrated by the Shelly Pro 3EM test:

- Home Assistant exposed the same physical Pro 3EM through **3 HA device records**.
- EnergyIQ correctly grouped those records into **one physical source**.
- The grouped source was correctly classified **Class A — multi-channel meter**.
- The user did not have to manually start the channel test.
- The detector automatically performed a **30-second live interrogation**.
- The interrogation found **3 observed channels**.
- All 3 showed measurable activity during the test.
- L1 showed approximately **429.40 W**.
- L2 showed approximately **402.60 W**.
- An unlabeled channel exposed voltage at approximately **123 V** and energy/power-related entities.
- The UI exposed the underlying **8 Home Assistant entities** only when requested.

This is the first strong proof that the architecture is doing the intended job.

The successful screenshot showed:

**A — shellypro3em-6825ddd236d4**  
Shelly · Shelly Pro 3EM · 3 HA records grouped

**LIVE INTERROGATION**  
30-second channel test  
**3 ACTIVE / 3 OBSERVED**

Channels:
- unlabeled — measurable signal
- L1 — measurable signal, ~429.40 W
- L2 — measurable signal, ~402.60 W

This result should be treated as a major safe point.

---

# 3. Current Meter Detector architecture

The intended conceptual model is:

**Physical Source → Channel → Measurements**

Examples:

### Class A
A physical whole-home / multi-channel meter.

Example:
- Shelly Pro 3EM
- Multiple HA device records can belong to the same physical source.
- EnergyIQ groups those records and interrogates the resulting source.

### Class B
An individual-load electrical measurement source.

Examples:
- TP-Link EP25 smart plug
- Shelly Plug / PM / PM Mini
- Other appliance-level energy monitors

These are retained because EnergyIQ may legitimately be used to monitor a single load.

### Class C
An electrical measurement source exists but is incomplete or ambiguous.

### Class D
A discovered device/entity is retained for discovery purposes but is not considered a useful EnergyIQ electrical measurement source.

Examples already identified:
- battery-only devices
- smoke detectors / smoke alarms without electrical measurement entities

---

# 4. Broad discovery is intentional

An earlier attempt introduced aggressive candidate filtering. That was rejected.

The correct behavior is:

**Find broadly, classify intelligently.**

A smart plug may look similar to a meter from Home Assistant's perspective, but that does not make it useless. It may be exactly what the user wants to monitor.

Therefore:
- Keep electrically interesting sources.
- Assign a class.
- Let the user select useful sources.
- Do not silently remove candidates merely because they are not whole-home meters.

---

# 5. Physical grouping breakthrough

Home Assistant can expose one physical meter as multiple device records.

The Shelly Pro 3EM demonstrated this directly.

Earlier, the detector showed three separate entries such as:

- shellypro3em-6825ddd236d4 ... 1 W / 1 kWh / 1 V
- same physical meter ... 2 W / 1 kWh
- same physical meter ... 1 W / 1 kWh

This caused the meter to be incorrectly classified as three Class B sources.

The grouping logic now recognizes the physical Shelly identity using the serial-like portion of the name:

`shellypro3em-6825ddd236d4`

and combines the HA records before classification.

The resulting source is:

**one physical Pro 3EM → one EnergyIQ source → combined entities**

This is essential and should not be regressed.

General grouping also normalizes obvious channel/phase suffixes such as:
- L1 / L2 / L3
- Phase 1 / Phase 2 / Phase 3
- Channel 1 / Channel 2 / Channel 3

The grouping must remain conservative enough not to merge unrelated physical devices.

---

# 6. Class A automatic interrogation

This was an important design correction.

Originally there was a button:

**Interrogate channels (30 sec)**

That was rejected because the detector should perform its own investigation.

The correct workflow is now:

1. Scan Home Assistant.
2. Discover electrical sources.
3. Group physical sources.
4. Classify them.
5. Automatically interrogate **every Class A source**.
6. Display the result when the 30-second observation finishes.
7. Leave Class B/C sources available without forcing the user to wait 30 seconds for every load meter.

The user explicitly stated:

> Any class A should be interrogated.

That is now the governing rule.

The manual interrogation button should not return as the primary workflow.

If a manual re-test is ever needed, it should be secondary functionality, not something required for normal commissioning.

---

# 7. What the automatic interrogation actually does

The backend probe:

- samples the relevant Home Assistant entities
- uses approximately a 2-second sample interval
- observes a 30-second window
- groups observed entities by inferred channel labels
- records whether the channel reports numeric samples
- determines whether measurable activity occurred
- reports active channels separately from observed channels

Important limitations are preserved:

- A populated CT with no load can look like an unused CT during a quiet window.
- A zero-only channel cannot prove that a CT is physically absent.
- The probe interrogates Home Assistant live entity state.
- It does not directly call the Shelly network API.
- Channel count is not automatically treated as electrical phase count.

These limitations are important and should remain.

---

# 8. Important lesson about meter topology

Do not infer electrical topology simply from:
- number of HA device records
- number of CT inputs
- number of exposed entities
- a vendor model name alone

The detector should distinguish:

1. hardware capability / channel count
2. channels actually exposed to Home Assistant
3. channels that are currently reporting
4. channels carrying measurable activity
5. actual electrical topology

For example, a Shelly Pro 3EM exposing three measurement channels strongly supports a multi-channel meter, but the detector should not blindly label every exposed channel as a physical electrical phase.

---

# 9. Home Assistant power-meter ecosystem research

Research confirmed there is no universal power-meter entity layout in Home Assistant.

Relevant examples include:

- HomeWizard: power, energy, voltage, current, frequency, reactive power, apparent power, phase data depending on device.
- Smappee: active power, solar, configured submeter loads, phase voltage/current and other measurements depending on monitor.
- IoTaWatt: CT inputs and user-defined outputs become HA sensors.
- Sense: whole-home power, energy trends and detected appliance power.
- Eastron: shared/rebranded HomeWizard-style exposure.
- WattWächter: total and L1/L2/L3 power, voltage, current, frequency, power factor.
- eGauge: power and cumulative energy per register plus voltage/current where available.
- EARN-E P1: near-real-time power plus voltage/current and slower meter readings.
- Discovergy/inexogy: total power/energy plus optional phase data.
- SmartThings: exposes several power/energy reporting entities whose semantics can differ from instantaneous real power.

Therefore the detector must rely primarily on:
- Home Assistant device/entity registry relationships
- standardized sensor device classes
- units
- state/current values
- available channel/entity structure

Vendor-specific logic can improve confidence, but must not be the foundation of the entire detector.

---

# 10. Family Hub investigation

The Samsung Family Hub refrigerator investigation was an important reason for building this detector.

Relevant entities included:
- `sensor.family_hub_power`
- `sensor.family_hub_power_energy`
- `sensor.family_hub_energy_difference`
- actual smart-plug power such as `sensor.master_closet_side_current_consumption`

The Samsung SmartThings `powerConsumptionReport` data was found to be unsuitable as a straightforward instantaneous-real-power source. Some reported values were physically implausible as fridge instantaneous wattage.

The smart plug provided the useful real-time power signal.

This reinforced the need for EnergyIQ to distinguish:
- a sensor that is named like power
- a sensor that is actually useful instantaneous electrical power
- cumulative energy
- reporting/derived energy metrics

---

# 11. Current Meter Detector UI philosophy

The user explicitly wants to minimize screen space.

The current UI should therefore follow:

### Collapsed source row
Show only:
- checkbox
- Class A/B/C/D badge
- source name
- manufacturer/model
- compact measurement counts
- grouped-record indication where relevant

### Expanded source
Show only:
- automatic Class A interrogation status/results
- useful source-specific information
- expandable HA entity list

Do not show unnecessary:
- match scores
- evidence chips
- verbose classification explanations
- repeated descriptions
- large diagnostic panels
- information that does not help the user decide whether the source is useful

The overlapping evidence-chip problem was eliminated by removing the evidence chips rather than trying to make them prettier.

This is the preferred approach: **remove unnecessary content before adding UI complexity.**

---

# 12. Current compact UI result

Version 3.1.418 produced the desired compact source presentation.

The successful screenshot shows the grouped Class A Pro 3EM with:
- checkbox
- A badge
- source name
- Shelly / Shelly Pro 3EM
- 3 HA records grouped
- compact measurement counts

Then the automatic interrogation result.

The underlying HA entities remain behind:

**Show Home Assistant entities (8)**

This is the desired information hierarchy.

---

# 13. Recent version progression

Important sequence:

- **3.1.411** — repair after detector frontend rendering failure.
- **3.1.412** — source selection and Class D handling.
- **3.1.413** — initial physical-source grouping.
- **3.1.414** — corrected grouping logic; successful grouping of the three Pro 3EM records.
- **3.1.415** — repaired interrogation command/frontend naming/registration issues.
- **3.1.416** — began automatic Class A interrogation.
- **3.1.417** — completed the automatic Class A interrogation UI and removed the intended manual workflow.
- **3.1.418** — compacted the UI and removed redundant diagnostic content.

**Meter Detector safe point: 3.1.418.**

**Current commissioning revision: 3.1.420.**

No GitHub release/tag should be assumed to exist merely because the version number exists. The repository has been updated directly through commits.

---


# 13A. Commissioning integration — 3.1.420

The detector is now connected to a user-decision commissioning layer without changing the detector itself.

The intended flow is:

1. EnergyIQ scans Home Assistant.
2. If one Class A source is found, EnergyIQ presents it explicitly as the proposed whole-home meter.
3. The user gets three clear choices:
   - **YES — USE THIS METER**
   - **NO — CHOOSE A DIFFERENT METER**
   - **ADD MY METER MANUALLY**
4. Choosing a different meter shows all useful detected electrical sources with usable power entities, including Class A/B/C.
5. Manual commissioning allows selection of any Home Assistant power sensor.
6. If no Class A source is found, EnergyIQ does not treat that as a commissioning failure. It offers:
   - **CHOOSE A DEVICE ENERGYIQ FOUND**
   - **ADD MY METER MANUALLY**
7. Selecting a meter completes basic commissioning; advanced EnergyIQ configuration remains separate.
8. Existing installations can enter the same meter-selection process through Home Assistant reconfiguration. Reconfiguration updates only the commissioning-owned meter fields and preserves existing EnergyIQ settings/training data.

Important correction from 3.1.419:

3.1.419 technically added commissioning discovery, but the UI used a dropdown for the accept/defer decision and did not expose a proper way to reject the proposed meter or reach the alternate/manual paths. It also did not address the fact that an existing config entry does not automatically rerun the initial setup flow.

3.1.420 fixes the commissioning layer with explicit menu choices and a proper reconfigure flow.

The Meter Detector internals remain unchanged.
# 14. Current backend/frontend components

Meter Detector backend:

`custom_components/energyiq/meter_detector.py`

Meter Detector frontend:

`custom_components/energyiq/www/energyiq-meter-detector.js`

Panel:
- frontend URL: `energyiq-meter-detector`
- webcomponent: `energyiq-meter-detector`
- module URL: `/energyiq-static/energyiq-meter-detector.js?v=...`
- sidebar title: EnergyIQ Meter Detector
- icon: `mdi:meter-electric-outline`
- admin requirement: false

The existing main EnergyIQ card remains:

`custom_components/energyiq/www/energyiq-card-3.1.401.js`

Its physical filename should not be changed casually.

---

# 15. Current selection behavior

Class A/B/C sources have selection checkboxes.

Class D sources remain informational and are not selectable.

Current selection is frontend/transient diagnostic selection. It is not yet persisted into EnergyIQ configuration.

That is intentional until the classification/discovery behavior is fully trusted.

Do not rush persistence until the detector's source model is approved.

---

# 16. Next logical work

Before adding more features:

### A. Freeze the successful Meter Detector behavior
Treat **3.1.418** as a safe point.

### B. Verify repeat behavior
Run another detector scan and confirm:
- Pro 3EM still groups as one source
- Class A remains Class A
- automatic interrogation starts automatically
- L1/L2 and other channels are consistently reported
- no manual button is required

### C. Improve channel semantics
The current successful result has:
- an unlabeled channel
- L1
- L2

The next investigation should determine whether the unlabeled channel is a total/aggregate entity and whether L1/L2 represent the actual current/power channels.

Do not prematurely relabel these.

### D. Improve measurement semantics
The detector currently sees different measurement types within the grouped source. Future work should distinguish:
- instantaneous power
- apparent power
- cumulative energy
- voltage
- current
- aggregate/total measurements

### E. Eventually build the EnergyIQ source model
The likely internal model is:

**Source**
→ **Channel(s)**
→ **Measurement(s)**

That model should allow both:
- whole-home multi-channel meters
- single-load smart plugs/meters

without requiring separate architectures.

---

# 17. Things NOT to do next

Do not:
- redesign the Consumption page
- change Cost calculations
- change Mystery Watts
- reintroduce aggressive candidate filtering
- require users to manually interrogate Class A meters
- infer three-phase merely from three channels
- hide individual-load meters
- remove broad discovery
- add lots of diagnostic text simply because the detector can generate it
- replace the working grouping logic with a simpler name-only grouping scheme

---

# 18. Safe-point recommendation

**3.1.418 should be treated as a major Meter Detector safe point.**

It represents the first successful combination of:

**broad discovery + classification + physical grouping + Class A automatic interrogation + compact UI**

Any subsequent Meter Detector change should preserve that behavior.

If a future revision breaks it, return to 3.1.418 and create the next sequential revision rather than stacking fixes on the broken version.

---

# 19. Overall project status

The project has moved beyond simple card/UI experimentation.

EnergyIQ now has the beginnings of a real commissioning/discovery layer capable of examining Home Assistant's existing electrical measurement ecosystem and determining what can be used.

The most important conceptual transition is:

**Old approach:**  
Look for something that looks like a whole-home meter.

**Current approach:**  
Discover electrical measurement sources broadly, understand their physical grouping, classify their usefulness, interrogate multi-channel sources automatically, and let EnergyIQ build a reliable internal model from what Home Assistant actually exposes.

That is the foundation for the next stage of EnergyIQ.
