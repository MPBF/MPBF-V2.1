---
name: Attendance action ordering
description: Concurrency rule for employee check-in, break, return, and exit events
---

Keep each employee's attendance transitions serialized by a per-user database lock. Determine the current state from insertion order, and assign event time at insertion after acquiring that lock.

**Why:** PostgreSQL `now()` is fixed when a transaction starts. A request that waits for another request's lock can commit later yet appear to have occurred earlier if events are sorted by timestamp. That can admit invalid transitions and misreport the current state.

**How to apply:** Whenever adding attendance actions or reconstructing the latest state, preserve a single serialization order and avoid treating transaction-start time as event order. Monthly reporting can still use recorded event times for calendar boundaries.