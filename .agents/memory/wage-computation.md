---
name: Incomplete attendance and pay
description: Historical pay policy for unverified shifts; not a claim that payroll code currently exists.
---

**Rule:** An attendance session with no verified checkout is non-payable until an authorized correction closes it. Do not turn its partial duration into wage hours or silently award scheduled pay. A later checkout correction should recompute it under the start-day attribution rule.

**Why:** Without checkout, work duration cannot be verified; treating a scheduled day as fully paid would overpay. The older payroll implementation that motivated this policy is not present in the current codebase, so this note is a policy, not an assertion about a live wage engine.

**How to apply:** If payroll is introduced or reconnected, consume completed session totals and explicitly deduct or withhold incomplete shifts. Confirm the payroll policy and rate data before implementing money calculations.
