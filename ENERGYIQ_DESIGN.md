# EnergyIQ — Functional Design Specification

## 1. Purpose

EnergyIQ is a Home Assistant custom integration for whole-home electrical attribution.

The authoritative whole-home meter provides the total electrical demand. EnergyIQ maintains a set of individual electrical-load candidates, learns their electrical signatures, and estimates how much of the whole-home load can currently be attributed to known trained loads.

Primary concept:

**Whole-home power − attributable trained-load power = Mystery Watts**

Mystery Watts is a primary output, not an incidental diagnostic.

This document is the functional specification for a clean rebuild. It intentionally describes behavior, UI, data relationships, and acceptance criteria rather than preserving the implementation structure of previous revisions.

---

## 2. Design principles

1. **One clean implementation.** Do not layer patches, compatibility loaders, duplicate UI modules, or versioned runtime files.
2. **One authoritative frontend entry point.** The EnergyIQ panel is loaded from one stable module.
3. **One authoritative backend data model.** Candidate, HA entity, and HA device are distinct concepts.
4. **Persistence is first-class.** Monitoring choices and training results survive reloads and updates.
5. **Initial discovery and later entity addition are different workflows.** Initial discovery is curated; Add Entity is the escape hatch.
6. **The UI should reflect the real backend state.** No duplicate State columns, shadow lists, or frontend-only ownership assumptions.
7. **Versioning is release metadata, not application logic.** Runtime files must not contain piles of historical versioned copies.
8. **Cleanup is part of development.** A completed release contains only files required by the current architecture plus intentional documentation/tests.
9. **Test before release.** A version is not considered ready because files exist in GitHub; the complete repository snapshot must be internally consistent.

---

## 3. Main workspace

The EnergyIQ workspace is the primary user interface.

### Header / summary

Display live summary information:

- Home Power Now
- Trained Active Watts
- Mystery Watts
- Monitored load count
- Trained count
- Untrained count

The summary should update without requiring the user to rebuild or reselect the workspace.

### Main load table

Each EnergyIQ load is represented once.

Columns / information:

1. **Monitor** — checkbox controlling whether the load participates in EnergyIQ monitoring.
2. **Load / Device** — friendly load name.
3. **Area** — Home Assistant area when known.
4. **Category** — electrical-load category.
5. **Training** — current training state and available training action.
6. **Power / Status** — current load information.

The exact visual layout may adapt to the available panel width, but each load must appear only once and each logical field must have one authoritative column.

### State visual

The live ON/OFF state is represented by a compact status box.

Required appearance:

- Same approximate height as the Monitor checkbox.
- Approximately twice the width of the checkbox.
- Centered text.
- `ON` uses a green background with white text.
- `OFF` uses a red background with white text.
- The state box must not create a duplicate State column.

If a load has no meaningful HA ON/OFF state, the UI should use an appropriate neutral representation rather than inventing a state.

---

## 4. Monitoring workflow

### Initial candidate inventory

At installation/discovery time, EnergyIQ creates a **curated candidate inventory** rather than importing every Home Assistant entity.

Candidate discovery should prioritize evidence that an entity represents an electrical load, including controllable/load-like domains and direct power/energy measurements.

The initial inventory is deliberately useful and manageable.

### Monitor checkbox

The Monitor checkbox determines whether a candidate is currently included in EnergyIQ monitoring.

Expected behavior:

1. User changes one or more checkboxes.
2. User saves/applies the selection.
3. Backend persists the classifications.
4. Workspace refreshes from backend state.
5. Selection remains correct after reload/restart.

A save operation must not silently discard unrelated candidates or training information.

### Excluded / ignored loads

Candidates that are not monitored remain available in the workspace as excluded/ignored candidates unless the UI is explicitly filtered.

The user must be able to change a load between monitored and ignored without recreating it.

---

## 5. Add Entity workflow

Add Entity is the escape hatch for an entity missing from the curated candidate inventory.

### Entity browser requirements

The browser must support:

- Search by friendly name.
- Search by entity ID.
- Search by domain.
- Search by state.
- Search by HVAC action when applicable.
- Complete HA entity-registry discovery, rather than only the curated EnergyIQ candidate inventory.

The browser may contain substantially more entities than the main EnergyIQ candidate list.

### Ownership / association

The exact HA entity attachment is authoritative.

An entity is considered already associated only when that exact entity ID is attached to an EnergyIQ candidate.

HA device ID alone must not cause unrelated entities on the same HA device to appear as already monitored.

When an entity is already associated, the dialog should show:

- EnergyIQ load name.
- Candidate ID.
- Current monitoring classification.

