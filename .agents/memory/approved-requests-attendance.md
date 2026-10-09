---
name: Approved leave/permission → attendance & wages
description: How approved إجازة/استئذان requests flow into the attendance engine and wage deductions.
---

Rule: approved leave is represented as attendance rows with status "إجازة" (created at request approval); the attendance engine derives leave days from those rows — a scheduled day with such a row and no real check-in becomes status "إجازة"/leaveDays, never absent (still counted in scheduledDays → paid leave). Approved استئذان minutes are NOT stored in attendance; they are queried from user_requests (type استئذان, status موافق, keyed by the request's `date`) and passed to the engine as per-day credits that offset late → early-leave → withdrawn minutes in that order.

**Why:** wage deductions are computed solely from engine totals, so both effects must happen inside the engine, not by patching wage math; and leave rows double as a manual override channel (any row with status إجازة works).

**How to apply:** anything that approves/creates leave must write the إجازة attendance rows (never clobber days with real check-ins); anything computing attendance for wages/reports must pass the permission-minutes map (see server/services/leave-attendance.ts helpers). Approval status string is "موافق" (not approved/مقبول).
