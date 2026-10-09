---
name: Machine type value inconsistency
description: The machines.type column contains inconsistent representations; type-based logic must tolerate all of them.
---

# Machine type value inconsistency

The `machines.type` column in the DB contains a mix of representations that do
NOT all match the form's Select option values or the schema check constraint.

Observed live values: `extruder`, `printing`, `cutting`, `Printer`, `Cutter`.
- The machine form Select offers: `extruder`, `cutting`, `printing`, `packaging`.
- The schema check constraint lists: `extruder`, `printer`, `cutter`, `quality_check`.
None of these three sets fully agree.

**Why:** Historical data was created under different conventions; the check
constraint is not effectively enforced for these rows.

**How to apply:** Any code that branches on machine type (conditional form
fields, capability matching, queue grouping) must normalize — lowercase and
accept both the gerund and agent-noun forms, e.g. treat
`['printing','printer']` and `['cutting','cutter']` as equivalent, and
`extruder` as film. Do not assume `machineForm.type === 'printing'` alone will
match an edited existing machine.
