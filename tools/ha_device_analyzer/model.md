# Analyzer evidence and assessment model

The analyzer keeps these dimensions separate.

## 1. Raw evidence

### Device identity

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

### Entity identity

- entity_id
- domain
- platform/integration
- unique_id
- device_id
- area
- entity name
- entity category
- enabled state
- availability
- current state
- current attributes

### Measurement semantics

- device_class
- state_class
- unit
- last_reset
- precision
- suggested display precision

Electrical classes:

- power
- energy
- current
- voltage
- apparent power
- reactive power
- power factor
- reactive energy

### Behavioral evidence

When history is requested:

- state update interval
- state change interval
- identical-reading percentage
- min/max
- zero percentage
- unavailable/unknown percentage
- longest gap
- rounding/resolution
- historical availability

## 2. Whole-home discriminator

The discriminator does not assume that a whole-home entity is named total_power.

It evaluates:

- measurement semantics
- aggregate wording
- phase/channel wording
- device relationships
- calculated/derived source entities
- meter-family relationships
- consumption versus generation/export semantics

### Primary targets

- whole-home consumption power
- whole-home consumption energy

### Secondary targets

- grid import
- grid export
- solar/generation
- battery/storage

Generation/export information is preserved but does not replace the consumption reference.

## 3. Derived aggregate measurements

Home Assistant can expose calculated sensors that combine several source entities. The analyzer therefore preserves arbitrary current-state attributes and specifically recognizes source lists such as:

- entity_id
- source_entity_ids
- source_entities

A derived power entity backed by multiple phase/channel entities from the same meter family is strong evidence for an aggregate measurement.

## 4. Device training discriminator

Technical treatment is separate from user adoption.

- system_meter: whole-home measurement infrastructure
- auto_train: direct usable power measurement on a load device
- quick: controllable load with no direct power measurement
- manual: no direct measurement and no controllable entity
- review: ambiguous/system-like case

These are technical assessments, not user choices.

## 5. User decision

The eventual EnergyIQ commissioning workflow should retain:

- analyzer assessment
- supporting evidence
- user Keep/Exclude decision

The analyzer must never silently delete a device from the inventory because it lacks a power entity.

## 6. Integration boundary

The discriminator is currently pure Python with no Home Assistant or EnergyIQ imports.

That gives EnergyIQ a clean future integration point:

    HA discovery
        -> normalized evidence
        -> discriminator
        -> candidate/measurement/training assessment
        -> user Keep/Exclude
        -> EnergyIQ configuration

The discriminator must remain deterministic and explainable. Changes should be validated against real analyzer reports before being incorporated into EnergyIQ.
