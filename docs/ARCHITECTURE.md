# EnergyIQ Architecture

This document records conceptual component boundaries and safety principles for the existing EnergyIQ implementation. It is not an active refactoring plan or a commitment to future work. The current release is v3.1.468; see [HANDOFF.md](HANDOFF.md) for successor guidance and [STATE.md](../STATE.md) for verified project status.

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

The distinction between configuration, options, runtime objects, and durable application state is useful when reviewing changes. Do not undertake an architectural migration merely because it appears in historical design notes; any migration needs a concrete defect or requirement and explicit data-safety validation.

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

## Historical architecture ideas — not a roadmap

The items below appeared in earlier architecture planning. They are not current commitments, priorities, or instructions to begin work. Given the project's handoff status, do not start these tasks without a willing maintainer identifying a concrete need and independently accepting responsibility for the work:

- Runtime data migration
- Entity architecture and metadata reconciliation
- Candidate inventory persistence/reconciliation
- WebSocket/API cleanup
- Expanded automated test infrastructure
- Frontend/card architecture cleanup
- Feature or UI work
