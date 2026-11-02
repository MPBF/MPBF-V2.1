import type { AttendanceAuditEvent, AttendanceAuditGroup } from "./hr-audit-grouping";

export type AuditApprovedLeave = { user_id: number; start: string | null; end: string | null };
export type AuditCalendarEmployee = { id: number };
export type AuditCalendarRow<E, T extends AttendanceAuditEvent> = {
  key: string;
  shift_date: string;
  user_id: number;
  employee: E | T;
  approvedLeave: boolean;
  group: AttendanceAuditGroup<T> | null;
};

const validDay = (day: string | null): day is string => Boolean(day
  && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
  && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day);
export const isDatedAuditLeave = (leave: AuditApprovedLeave) =>
  validDay(leave.start) && validDay(leave.end) && leave.start <= leave.end;

/** Calendar rows remain read-only until an explicit correction is saved. */
export function buildAuditCalendar<E extends AuditCalendarEmployee, T extends AttendanceAuditEvent>(
  month: string, employees: E[], groups: AttendanceAuditGroup<T>[], leaves: AuditApprovedLeave[],
): AuditCalendarRow<E, T>[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const people = new Map<number, E | T>(employees.map((employee) => [employee.id, employee]));
  const byDay = new Map<string, AttendanceAuditGroup<T>[]>();
  for (const group of groups) {
    if (!group.shift_date.startsWith(`${month}-`)) continue;
    if (!people.has(group.user_id)) people.set(group.user_id, group.employee);
    const key = `${group.user_id}:${group.shift_date}`;
    const list = byDay.get(key) ?? [];
    list.push(group); byDay.set(key, list);
  }
  const leavesByUser = new Map<number, AuditApprovedLeave[]>();
  for (const leave of leaves.filter(isDatedAuditLeave)) {
    const list = leavesByUser.get(leave.user_id) ?? [];
    list.push(leave); leavesByUser.set(leave.user_id, list);
  }
  const rows: AuditCalendarRow<E, T>[] = [];
  for (let day = days; day >= 1; day--) {
    const shift_date = `${month}-${String(day).padStart(2, "0")}`;
    for (const [user_id, employee] of people) {
      const approvedLeave = (leavesByUser.get(user_id) ?? []).some((leave) => leave.start! <= shift_date && leave.end! >= shift_date);
      const matching = byDay.get(`${user_id}:${shift_date}`);
      if (matching?.length) {
        for (const group of matching) rows.push({ key: group.key, shift_date, user_id, employee: group.employee, approvedLeave, group });
      } else {
        rows.push({ key: `calendar:${user_id}:${shift_date}`, shift_date, user_id, employee, approvedLeave, group: null });
      }
    }
  }
  return rows;
}

/** Empty correction targets carry identity/date, never invented attendance events. */
export function calendarCorrectionGroup<E, T extends AttendanceAuditEvent>(
  row: AuditCalendarRow<E, T>,
): AttendanceAuditGroup<T, E | T> {
  return row.group ?? {
    key: row.key, user_id: row.user_id, shift_date: row.shift_date,
    sessionOrder: 0, employee: row.employee,
    checkIns: [], breakStarts: [], breakEnds: [], checkOuts: [], events: [],
  };
}
