---
name: Preventive action ↔ machines (multi-machine)
description: A preventive maintenance action can target multiple machines via a junction table; primary machine_id is kept for back-compat.
---

A preventive maintenance action (`preventive_maintenance_actions`) can target
multiple machines. The full set lives in junction
`preventive_maintenance_action_machines (preventive_action_id, machine_id,
unique pair)`; the action row's `machine_id` is kept only as the PRIMARY
(= first selected) machine for backward compatibility and is included in the
junction too.

**Rule:** any machine-scoped query over preventive actions must go through the
junction, NOT the action's primary `machine_id`, or it will silently drop
actions where the machine is a secondary link.
- `getPreventiveMaintenanceActions(machineId)` filters by junction.
- `getLastActionPerComponent(machineId)` JOINs the junction.
- create/update write the full junction set in the same transaction.

**Why:** filtering on `actions.machine_id` only returns actions where the
machine happens to be first; multi-machine actions linked as non-primary would
be omitted from per-machine listings and the reference report.

**How to apply:** when adding any new per-machine view/report/export of
preventive actions, source machine membership from the junction.