The user must not encounter an unexplained disabled/dead-end selection control.

### Adding an entity

For an enabled HA entity:

1. User searches.
2. User selects the entity.
3. EnergyIQ shows ownership/association information.
4. If unassociated, EnergyIQ creates or extends the appropriate candidate.
5. The entity becomes monitored according to the defined workflow.
6. Workspace refreshes.
7. The resulting load is visible in the monitored list.

Adding an entity must not create duplicate EnergyIQ loads when the exact entity is already attached.

Disabled HA entities may be displayed for discovery, but they must not be added until enabled in Home Assistant.

---

## 6. Manual electrical devices

EnergyIQ supports physical electrical loads that have no usable HA entity.

A manual electrical device contains at least:

- User-defined name.
- Category.
- EnergyIQ candidate identity.
- Monitoring classification.
- Training state/signature.

Manual training must never send a command to Home Assistant for the physical load.

---

## 7. Training model

Training belongs to the EnergyIQ electrical load, not merely to an HA entity.

Supported methods:

### Quick ON/OFF

For controllable loads.

The established functional behavior is:

- Three controlled cycles.
- Approximately 2.5 seconds of ON measurement, using the later ON plateau.
- Approximately 1.5 seconds of OFF settling, using the post-OFF plateau.
- Cycle load is ON plateau minus OFF plateau.
- Device is turned OFF by timing rather than waiting indefinitely for a power threshold.

The existing algorithm is a known requirement and should not be changed during a UI/integration rebuild unless the user explicitly requests a training change.

### Full Cycle

For loads whose electrical behavior changes during operation, including HVAC and appliances such as washers, dryers, and ovens.

The UI must make clear that this is different from Quick ON/OFF.

### Manual Training

For physical loads without HA control.

The user operates the appliance normally while EnergyIQ watches whole-home power.

No HA control command is sent.

---

## 8. Training state

Each candidate can have a training state such as:

- Not trained.
- Training.
- Complete.
- Error / failed.

A completed training record contains the information necessary for live attribution, including the learned load signature.

A load that is OFF must not contribute learned training wattage to Trained Active Watts.

When available, a positive live HA power measurement is preferred. Otherwise, a completed learned signature can be used while an associated controllable HA load is ON.

---

## 9. Live attribution

For every completed trained load, EnergyIQ determines whether it is currently active and estimates its attributable watts.

The whole-home meter remains authoritative.

The dashboard calculates:

- **Home Power Now** = current whole-home meter value.
- **Trained Active Watts** = sum of currently attributable completed trained loads.
- **Mystery Watts** = Home Power Now − Trained Active Watts.

The implementation must prevent negative or nonsensical attribution from corrupting the dashboard.

---

## 10. Data relationships

EnergyIQ must maintain these as separate concepts:

### HA device

A Home Assistant device grouping. It may contain multiple entities.

### HA entity

A specific Home Assistant entity ID such as a switch, climate entity, sensor, etc.

### EnergyIQ load / candidate

The electrical load being attributed. It may contain one or more HA entities and/or be a manual physical device.

This distinction prevents unrelated entities on one HA device from being incorrectly merged into one electrical load.

---

## 11. Persistence

Persistent information includes, at minimum:

- EnergyIQ candidates.
- Candidate metadata.
- Monitor/ignore classification.
- Entity attachments.
- Training state.
- Learned signatures.
- Relevant training history/state required to resume safely.

Reloading Home Assistant must not reset the user's monitored list.

Updating the integration through HACS must not intentionally erase user configuration.

---

## 12. Home Assistant integration behavior

The integration must:

- Load through a normal Home Assistant custom integration structure.
- Register its frontend through one stable module.
- Expose backend commands through a coherent, documented WebSocket API.
- Keep frontend and backend command names synchronized.
- Register sensors/entities through normal HA mechanisms where applicable.
- Fail cleanly when the configured whole-home power entity is unavailable.
- Avoid relying on browser-specific state as the source of truth.

---

## 13. Frontend architecture requirement

The frontend should be rebuilt as a small, coherent application rather than a chain of historical patches.

Preferred conceptual separation:

- **Panel/application** — layout, rendering, user interaction, workspace lifecycle.
- **Backend API contract** — WebSocket requests/responses.
- **Training UI logic** — presentation and interaction for training methods.
- **Optional accounting/reporting helpers** — only if genuinely needed.

No file should exist solely because an older revision once needed it.

No versioned runtime filename should be required for cache busting.

Cache invalidation should be handled through the normal module URL/version mechanism, not by retaining old application files.

---

## 14. Backend architecture requirement

