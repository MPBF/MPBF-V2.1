export type AttendanceAction = "check_in" | "break_start" | "break_end" | "check_out";

export function attendanceStatus(lastAction?: string) {
  if (lastAction === "check_in" || lastAction === "break_end") return "working";
  if (lastAction === "break_start") return "break";
  return "out";
}

export function canRecordAttendance(action: AttendanceAction, lastAction?: string) {
  const status = attendanceStatus(lastAction);
  return (action === "check_in" && status === "out")
    || (action === "break_start" && status === "working")
    || (action === "break_end" && status === "break")
    || (action === "check_out" && status === "working");
}

export function attendanceSessionSummary(
  events: { action: string; occurred_at: Date }[],
  now = new Date(),
) {
  const ordered = [...events].sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());
  let sessionStartIndex = -1;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index].action === "check_in") {
      sessionStartIndex = index;
      break;
    }
  }
  if (sessionStartIndex < 0) return { startedAt: null, workedSeconds: 0, actionTimes: {} as Record<string, Date> };
  const session = ordered.slice(sessionStartIndex);
  let workingSince: number | null = null;
  let workedMilliseconds = 0;
  const actionTimes: Record<string, Date> = {};
  for (const event of session) {
    actionTimes[event.action] = event.occurred_at;
    if (event.action === "check_in" || event.action === "break_end") workingSince = event.occurred_at.getTime();
    if ((event.action === "break_start" || event.action === "check_out") && workingSince !== null) {
      workedMilliseconds += Math.max(0, event.occurred_at.getTime() - workingSince);
      workingSince = null;
    }
  }
  if (workingSince !== null) workedMilliseconds += Math.max(0, now.getTime() - workingSince);
  return {
    startedAt: session[0].occurred_at,
    workedSeconds: Math.floor(workedMilliseconds / 1000),
    actionTimes,
  };
}

export function sessionEventState(events: { action: string; occurred_at: Date }[], checkOutAt?: Date | null) {
  if (checkOutAt) return "out";
  const latest = [...events].sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime()).at(-1);
  return attendanceStatus(latest?.action);
}

export function completedSessionDaysInMonth(
  sessions: { shift_date: string; check_out_at: Date | null }[],
  month: string,
) {
  return new Set(
    sessions
      .filter((session) => session.check_out_at !== null && session.shift_date.startsWith(`${month}-`))
      .map((session) => session.shift_date),
  ).size;
}

export function isPriorIncompleteSession(
  session: { check_out_at: Date | null; window_end_at: Date },
  now = new Date(),
) {
  return session.check_out_at === null && session.window_end_at.getTime() < now.getTime();
}

function riyadhDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function presentDaysInMonth(
  events: { action: string; occurred_at: Date }[],
  previousAction: string | undefined,
  start: Date,
  end: Date,
  now = new Date(),
) {
  const days = new Set<string>();
  const endTime = Math.min(end.getTime(), now.getTime());
  let working = attendanceStatus(previousAction) === "working";
  let cursor = start.getTime();
  const addWorkingDays = (until: number) => {
    for (let day = start.getTime(); day < endTime; day += 24 * 60 * 60 * 1000) {
      const dayEnd = Math.min(day + 24 * 60 * 60 * 1000, endTime);
      if (cursor < dayEnd && until > day) days.add(riyadhDay(new Date(day)));
    }
  };
  for (const event of events) {
    const time = event.occurred_at.getTime();
    if (working) addWorkingDays(time);
    working = attendanceStatus(event.action) === "working";
    cursor = time;
  }
  if (working) addWorkingDays(endTime);
  return days.size;
}
