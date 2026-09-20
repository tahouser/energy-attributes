# Home Assistant Compliance Audit — EnergyIQ

Baseline: v3.1.117 (b27fa24e963828d963979c15b1bbf58ac5b2a5c7)

This branch is the compliance workbench. The v3.1.117 release remains the protected runtime baseline and is not modified by this audit.

## Scope

The audit follows the current Home Assistant Integration Quality Scale. Bronze is the first target; Silver/Gold/Platinum items are tracked but are not allowed to drive unrelated functional changes.

Reference:
https://developers.home-assistant.io/docs/core/integration-quality-scale/

## Current findings

### Bronze — already present or close

- UI config flow exists.
- Branding assets exist.
- Integration has unique IDs for its current sensor entities.
- Entity event listener cleanup is present for the training sensor.
- Dependency transparency is straightforward: the manifest has no third-party Python requirements.
- Config entry unload support exists.
- Automated training tests exist.
- The coordinator now has an explicit _async_update_data() implementation.

### Bronze — work required

1. Config-flow tests
   - There is no dedicated config-flow test module.
   - Add complete tests for the user flow and options flow.
   - Include duplicate configuration protection and error/recovery paths.

2. Config-flow data descriptions
   - The current translation provides a step description but does not provide data_description for the selected power entity.
   - Add the required field-level context.

3. ConfigEntry data/options separation
   - Audit which values are immutable setup data versus mutable commissioning options.
   - Preserve existing monitored/excluded classifications and learned training state.

4. Runtime data
   - Current runtime coordinator storage uses hass.data[DOMAIN][entry.entry_id].
   - Migrate runtime-only coordinator state to ConfigEntry.runtime_data.
   - Do not move or rewrite the persistent training store.

5. Entity naming
   - Current sensors set _attr_name directly.
   - Review migration to has_entity_name = True and appropriate translation/name patterns.

6. Setup validation
   - Add explicit validation that the configured whole-home power source is usable during setup.
   - Do not make setup depend on a transient Shelly RPC if the selected Home Assistant entity is the authoritative configured source.

7. Unique config entry
   - Determine and enforce the intended single EnergyIQ configuration model.
   - Add tests for attempting a second configuration.

8. Documentation
   - Expand README/end-user documentation with installation, prerequisites, removal, configuration, and high-level purpose.
   - Document the distinction between whole-home power, live device watts, trained watts, and Mystery Watts.

9. Polling review
   - Document and verify the normal coordinator update interval.
   - Treat the direct Shelly sampler used only during active training separately from normal integration polling.

10. Test coverage
   - Existing tests are focused on training logic.
   - Build a real Home Assistant test suite for the integration before claiming Bronze.

## Important release observation

The v3.1.117 release workflow succeeded, but the repository's validation workflow failed at the existing release-structure/panel-loading check. Therefore compliance work starts with a known validation limitation rather than assuming the repository is already clean.

The v3.1.117 GitHub tag is confirmed to point to the protected baseline commit.

## Change safety rules

- Do not modify the v3.1.117 tag.
- Do not alter training timing or the learned-signature algorithm as part of compliance work.
- Do not alter the Shelly configuration.
- Do not delete/recreate the EnergyIQ config entry.
- Do not discard learned training data.
- Keep compliance changes isolated and reversible.
- A compliance change that risks the working runtime behavior is a stop-and-review item, not something to force through.

## First implementation sequence

1. Build config-flow tests.
2. Fix config-flow descriptions/data handling.
3. Add unique-entry protection and tests.
4. Migrate runtime coordinator storage.
5. Bring entity naming into current HA conventions.
6. Add setup validation.
7. Expand documentation.
8. Run full tests and coverage.
9. Only after all Bronze rules are demonstrably satisfied, consider declaring Bronze and preparing the quality-scale submission.
