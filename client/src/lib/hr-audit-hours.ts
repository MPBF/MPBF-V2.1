import type { AttendanceAuditGroup, AttendanceAuditEvent } from "./hr-audit-grouping";

type HoursEvent = AttendanceAuditEvent & { expected_minutes?: number | null };
export type AuditWorkMinutes = { workedMinutes: number | null; overtimeMinutes: number | null };

/** Display verified intervals only; scheduled duration is the saved session snapshot. */
export function auditWorkMinutes<T extends HoursEvent>(
  group: AttendanceAuditGroup<T>, incomplete: boolean,
): AuditWorkMinutes {
  const unknown: AuditWorkMinutes = { workedMinutes: null, overtimeMinutes: null };
  if (incomplete || group.checkIns.length !== 1 || group.checkOuts.length !== 1 ||
    group.breakStarts.length !== group.breakEnds.length || group.breakStarts.length > 1) return unknown;
  const start = Date.parse(group.checkIns[0].occurred_at);
  const end = Date.parse(group.checkOuts[0].occurred_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return unknown;
  let workedMinutes = Math.round((end - start) / 60_000);
  if (group.breakStarts.length) {
    const breakStart = Date.parse(group.breakStarts[0].occurred_at);
    const breakEnd = Date.parse(group.breakEnds[0].occurred_at);
    if (!Number.isFinite(breakStart) || !Number.isFinite(breakEnd) ||
      breakStart <= start || breakEnd <= breakStart || breakEnd >= end) return unknown;
    // Match the monthly report: round each verified working interval, not the break.
    workedMinutes = Math.round((breakStart - start) / 60_000) + Math.round((end - breakEnd) / 60_000);
  }
  const expected = group.employee.expected_minutes;
  return {
    workedMinutes,
    overtimeMinutes: typeof expected === "number" && Number.isFinite(expected) && expected > 0
      ? Math.max(0, workedMinutes - expected) : null,
  };
}
