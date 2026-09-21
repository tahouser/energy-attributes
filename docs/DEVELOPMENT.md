# EnergyIQ Development

## Repository structure

The main areas are:

- custom_components/energyiq/: Home Assistant integration
- custom_components/energyiq/www/: panel and dashboard card
- custom_components/energyiq/brand/: branding
- custom_components/energyiq/translations/: config-flow translations
- docs/: architecture and development documentation
- .github/workflows/: CI validation
- .github/ISSUE_TEMPLATE/: structured bug and feature reports

## Change workflow

1. Start from the last known-good revision.
2. Identify one change.
3. Implement only that change.
4. Run repository validation.
5. Test the relevant behavior in Home Assistant.
6. Record the revision and validation result.
7. Only then proceed to the next change.

## Protected rollback

EnergyIQ 3.1.36 is the permanent rollback reference for the current development effort.

Do not rewrite or replace that historical rollback point.

## Home Assistant standards

The project is working toward the Home Assistant Integration Quality Scale. The living checklist is:

custom_components/energyiq/quality_scale.yaml

Items marked todo are planned work, not claims of current compliance.
