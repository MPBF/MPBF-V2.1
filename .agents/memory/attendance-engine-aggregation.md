---
name: attendance engine multi-row aggregation
description: Why the HR attendance engine must coalesce multiple same-day rows instead of summing per-row.
---

# Attendance engine: one effective record per shift-day

The employee dashboard self check-in flow (`createAttendance` = plain INSERT) writes a
SEPARATE attendance row per action (حاضر / في الاستراحة / يعمل / مغادر), so a single
shift-day commonly has MULTIPLE rows, each carrying only one timestamp.

**Rule:** `computeEmployeeAttendance` (server/services/attendance-engine.ts) must, per
shift-day, coalesce timestamps across all rows whose ANY stamp falls in the shift window
(earliest check-in, latest check-out, min lunch/break start, max lunch/break end), then
compute break minutes ONCE from the coalesced pair. `total_withdrawn_minutes` is a
cumulative daily total → take MAX across rows, never SUM.

**Why:** Summing breakMinutes/withdrawn per-row double-counts deductions (e.g. 15-min
withdrawal repeated on 4 rows became 60), under-reporting worked hours/overtime. Also,
membership cannot be gated on check_in/check_out only — break-only rows have neither, so
window membership must consider lunch/break stamps too.

**How to apply:** Any future change to attendance capture (new status rows, mobile sync)
keeps this invariant: aggregate to one effective record before metrics; cumulative
fields = MAX, interval fields = min-start/max-end computed once.
