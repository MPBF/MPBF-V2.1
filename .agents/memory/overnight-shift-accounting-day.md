---
name: Overnight shift accounting day
description: Confirmed start-date rule for cross-midnight attendance; monetary pay calculation is out of scope for now.
---

All worked hours for a shift that crosses midnight belong to the local Riyadh date on which the shift starts. Preserve the real timestamp of each attendance event: a 19:00 check-in on January 1 and a 03:00 checkout on January 2 remain those exact dates, while the entire session is accounted for on January 1. The same rule applies across month boundaries. The owner confirmed that monetary wage calculation is not wanted at present; if payroll is introduced later, its date attribution should follow this start-date rule.

**Why:** The project owner explicitly chose start-date accounting over splitting hours at midnight. A configurable "next-day check-in" clock should not be used to rewrite event dates or determine payroll attribution.

**How to apply:** Associate attendance actions with one shift session and its start-date business key; group daily/monthly attendance by that key, fetch boundary-crossing events, and avoid double counting. Do not add monetary payroll calculations without a new request. A separate permissible check-in/checkout window may still be needed for operational access, but it is not the accounting date.