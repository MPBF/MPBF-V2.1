# Monthly attendance: absence and approved leave

## Approved behavior
- Keep one chronological row per day and preserve every original attendance action.
- Show a red “غائب” status only after an assigned shift's complete attendance
  window has ended without a recorded attendance event/session.
- Respect Riyadh dates, overnight shift accounting, assignment periods and
  the employee's employment start date. Do not classify future/open shifts.
- Show approved leave as “إجازة” over its inclusive explicit date range,
  not as absence. Actual attendance takes precedence.

## Leave dates
- New leave requests require valid start/end dates; other request types do not.
- Admins may complete dates on legacy leave requests independently of their
  approval status and original response.
- Approval requires a valid full date range. Rejection does not fabricate dates.
- A filtered admin queue makes undated approved requests accessible.
- An approved leave with an unknown period prevents reliable absence assessment:
  show an explicit notice, keep known leave/attendance, and do not guess absence.

## Safety and scope
- Derive status server-side under the signed-in employee's identity.
- Enforce admin permission and row locking for request corrections.
- Add nullable date columns with a consistency constraint using a narrow
  additive development migration; do not delete or rewrite existing requests.
- Do not create absence records, synthesize punches, or change wage calculations.
- No production migration, publication or real-record update is authorized here.

## Verification
Pure date/shift tests cover grace boundaries, overnight work, leap years,
assignment/employment periods, ambiguous leave and recorded-event precedence.
Route tests cover permissions, ownership, locked date-only updates and validation.
Intercepted browser fixtures cover Arabic/English, desktop/mobile, status-only
months, actual form payloads, old-request correction and approval.