Conceptual backend components:

- Integration setup/unload.
- Configuration flow.
- Coordinator/state manager.
- Candidate discovery and persistence.
- Training engine.
- Long/full-cycle training support.
- Accounting/live attribution.
- WebSocket API.
- HA sensor entities.

Each component should have one responsibility and one authoritative implementation.

The frontend must not duplicate backend business rules when the backend can provide the authoritative result.

---

## 15. WebSocket API contract

The UI needs a small, stable command set covering:

- List configured EnergyIQ entries.
- Get complete workspace state.
- Save monitoring selection.
- List available HA entities.
- Add an HA entity.
- Add a manual electrical device.
- Start training.
- Stop/cancel training where supported.
- Return training progress/results.

Every response should be structured and predictable.

Errors should be returned in a form the UI can display to the user rather than leaving controls silently disabled.

---

## 16. UI interaction rules

- Search fields should be present where the entity count is large.
- Buttons should have visible enabled/disabled states.
- Long operations should show progress or a clear status.
- Workspace refreshes should preserve the user's place/scroll position when practical.
- Modal dialogs should not open unnecessary browser tabs/windows.
- The UI should remain usable when there are roughly 119 monitored loads and an HA entity registry of roughly 2,400 entities.
- The Add Entity browser must not be confused with the monitored-load list.

---

## 17. Release and cleanup protocol

This is part of the design, not an afterthought.

### Source of truth

- `main` is the authoritative working repository.
- The integration version appears in one authoritative manifest.
- Frontend cache/version identifiers are generated or centrally controlled rather than manually scattered through files.

### Release procedure

1. Complete code changes.
2. Run syntax/tests.
3. Verify the final file tree.
4. Verify all frontend/backend command names match.
5. Verify manifest version.
6. Verify the integration's registered frontend URL references the same final frontend.
7. Remove obsolete runtime files before versioning the release.
8. Make the version bump the final functional repository change.
9. Verify the resulting Git tag/release points to the exact final commit.
10. Only then update/test through HACS.

### Cleanup rules

Historical code belongs in Git history/tags, not in the runtime `www` directory.

Do not create temporary README files, placeholder backup files, duplicate loaders, or version-numbered frontend copies as part of normal development.

Before a release, the runtime directory must contain only the files actually loaded by the current architecture.

### Automation rule

There must be one authoritative release/version workflow. Competing workflows must not be allowed to create tags from intermediate commits.

---

## 18. Validation / acceptance criteria

A rebuild is considered ready for Home Assistant testing only when all of the following are true:

### Repository

- Clean, intentional file tree.
- No obsolete versioned runtime JavaScript files.
- No temporary placeholders.
- One frontend entry point.
- One version source of truth.
- One release workflow.

### Backend

- Python syntax passes.
- Integration loads normally.
- Configured whole-home meter is available to the coordinator.
- Candidate persistence works.
- Monitoring persistence works.
- Training persistence works.
- WebSocket commands resolve to real handlers.

### Frontend

- JavaScript syntax is valid.
- Panel loads without a blank screen or indefinite loading state.
- Workspace data appears.
- Monitor selection saves and reloads.
- Add Entity search works.
- Ownership information is accurate.
- Add Entity does not duplicate an existing exact entity association.
- Training controls are available for the appropriate load types.
- State box displays ON/OFF correctly.
- There is only one State/Status representation.
- Summary values are visible and update from backend data.

### HACS/release

- Manifest version, integration version display, and frontend registration are consistent.
- The release/tag points to the exact commit containing the final code.
- The release package contains the intended runtime tree.

Only after these checks pass should the user be asked to update HACS and test in Home Assistant.

---

## 19. Rebuild strategy

The rebuild should treat the previous implementation as a **behavioral reference**, not as the new architecture.

Preserve:

- EnergyIQ's purpose.
- Whole-home meter concept.
- Mystery Watts calculation.
- Curated initial candidates.
- Complete Add Entity browser.
- Exact entity ownership model.
- Monitoring persistence.
- Quick ON/OFF training behavior.
- Full Cycle training.
- Manual training.
- Live trained-power attribution.
- The established workspace UI concept.
- The requested ON/OFF state visual.

Discard:

- Historical frontend patch layers.
- Versioned runtime JS copies.
- Loader chains whose only purpose is compatibility with prior versions.
- Duplicate State/Status implementations.
- Temporary backup/README files created during debugging.
- Release/tag automation that can publish intermediate commits.
- Any implementation detail that is not required by this specification.

The result should be understandable by opening the repository today without needing to know the history of the previous 20+ revisions.
