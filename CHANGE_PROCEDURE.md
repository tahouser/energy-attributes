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
- No obsolete runtime frontend files or temporary workflow files remain.

### Required functional sanity checks

- The panel registration is valid.
- The main JavaScript file exists at the registered URL.
- The panel can instantiate its registered custom element.
- A backend-only change has not altered the frontend unnecessarily.
- A frontend change has not altered backend persistence/training behavior unnecessarily.
- The release tag points to the exact commit that contains the final validated code.
- The GitHub release is published and not draft/prerelease.

## 7. Release procedure

1. Complete implementation.
2. Run validation.
3. Correct any failure before release.
4. Ensure the final manifest version is correct.
5. Ensure the release workflow creates the tag/release from the validated final commit.
6. Verify the published release tag and target commit.
7. Verify the repository no longer contains temporary change-application workflows/scripts.
8. Only then tell the user to refresh/update HACS.

Do not ask the user to create branches, tags, releases, or pull requests as part of this procedure.

## 8. Post-change report

Every completed change order should report briefly:

- Change made.
- Files changed.
- Version released.
- Validation result.
- Release/tag verification result.
- Any known limitation or follow-up.

## 9. Failure-prevention rule

If a requested change can be implemented without touching a subsystem, do not touch that subsystem.

In particular:

> **Changing backend training timing does not justify changing frontend registration.**

The v3.1.1 blank-panel failure demonstrated why this rule is mandatory.
