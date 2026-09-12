# EnergyIQ Instrument Prototype — v3.1.60

## Purpose
A deliberately simple Home Assistant custom integration for high-fidelity whole-home electrical measurement and human-visible instrument display.

This is the measurement/instrument side project for EnergyIQ. It remains in the same repository and on `main` so it can be loaded and tested through the same HACS workflow.

## Revision range
- v3.1.36 — permanent pristine EnergyIQ baseline; never modify or supersede.
- v3.1.37–v3.1.56 — existing EnergyIQ development history.
- v3.1.57–v3.1.59 — reserved/existing development history before this prototype.
- **v3.1.60 — Instrument Prototype starting point.**
- Subsequent prototype revisions continue sequentially on `main`.

## Non-negotiable design requirements
1. Remain inside Home Assistant.
2. Measurement integrity is the highest priority.
3. The visible display must update fast enough to feel like a real electrical instrument/multimeter.
4. Acquisition rate and display rate are separate concerns.
5. The high-fidelity measurement path must not be constrained by HA Recorder or ordinary slow entity polling.
6. Keep the first instrument UI deliberately simple: one primary total-load value with only useful supporting statistics.

## Initial scope
- Whole-home total active power.
- Direct/high-fidelity acquisition path where the selected source supports it.
- Timestamped samples.
- High-rate live display.
- Basic diagnostic statistics that characterize the incoming measurement stream.
- No load attribution or training in the first instrument prototype.

## Relationship to EnergyIQ
The prototype is intended to establish and characterize the measurement/acquisition foundation that EnergyIQ can later consume. It is not a replacement for EnergyIQ and does not alter the v3.1.36 baseline.
