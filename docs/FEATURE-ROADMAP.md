# EnergyIQ Feature Roadmap

This file is the working feature list for EnergyIQ UI and architecture work. Completed items are marked verified only after user testing.

## Current Feature List

| # | Feature | Status |
|---|---|---|
| 1 | Entity List — Mobile Usability — expand/collapse upper sections | **DONE — verified 3.1.139** |
| 2 | Active Consumers — counter/list consistency | **DONE — verified 3.1.140** |
| 3 | Retraining — same workflow as initial training; bulk includes already-trained devices | **DONE — verified 3.1.138** |
| 4 | HA Device/Entity Metadata Refresh — refresh current HA metadata while preserving EnergyIQ state | **DONE — 3.1.134/3.1.135** |
| 5 | Excluded List — remove selected or empty excluded inventory | **DONE — verified 3.1.141** |
| 6 | Cost Page Redesign — Peak/Off-Peak accumulation bars, selector, current-position marker, total cost | **OPEN** |
| 7 | Consumption Page Visual Redesign — large current watts + today's kWh with subtle live visual | **OPEN** |
| 8 | Mystery Watts — no change required | **DONE — no change required** |
| 9 | Overall Card Design — professional, restrained layout and visual treatment | **OPEN** |
| 10 | Future Reporting — monthly device consumption email/reporting | **OPEN / FUTURE** |
| 11 | EnergyIQ Architecture & HA Standards Review | **OPEN / ONGOING** |
| 12 | Entity List — Clickable Column Sorting — sort every data column ascending/descending | **IN PROGRESS — 3.1.142** |

## Revision History

- **3.1.138** — Bulk retraining cleanup; user verified working.
- **3.1.139** — Mobile Entity List usability; user verified working.
- **3.1.140** — Active Consumers counter/list consistency; user verified working.
- **3.1.141** — Excluded List inventory removal; user verified working.
- **3.1.142** — Clickable sorting for all entity-list data columns.

## Revision Discipline

- **3.1.36** (commit cef34f051a540700c96f0427d9fcd953290ba66c) remains the permanent pristine rollback point.
- Revisions are sequential.
- One focused change is tested before the next feature is implemented.
- Training algorithms, electrical measurement logic, and accounting remain protected from UI-only revisions unless a feature explicitly requires backend work.
- A feature is not marked verified until the user explicitly confirms the test result.
