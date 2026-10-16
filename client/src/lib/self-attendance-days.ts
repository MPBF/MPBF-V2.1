type DatedAttendanceEvent = {
  occurred_at: string;
  shift_date?: string | null;
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
): { day: string; events: T[] }[] {
  const days = new Map<string, T[]>();
  for (const event of events) {
    // Attached overnight sessions belong to their start day; older unattached
    // records retain their actual Riyadh calendar day.
    const day = event.shift_date ?? attendanceCalendarDate(event.occurred_at);
    const records = days.get(day);
    if (records) records.push(event);
    else days.set(day, [event]);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, records]) => ({ day, events: records }));
}
