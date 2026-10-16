type DatedAttendanceEvent = {
  occurred_at: string;
  shift_date?: string | null;
};

export type AttendanceDayStatus = {
  day: string;
  status: "absent" | "leave";
};

const calendar = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Riyadh",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function attendanceCalendarDate(timestamp: string): string {
  const parts = calendar.formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function groupAttendanceEventsByDay<T extends DatedAttendanceEvent>(
  events: readonly T[],
  dayStatuses: readonly AttendanceDayStatus[] = [],
): { day: string; events: T[]; status?: AttendanceDayStatus["status"] }[] {
  const days = new Map<string, { events: T[]; status?: AttendanceDayStatus["status"] }>();
  for (const { day, status } of dayStatuses) {
    const row = days.get(day);
    if (row) row.status = status;
    else days.set(day, { events: [], status });
  }
  for (const event of events) {
    // Attached overnight sessions belong to their start day; older unattached
    // records retain their actual Riyadh calendar day.
    const day = event.shift_date ?? attendanceCalendarDate(event.occurred_at);
    const row = days.get(day);
    if (row) {
      row.events.push(event);
      delete row.status;
    } else days.set(day, { events: [event] });
  }
  return [...days].sort(([a], [b]) => b.localeCompare(a))
    .map(([day, row]) => ({ day, events: row.events, ...(row.events.length === 0 && row.status ? { status: row.status } : {}) }));
}
