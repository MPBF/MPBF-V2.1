export type AttendanceAction = "check_in" | "break_start" | "break_end" | "check_out";

export type AttendanceAuditEvent = {
  id: number;
  user_id: number;
  session_id: number | null;
  shift_date: string | null;
  action: AttendanceAction;
  occurred_at: string;
};

export type AttendanceAuditGroup<T extends AttendanceAuditEvent> = {
  key: string;
  user_id: number;
  shift_date: string;
  sessionOrder: number;
  employee: T;
  checkIns: T[];
  breakStarts: T[];
  breakEnds: T[];
  checkOuts: T[];
  events: T[];
};

const riyadhDate = (value: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export function groupAttendanceEvents<T extends AttendanceAuditEvent>(events: T[]): AttendanceAuditGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const localDate = riyadhDate(event.occurred_at);
    const identity = event.session_id == null ? `date:${localDate}` : `session:${event.session_id}`;
    const key = `${event.user_id}:${identity}`;
    const list = groups.get(key);
    if (list) list.push(event);
    else groups.set(key, [event]);
  }
  return Array.from(groups, ([key, entries]) => {
    const ordered = entries.slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id - b.id);
    const first = ordered[0];
    const accountingDate = first.shift_date || riyadhDate(first.occurred_at);
    const byAction = (action: AttendanceAction) => ordered.filter((entry) => entry.action === action);
    return {
      key,
      user_id: first.user_id,
      shift_date: accountingDate,
      sessionOrder: Date.parse(first.occurred_at),
      employee: first,
      checkIns: byAction("check_in"),
      breakStarts: byAction("break_start"),
      breakEnds: byAction("break_end"),
      checkOuts: byAction("check_out"),
      events: ordered,
    };
  }).sort((a, b) => b.shift_date.localeCompare(a.shift_date) || b.sessionOrder - a.sessionOrder || b.user_id - a.user_id || a.key.localeCompare(b.key));
}
