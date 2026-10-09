# EnergyIQ Project State

**Architecture:** Clean rebuild based on `ENERGYIQ_DESIGN.md`.
**Current release:** v3.1.465
**Working repository:** `tahouser/energy-attributes`

## Canonical design

`ENERGYIQ_DESIGN.md` is the functional specification. It defines the user workflow, UI behavior, training requirements, persistence rules, data relationships, validation criteria, and release/cleanup protocol.

## Mandatory change procedure

Every change order must follow `CHANGE_PROCEDURE.md` before implementation and before release.

The procedure requires the requested change to be isolated to the smallest necessary subsystem, validates frontend registration/custom-element identity, protects persisted data and working behavior, and verifies the exact release tag before HACS testing.

## Current implementation state

The current release preserves the established EnergyIQ behavior:

- Whole-home power as the authoritative total.
- Mystery Watts as whole-home power minus attributable trained-load power.
- Curated initial electrical-load candidates.
- A separate complete Home Assistant entity browser for Add Entity.
- Exact HA entity ownership as the authoritative association.
- Monitor/Ignore persistence with pending checkbox changes applied by Save.
- All / Monitored / Excluded device views.
- Monitor and Train selection columns.
- Quick ON/OFF, Full Cycle, and Manual training.
- Quick ON measurement time set to 5 seconds for more stable capture.
- Live trained-load attribution.
- Manual physical electrical devices.
- A single EnergyIQ workspace with a single State column.
- Compact ON/OFF State boxes: green `ON`, red `OFF`, white centered text.
- Live table updates that do not reposition the user's scroll position.
- Monitor selection changes that preserve table scroll position.

## Repository rules

- Historical runtime JavaScript is not retained as active files.
- Temporary backups/placeholders are not part of the runtime tree.
- The frontend uses a version-isolated custom-element identity for frontend releases; ordinary backend-only version bumps should not change it.
- There is one release workflow.
- The manifest version is changed only after the complete release snapshot is ready.
- The final Git tag/release must point to that exact final commit before HACS testing.

## Data compatibility

The rebuild intentionally keeps the existing EnergyIQ config-entry domain and persisted candidate/training concepts so an installed configuration can be upgraded without intentionally discarding monitored loads or learned training data.

## Testing gate

Do not ask the user to update HACS until the repository has been checked for:

1. Python syntax validity.
2. JavaScript syntax validity.
3. Consistent frontend/backend WebSocket commands.
4. Clean runtime file tree.
5. Consistent manifest/integration/frontend version metadata.
6. Matching Home Assistant panel registration and JavaScript custom-element identity.
7. Correct Git tag/release target.
8. Published, non-draft, non-prerelease GitHub release.

Only then is the build ready for Home Assistant validation.


## Session record — 2026-10-08

### Completed in v3.1.465

This session closed the two remaining small dashboard presentation items:

1. **Mystery Watts card spacing**
   - Added 10px of top spacing to the Mystery Watts body area in the EnergyIQ dashboard card.
   - Scoped the spacing to the Mystery Watts view so the Consumption and Cost views are not intentionally affected.
   - The user subsequently confirmed that the Mystery Watts card is fixed.

2. **Electrical Load typography on mobile**
   - The Amperage and Voltage readings were rendering larger than the other metric values on mobile because the mobile `.metric strong` rule set the other metrics to 17px.
   - Added a mobile-specific `.electrical-readings>div>strong` override at 17px with bold weight to match the other mobile metric values.
   - Updated the frontend cache/version registration to `46500` and the manifest version to `3.1.465`.
   - The release workflow completed successfully and GitHub published release `v3.1.465`.

### Scope boundaries and status

- The HACS listing icon issue was intentionally left untouched. EnergyIQ branding files were not changed for this issue; wait for the upstream HACS icon endpoint/frontend changes before revisiting it.
- No intended changes were made to training logic, persisted training data, entity associations, energy calculations, or the Cost page behavior.
- **User validation still pending:** the user will install v3.1.465 through HACS when it appears and confirm the mobile Electrical Load number sizing on the actual Home Assistant screen.
- The release workflow success was verified. The full validation checklist in `CHANGE_PROCEDURE.md` was not independently rerun as part of this small final CSS revision; do not describe the release as having passed every listed validation gate.

### Next action

After the user tests v3.1.465, record whether the mobile Amperage and Voltage values visually match the other metric numbers. If they do, this closes the two remaining UI items from this session. Keep the HACS icon issue separate until upstream resolves it.
