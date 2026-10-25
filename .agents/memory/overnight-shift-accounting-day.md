---
name: Overnight shift accounting day
description: Confirmed start-date rule for cross-midnight attendance; monetary pay calculation is out of scope for now.
---

The user's monthly attendance history must show one row per day, with every
operation's time in that row, including repeated breaks. Preserve actual event
timestamps when presenting an overnight session under its start day.

**Why:** the user requested daily rows instead of a separate row for each event.
**How to apply:** keep all recorded operations visible; grouping the display
must not change attendance calculations or infer missing checkout events.

The HR audit tab has a distinct approved grouping: one row per employee per
shift session, not one row per employee-day when multiple shifts exist.
Show the current month by default in descending accounting-date order, retain
every repeated break, and keep each underlying event editable/deletable.

**Why:** the user explicitly approved the per-employee/per-shift organization
for the HR audit table.
**How to apply:** preserve separate shift sessions in this management audit
view; do not treat the employee dashboard's daily grouping as a universal rule.

The user also requested a full-width biometric panel: remove its adjacent
attendance-days card, but retain the top monthly summary. Hide the generic
location-permission paragraph, shift-accounting-date paragraph, and prior
incomplete-shift notice from this panel.

**Why:** the user requested removing those display elements to provide more
space for the biometric controls.
**How to apply:** this is presentation only. Preserve required geolocation,
shift-window restrictions, actionable validation errors, and incomplete-session
accounting; do not change stored attendance or its calculations.

All worked hours for a shift that crosses midnight belong to the local Riyadh date on which the shift starts. Preserve the real timestamp of each attendance event: a 19:00 check-in on January 1 and a 03:00 checkout on January 2 remain those exact dates, while the entire session is accounted for on January 1. The same rule applies across month boundaries. The owner confirmed that monetary wage calculation is not wanted at present; if payroll is introduced later, its date attribution should follow this start-date rule.

**Why:** The project owner explicitly chose start-date accounting over splitting hours at midnight. A configurable "next-day check-in" clock should not be used to rewrite event dates or determine payroll attribution.

**How to apply:** Associate attendance actions with one shift session and its start-date business key; group daily/monthly attendance by that key, fetch boundary-crossing events, and avoid double counting. Do not add monetary payroll calculations without a new request. A separate permissible check-in/checkout window may still be needed for operational access, but it is not the accounting date.