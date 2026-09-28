# HA Device Intelligence Analyzer

Standalone, read-only tooling for inspecting a Home Assistant installation's devices and entities.

## Purpose

Determine what Home Assistant actually exposes for each device before EnergyIQ adopts any discovery or auto-training rules.

This tool is intentionally separate from the EnergyIQ runtime. It must not modify devices, entities, registries, helpers, or EnergyIQ persistent data.

## First objective

Build an evidence-based inventory of:

- devices and device relationships
- all associated entities
- entity domain and metadata
- electrical measurement candidates
- measurement behavior and data quality
- category/subcategory candidates
- reasons a device may or may not be suitable for EnergyIQ direct-measurement commissioning

The analyzer must report evidence before making eligibility decisions.

## Core output model

Each device will eventually produce:

1. Identity
2. Category
3. Entity inventory
4. Measurement candidates
5. Observed behavior
6. Data-quality findings
7. Ambiguities
8. EnergyIQ-oriented assessment

## Initial categories

See categories.yaml.

Categories are descriptive only. Measurement capability is tracked separately so a lighting device, HVAC device, or appliance can all have the same electrical measurement classifications.

## Design rule

Do not assume that an entity named "power" is trustworthy power.

Home Assistant metadata such as device class, state class, unit, availability, and device/entity relationships are evidence. Runtime history is additional evidence. The analyzer should preserve both.

## Planned phases

### Phase 1 — Static inventory
Read-only collection of device registry, entity registry, and current states.

### Phase 2 — Electrical classification
Identify power, energy, current, voltage, apparent power, reactive power, and related candidates using HA metadata first.

### Phase 3 — Behavioral analysis
Inspect historical/current state behavior: update intervals, gaps, unavailable/unknown periods, range, resolution, resets, flatlines, and other anomalies.

### Phase 4 — Device/category classification
Classify devices using manufacturer/model/domain/entity evidence. Do not make category classification depend solely on entity names.

### Phase 5 — Evidence report
Produce a human-readable report and machine-readable dataset.

### Phase 6 — EnergyIQ rules
Only after the analyzer has been exercised against real installations should we define "Eligible Auto-Train" rules.

## Non-goals

- No EnergyIQ attribution calculations.
- No whole-home consumption accounting.
- No automatic device adoption.
- No changes to Home Assistant configuration.
- No changes to EnergyIQ training.
