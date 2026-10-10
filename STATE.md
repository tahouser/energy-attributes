# EnergyIQ Project State

**Architecture:** Clean rebuild based on `ENERGYIQ_DESIGN.md`.
**Latest verified release:** v3.1.468 (published 2026-10-10 and confirmed installed by the project owner). No next version is planned. The release is limited to release-validation safeguards and handoff-state corrections; no runtime behavior or persisted-data format change was intended.
**Working repository:** `tahouser/energy-attributes`

## Handoff direction

EnergyIQ is a completed creative project being offered to the Home Assistant community for use and possible transfer to a willing maintainer. The original project owner is not committing to ongoing maintenance, support, or a future feature schedule. Avoid new features, broad refactoring, and cosmetic redesigns as part of the handoff.

The repository is intended to use the MIT License. This allows broad use, modification, and redistribution, including commercial use, subject to the license terms. The software is provided as-is without warranty. See the root `LICENSE` and `README.md`.

## Canonical design

`ENERGYIQ_DESIGN.md` is the functional specification. It defines the user workflow, UI behavior, training requirements, persistence rules, data relationships, validation criteria, and release/cleanup protocol.

## Mandatory change procedure

Every code change must follow `CHANGE_PROCEDURE.md` before implementation and before release.

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
2. JavaScript syntax validity for the active panel, meter detector, and card entry point.
3. Consistent frontend/backend WebSocket commands.
4. Clean runtime file tree.
5. Consistent manifest/integration/frontend version metadata.
6. Matching Home Assistant panel registration and JavaScript custom-element identity.
7. Correct Git tag/release target.
8. Published, non-draft, non-prerelease GitHub release.
9. Successful GitHub Actions validation workflow for the release commit.

Only then is the build ready for Home Assistant validation.

## Session record — 2026-10-10 — Handoff preparation

- Confirmed the existing public release is v3.1.466.
- Added the MIT License and documented the project's as-is status and lack of an ongoing support commitment.
- Reframed the old feature roadmap as historical context rather than a current promise of future work.
- Verified that v3.1.467 was published, non-draft, and non-prerelease; tag `v3.1.467` pointed to commit `d6a0b0dca6ce9940f30cc748494e5515094edee0`, whose validation workflow completed successfully.
- Audited the registered Lovelace card path. Runtime registration uses `energyiq-card-3.1.464.js` (SHA `31ee0074937adfe145f4211c1f2ae24f4adee71e`); the similarly named `energyiq-card.js` is an older, different file (SHA `41b292ad72ad819a93abe7e123beb07e2692b1d1`). The registered versioned file is the active card entry point; do not replace it with the older generic file.
- Corrected validation to syntax-check and require the actual card file named by `CARD_PATH`, rather than syntax-checking the unrelated generic card file.
- Corrected release automation so it runs only after the `Validate EnergyIQ` workflow succeeds on a main-branch push, checks out that exact validated commit, and creates the release targeting that SHA. This closes the prior race where a manifest-triggered release could be published before validation completed.
- v3.1.468 contained the validation/release safeguards described above; no runtime behavior or persisted data format change was intended. Its exact tag, published release, manifest version, and successful validation were verified before the HACS update was recommended.
- Published v3.1.468 after validation workflow success. The release tag points to the exact validated commit `97130a1ae9155d6e43842506f559c783d923d75c`; the manifest at that tag reports `3.1.468`. Validation run: https://github.com/tahouser/energy-attributes/actions/runs/38059139335. Release workflow run: https://github.com/tahouser/energy-attributes/actions/runs/38059158252. Published release: https://github.com/tahouser/energy-attributes/releases/tag/v3.1.468.
- The project owner installed v3.1.468 through HACS and reported that it looks good in Home Assistant. This is a practical user validation of the release; no additional runtime changes are requested.
- Handoff remains the priority: keep the working code stable, avoid new features and redesigns, and prepare clear documentation for a willing successor. The owner is not committing to ongoing maintenance or support.

## Previous session record — 2026-10-08

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
- **User validation still pending at that time:** the user planned to install v3.1.465 through HACS and confirm the mobile Electrical Load number sizing on the actual Home Assistant screen. Do not treat that old validation note as a current handoff requirement without checking later context.
- The full validation checklist in `CHANGE_PROCEDURE.md` was not independently rerun as part of that small CSS revision; do not describe that historical release as having passed every listed validation gate.

### Next action from that session

The old next action was to confirm whether the mobile Amperage and Voltage values visually matched the other metric numbers. Keep the HACS icon issue separate until upstream resolves it.
