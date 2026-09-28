# Analyzer evidence model

The analyzer should keep these dimensions separate.

## Device identity

- device_id
- name
- user name
- manufacturer
- model
- model_id
- area
- config entries
- parent device
- via device

Home Assistant's device registry groups entities into devices and can represent child-device and hub relationships. Do not infer physical ownership from entity names alone.

## Entity identity

- entity_id
- domain
- platform/integration
- unique_id where available
- device_id
- area
- entity name
- entity category
- enabled state
- availability
- current state

## Measurement semantics

Record, where supplied by Home Assistant:

- device_class
- state_class
- unit
- last_reset
- precision
- suggested display precision where available

Electrical classes of particular interest:

- power
- energy
- current
- voltage
- apparent power
- reactive power
- power factor
- reactive energy

## Behavioral evidence

Later phases should measure rather than assume:

- state update interval
- state change interval
- identical-reading percentage
- min/max observed
- zero percentage
- unavailable percentage
- unknown percentage
- longest data gap
- rounding/resolution
- sudden discontinuities
- cumulative-meter resets
- historical availability

## Assessment

Assessment is intentionally downstream from evidence.

Possible future labels:

- direct_measurement_candidate
- direct_measurement_candidate_review
- energy_only_candidate
- ambiguous_measurement
- no_usable_measurement

These labels are provisional until tested against real Home Assistant installations.

## Important distinction

"Valid Home Assistant sensor" and "suitable EnergyIQ measurement" are not equivalent.

The analyzer must preserve the evidence that leads to any later EnergyIQ assessment.
