---
name: Maintenance schedule run idempotency
description: Rules for safely creating and completing periodic-maintenance checklist runs manually and automatically.
---

Periodic schedules must use a unique run record keyed by the **actual run date**. Starting a run creates a historical checklist snapshot, not a preventive-maintenance action. The due date advances by the configured month interval only when a due run is completed; an early manual run records today and leaves the upcoming due date unchanged.

**Why:** Treating every manual click as a forced run of the due date lets concurrent clicks consume future cycles or create duplicate work. Advancing at start also loses overdue visibility when a technician abandons an unfinished checklist.

**How to apply:** Lock the schedule before choosing the run date, return the existing run for that date, snapshot catalog labels into run items, and advance the schedule only during successful checklist completion.