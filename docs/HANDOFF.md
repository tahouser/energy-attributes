# EnergyIQ Successor Handoff

**Current release:** v3.1.468  
**Repository:** https://github.com/tahouser/energy-attributes  
**License:** MIT  
**Project status:** Stable handoff; no ongoing maintenance commitment from the original project owner.

## Purpose and ownership

EnergyIQ was built as a creative project and is being shared with the Home Assistant community. The original owner does not promise ongoing support, compatibility updates, bug fixes, or a feature roadmap. A future maintainer should take responsibility only if they freely choose to do so.

Treat v3.1.468 as the practical baseline. The owner installed it through HACS and reported that it looks good. The release changes were aimed at validation and release safeguards; no runtime behavior or persisted-data format change was intended.

- Release: https://github.com/tahouser/energy-attributes/releases/tag/v3.1.468
- Validation run: https://github.com/tahouser/energy-attributes/actions/runs/38059139335
- Release workflow run: https://github.com/tahouser/energy-attributes/actions/runs/38059158252
- Validated release commit: `97130a1ae9155d6e43842506f559c783d923d75c`

## What EnergyIQ does

EnergyIQ attributes part of the whole-home electrical load to known, trained loads. The configured whole-home power meter remains authoritative:

**Mystery Watts = whole-home power − attributable trained-load power**

Users select loads to monitor, associate Home Assistant entities or add manual physical loads, and train supported loads. The integration uses learned signatures and current load information to estimate active attributed power. See [README.md](../README.md) for the user-facing overview and [ENERGYIQ_DESIGN.md](../ENERGYIQ_DESIGN.md) for detailed intended behavior.

## Read these first

1. **[STATE.md](../STATE.md)** — current release, known verified status, boundaries, and recent history.
2. **[CHANGE_PROCEDURE.md](../CHANGE_PROCEDURE.md)** — mandatory safety and release checks.
3. **[ENERGYIQ_DESIGN.md](../ENERGYIQ_DESIGN.md)** — functional behavior and persistence expectations.
4. **[docs/ARCHITECTURE.md](ARCHITECTURE.md)** — conceptual component boundaries and architectural notes.
5. **[README.md](../README.md)** and **[LICENSE](../LICENSE)** — user-facing project status and legal terms.

## Current maintenance recommendation

Do not start with a rewrite, cleanup campaign, new features, or cosmetic redesign. The current release has been installed and checked by the project owner. Prefer leaving it alone unless a maintainer identifies a reproducible defect or a Home Assistant compatibility issue.

For a reported issue:

1. Record the EnergyIQ version, Home Assistant version, exact steps, expected result, actual result, and relevant sanitized logs.
2. Determine whether it is reproducible and whether it affects the current release.
3. Read the design and change procedure before proposing code.
4. Identify the smallest affected subsystem and explicitly identify areas that must remain untouched.
5. Protect saved training, candidate classifications, and entity associations.
6. Validate the exact proposed change before releasing it.
7. Do not publish or announce a release until its tag, target commit, manifest version, published status, and successful validation have been checked.

## Data safety — highest priority

Existing users may have invested substantial time in selecting, associating, and training loads. Treat that information as user data, not disposable cache.

- Do not clear, rename, or replace persisted storage as a side effect of a code change.
- Do not reset training or rebuild the candidate inventory destructively to simplify implementation.
- Do not alter training timing, sampling, baseline logic, ON/OFF detection, accepted-reading rules, or learned-signature calculation as part of an unrelated UI or maintenance change.
- If a data migration is truly required, document the old and new formats, preserve a recoverable copy, implement a safe migration, and test both migration and normal startup before release.
- If data safety cannot be demonstrated, do not ship the change.

## Repository and release notes

- `main` is the working branch.
- The version in `custom_components/energyiq/manifest.json` is the release version.
- Release automation is defined in `.github/workflows/release-on-version-change.yml` and is designed to run after the `Validate EnergyIQ` workflow succeeds for a push to `main`.
- Validation is defined in `.github/workflows/validate.yml`. It checks Python syntax, a standalone persistence contract test, JavaScript syntax, and structural assumptions including the frontend entry point and registered card file.
- Always inspect the actual frontend registration in `custom_components/energyiq/__init__.py` before editing or validating a frontend file. The runtime card path is explicitly registered there; do not assume a similarly named generic or historical file is active.
- Do not move an existing tag or publish from an unvalidated intermediate commit.
- Automated checks are not a substitute for a Home Assistant smoke test when a change affects runtime behavior.

## Before accepting responsibility

A prospective maintainer should independently review the repository and decide whether they are willing and able to support it. In particular, they should understand Home Assistant custom integrations, the training/persistence model, the frontend/backend WebSocket contract, and the release workflow.

There is no requirement that a successor accept the project. If no maintainer volunteers, the repository remains available under the MIT License on an as-is basis.

## Scope boundary

This handoff does not promise that every future Home Assistant version will remain compatible, that every hardware meter will be supported, or that issues will be fixed on a schedule. It records the current project's intent and the precautions needed to change it responsibly; it is not a service-level agreement.
