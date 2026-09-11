# EnergyIQ Change Procedure

This document is the mandatory procedure for every EnergyIQ change order.

## 1. Start from the current state

Before changing code:

1. Read `ENERGYIQ_DESIGN.md` for the intended behavior.
2. Read `STATE.md` for the current repository/release state.
3. Read this `CHANGE_PROCEDURE.md`.
4. Inspect the current implementation of every file that can be affected by the requested change.
5. Identify whether the change is frontend, backend, data/persistence, release-only, or a combination.

Do not assume that a version bump requires changes to unrelated components.

## 2. Define the change boundary

For each change, explicitly identify:

- What behavior is being changed.
- Which files actually need to change.
- Which files must NOT change.
- Whether persisted data or configuration is affected.
- Whether the frontend custom-element identity is affected.
- Whether the release version must change.

**Rule:** Make the smallest change that satisfies the request. A backend-only change must not modify frontend registration, frontend JavaScript identity, or UI code unless there is a demonstrated dependency.

## 3. Frontend identity safety

EnergyIQ has two values that must agree when registering the panel:

- Home Assistant `panel_custom` `webcomponent_name` in `custom_components/energyiq/__init__.py`.
- The JavaScript `TAG` and `customElements.define(TAG, ...)` identity in `custom_components/energyiq/www/energyiq-panel.js`.

The frontend custom-element name is **stable infrastructure**, not a value to increment automatically with every release.

Do not change it for a normal version bump.

If it must change, change the registration and JavaScript identity atomically and verify all of the following before release:

- `webcomponent_name` matches the JavaScript tag exactly.
- The module URL points to the correct JavaScript file.
- The JavaScript defines that exact tag.
- No stale/old frontend loader remains active.

A mismatch is a release blocker because it can produce a completely blank sidebar panel.

## 4. Versioning

The manifest version is the release version.

When a release is required:

- Update `custom_components/energyiq/manifest.json`.
- Update the sidebar/version metadata in `__init__.py` when appropriate.
- Update the frontend display version only when the frontend actually changed.
- Do not change the frontend custom-element identity merely because the version changed.

The release tag must be created from the exact final commit containing the complete change.

## 5. Implementation

Make the requested change without reworking unrelated working behavior.

Preserve:

- persisted monitored/excluded classifications;
- learned training data and signatures;
- exact HA entity associations;
- established WebSocket command names and payloads;
- working live-update behavior;
- table scroll behavior;
- the established EnergyIQ workflow defined in `ENERGYIQ_DESIGN.md`.

Do not introduce temporary runtime files, compatibility shims, duplicate loaders, or patch layers unless they are explicitly required and documented.

## 6. Validation gate

Before telling the user to update HACS, verify:

### Required automated checks

- Python compilation succeeds:
  `python -m compileall -q custom_components/energyiq tests`
- JavaScript syntax succeeds:
  `node --check custom_components/energyiq/www/energyiq-panel.js`
- Manifest and integration/frontend version metadata are consistent.
- Frontend registration and JavaScript custom-element identity match exactly.
- WebSocket commands referenced by the frontend exist in the backend.
- Every `DataUpdateCoordinator` subclass used by `async_config_entry_first_refresh()` implements a working `_async_update_data()` method. A missing method causes Home Assistant startup to fail with `NotImplementedError: Update method not implemented` even when Python compilation succeeds.
- No obsolete runtime frontend files or temporary workflow files remain.

### Required functional sanity checks

- The panel registration is valid.
- The main JavaScript file exists at the registered URL.
- The panel can instantiate its registered custom element.
- The integration can complete `async_setup_entry()` through its first coordinator refresh without raising a startup exception.
- A backend-only change has not altered the frontend unnecessarily.
- A frontend change has not altered backend persistence/training behavior unnecessarily.
- The release tag points to the exact commit that contains the final validated code.
- The GitHub release is published and not draft/prerelease.
- The published release version exactly matches the final manifest version on the release target commit.
- HACS-visible release verification is performed only after the GitHub release itself has been confirmed to exist.

## 7. Release procedure

1. Complete implementation.
2. Run validation.
3. Correct any failure before release.
4. Ensure the final manifest version is correct.
5. Ensure the release workflow creates the tag/release from the validated final commit.
6. Verify the published release tag and target commit.
7. Verify the published release is not draft/prerelease and that its version exactly matches the manifest on that target commit.
8. Verify the repository no longer contains temporary change-application workflows/scripts.
9. Re-run or inspect the final validation workflow against the **exact release target commit**, not merely the current `main` branch.
10. Only then tell the user to refresh/update HACS.

Do not ask the user to create branches, tags, releases, or pull requests as part of this procedure.

### Release failure lesson — v3.1.8 / v3.1.9

A release/version change was reported as corrected before the corresponding GitHub release actually existed. The repository had advanced, but HACS could only see the published release (v3.1.8), not the intended v3.1.9.

Therefore:

> **Never report a version as released, HACS-available, or ready to install until the GitHub release has been directly verified by its tag, target commit, published status, and manifest version.**

A commit on `main` is not a release. A successful validation run is not a release. A version string in the manifest is not a release. All four release conditions must be verified before giving the user an update instruction.

## 8. Post-change report

Every completed change order should report briefly:

- Change made.
- Files changed.
- Version released.
- Validation result.
- Release/tag verification result.
- Any known limitation or follow-up.

If a release has **not** been published and verified, explicitly say that it is not yet available through HACS rather than implying that it is.

## 9. Failure-prevention rule

If a requested change can be implemented without touching a subsystem, do not touch that subsystem.

In particular:

> **Changing backend training timing does not justify changing frontend registration.**

The v3.1.1 blank-panel failure demonstrated why this rule is mandatory.

A second mandatory lesson is:

> **Never confuse a validated repository state with a published HACS release.**

The v3.1.8/v3.1.9 incident demonstrated why release existence and target-commit verification must be the final gate.