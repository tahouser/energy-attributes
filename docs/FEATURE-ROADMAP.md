# EnergyIQ Feature Roadmap

## Handoff status

As of the v3.1.467 handoff release, EnergyIQ is being offered as a completed creative project for community use and possible transfer to a willing maintainer. The original project owner is not committing to ongoing maintenance or a future feature schedule.

The list below is retained as **historical planning context**, not as a promise that these items remain open or will be implemented. The current behavior and constraints are defined by [`ENERGYIQ_DESIGN.md`](../ENERGYIQ_DESIGN.md), [`STATE.md`](../STATE.md), and [`CHANGE_PROCEDURE.md`](../CHANGE_PROCEDURE.md).

## Historical feature list

| # | Feature | Historical status |
|---|---|---|
| 1 | Entity List — Mobile Usability — expand/collapse upper sections | Marked done — verified 3.1.139 |
| 2 | Active Consumers — counter/list consistency | Marked done — verified 3.1.140 |
| 3 | Retraining — same workflow as initial training; bulk includes already-trained devices | Marked done — verified 3.1.138 |
| 4 | HA Device/Entity Metadata Refresh — refresh current HA metadata while preserving EnergyIQ state | Marked done — 3.1.134/3.1.135 |
| 5 | Excluded List — remove selected or empty excluded inventory | Marked done — verified 3.1.141 |
| 6 | Cost Page Redesign — Peak/Off-Peak accumulation bars, selector, current-position marker, total cost | Listed open in the older roadmap; not a current commitment |
| 7 | Consumption Page Visual Redesign — large current watts + today's kWh with subtle live visual | Listed open in the older roadmap; not a current commitment |
| 8 | Mystery Watts — no change required | Marked done — no change required |
| 9 | Overall Card Design — professional, restrained layout and visual treatment | Listed open in the older roadmap; not a current commitment |
| 10 | Future Reporting — monthly device consumption email/reporting | Listed as future; not a current commitment |
| 11 | EnergyIQ Architecture & HA Standards Review | Listed open/ongoing in the older roadmap; future work is for a successor to assess |
| 12 | Entity List — Clickable Column Sorting — sort every data column ascending/descending | Listed in progress at 3.1.142; current behavior should be checked against the released implementation |

## Historical revision discipline

- **3.1.36** (commit `cef34f051a540700c96f0427d9fcd953290ba66c`) is documented as the pristine rollback point.
- Historical revisions were intended to be sequential and narrowly scoped.
- Training algorithms, electrical measurement logic, and accounting are protected areas; changes should preserve persisted state unless explicitly designed and tested otherwise.
- A feature was to be marked verified only after explicit user confirmation.
