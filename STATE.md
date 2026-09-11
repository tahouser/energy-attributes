# EnergyIQ Project State

**Architecture:** Clean rebuild based on `ENERGYIQ_DESIGN.md`.
**Current target:** v3.0.0
**Working repository:** `tahouser/energy-attributes`

## Canonical design

`ENERGYIQ_DESIGN.md` is the functional specification. It defines the user workflow, UI behavior, training requirements, persistence rules, data relationships, validation criteria, and release/cleanup protocol.

## Rebuild status

The implementation is being reconstructed as a coherent application rather than extended through historical frontend patches.

The current design preserves the established EnergyIQ behavior:

- Whole-home power as the authoritative total.
- Mystery Watts as whole-home power minus attributable trained-load power.
- Curated initial electrical-load candidates.
- A separate complete Home Assistant entity browser for Add Entity.
- Exact HA entity ownership as the authoritative association.
- Monitor/Ignore persistence.
- Quick ON/OFF, Full Cycle, and Manual training.
- Live trained-load attribution.
- Manual physical electrical devices.
- A single EnergyIQ workspace with a single State column.
- Compact ON/OFF State boxes: green `ON`, red `OFF`, white centered text.

## Repository rules

- Historical runtime JavaScript is not retained as active files.
- Temporary backups/placeholders are not part of the runtime tree.
- Frontend cache/versioning does not require versioned JavaScript filenames.
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
5. Consistent manifest/integration/frontend version.
6. Correct Git tag/release target.

Only then is the build ready for Home Assistant validation.
