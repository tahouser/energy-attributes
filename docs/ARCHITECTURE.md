# EnergyIQ Architecture

This document defines the architectural direction for EnergyIQ. It is intentionally separate from the user-facing README.

## Core principles

### Home Assistant is the source of truth for HA metadata

EnergyIQ should not maintain a competing copy of Home Assistant device metadata.

HA-owned information includes:
- current device name
- current area
- manufacturer
- model
- current entity IDs
- entity registry state

EnergyIQ-owned information includes:
- Included / Excluded classification
- monitoring classification
- training state
- learned signatures
- training history
- other EnergyIQ-specific accounting state

Stable HA device identity should be preferred over entity ID when both are available.

## Runtime architecture

The target runtime model is:

ConfigEntry -> ConfigEntry.runtime_data -> EnergyIQ coordinator

Runtime-only objects should not be persisted in ConfigEntry data or options.

The migration from hass.data to entry.runtime_data is planned as a focused revision and must not alter training behavior.

## Persistence

Configuration belongs in ConfigEntry.data.

User-adjustable settings belong in ConfigEntry.options.

Long-lived application state that does not belong in configuration should use an appropriate Home Assistant storage mechanism.

Candidate inventory reconciliation must preserve EnergyIQ-owned state when Home Assistant metadata changes.

## Training

The training engine is a protected subsystem.

Architectural and UI changes must not change:
- sampling behavior
- timing
- baseline logic
- ON/OFF detection
- accepted-reading rules
- learned-signature calculation

Retraining should use the normal training workflow. A special retraining algorithm is not required.

## Frontend

The EnergyIQ panel and dashboard card are clients of the integration API.

Frontend changes should not become an alternate source of truth for training or accounting.

The card should consume existing backend calculations rather than recreate them.

## WebSocket API

WebSocket handlers should remain thin:

frontend request -> validation -> coordinator/service operation -> response

Shared coordinator access should use the ConfigEntry runtime architecture.

## Revision discipline

One architectural or functional change per revision.

Each revision must be:
1. Implemented from the last known-good revision.
2. Validated independently.
3. Tested in Home Assistant where behavior is runtime-dependent.
4. Released only after validation.

Known rollback point: EnergyIQ 3.1.36.

## Planned architecture sequence

1. Runtime data migration
2. Entity architecture
3. HA device/entity identity and metadata reconciliation
4. Candidate inventory persistence/reconciliation
5. WebSocket/API cleanup
6. Automated test infrastructure
7. Frontend/card architecture cleanup
8. Feature/UI work
