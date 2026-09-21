# Contributing to EnergyIQ

EnergyIQ is a Home Assistant custom integration. Changes should favor small, reversible revisions over large combined changes.

## Development rules

1. Keep each revision focused on one architectural or functional change.
2. Do not combine frontend redesign, persistence changes, and training changes in one revision.
3. The training engine is a protected subsystem. Do not change its algorithm while working on unrelated architecture or UI.
4. Preserve the known rollback point at EnergyIQ 3.1.36.
5. Validate the repository after every revision.
6. Prefer Home Assistant-native patterns and APIs over custom replacements.
7. Treat Home Assistant's entity and device registries as the source of truth for current HA metadata.
8. EnergyIQ should persist EnergyIQ-specific state; it should not become a second copy of Home Assistant's metadata.
9. Do not claim a fix is complete until the relevant behavior has been tested in Home Assistant.

## Revision discipline

The repository uses sequential EnergyIQ revisions. A failed experiment should be reverted to the last known-good revision before another implementation is attempted, rather than stacking additional fixes on top of a broken change.

## Architecture work

Architecture changes should follow the roadmap documented in docs/ARCHITECTURE.md and the Home Assistant Integration Quality Scale checklist in custom_components/energyiq/quality_scale.yaml.

## Pull requests

Pull requests should contain one focused change, explain the reason for the change, identify the revision, and describe how it was validated.
