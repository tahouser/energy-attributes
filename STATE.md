# EnergyIQ Project State

**Architecture:** Clean rebuild based on `ENERGYIQ_DESIGN.md`.
**Current release:** v3.1.18
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
