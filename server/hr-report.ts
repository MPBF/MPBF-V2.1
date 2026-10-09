export type ReportEvent = {
  id: number;
  userId: number;
  assignmentId: number | null;
  sessionId?: number | null;
  action: string;
  occurredAt: Date;
};

export type ReportSession = {
  id: number;
  userId: number;
  shiftDate: string;
  shiftStartAt: Date;
  shiftEndAt: Date;
  expectedMinutes: number;
  checkInAt: Date;
  checkOutAt: Date | null;
};

export type ReportAssignment = {
  id: number;
  userId: number;
  assignedAt: Date;
  unassignedAt: Date | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  lateCheckoutMinutes?: number;
};

export type AttendanceTotals = {
  workedMinutes: number;
  daysWorked: number;
  absentDays: number;
  overtimeMinutes: number;
  incompleteDays: number;
};

const RIYADH_OFFSET = 3 * 60 * 60 * 1000;

export function riyadhDayKey(value: Date) {
  return new Date(value.getTime() + RIYADH_OFFSET).toISOString().slice(0, 10);
}

export function monthRange(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw Object.assign(new Error("صيغة الشهر غير صالحة"), { status: 400 });
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1) - RIYADH_OFFSET);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) - RIYADH_OFFSET);
  return { start, end };
}

export function dayRange(day: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(day);
  if (!match) throw Object.assign(new Error("صيغة اليوم غير صالحة"), { status: 400 });
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - RIYADH_OFFSET);
  if (riyadhDayKey(start) !== day) throw Object.assign(new Error("اليوم المحدد غير صالح"), { status: 400 });
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function shiftMinutes(assignment: ReportAssignment) {
  const [startHour, startMinute] = assignment.startTime.split(":").map(Number);
  const [endHour, endMinute] = assignment.endTime.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (minutes <= 0) minutes += 1440;
  return Math.max(0, minutes - assignment.breakMinutes);
}

function workingDay(day: string) {
  const weekday = new Date(`${day}T12:00:00+03:00`).getUTCDay();
  return weekday !== 5 && weekday !== 6;
}

function dateKeys(start: Date, end: Date, cutoff: Date) {
  const keys: string[] = [];
  for (let cursor = new Date(start); cursor < end && cursor < cutoff; cursor = new Date(cursor.getTime() + 86_400_000)) {
    keys.push(riyadhDayKey(cursor));
  }
  return keys;
}

export function summarizeAttendance(
  userId: number,
  events: ReportEvent[],
  assignments: ReportAssignment[],
  range: { start: Date; end: Date },
  now = new Date(),
  sessions: ReportSession[] = [],
): AttendanceTotals {
  const userEvents = events.filter((event) => event.userId === userId && event.sessionId == null)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id);
  const userAssignments = assignments.filter((assignment) => assignment.userId === userId);
  const inMonth = (day: string) => {
    const { start, end } = range;
    return day >= riyadhDayKey(start) && day < riyadhDayKey(end);
  };
  const perDay = new Map<string, { worked: number; expected: number }>();
  const presentDays = new Set<string>();
  const workedDays = new Set<string>();

  const userSessions = sessions.filter((session) => session.userId === userId && inMonth(session.shiftDate));
  const sessionIds = new Set(userSessions.map((session) => session.id));
  const sessionEvents = events.filter((event) =>
    event.userId === userId && event.sessionId != null && sessionIds.has(event.sessionId),
  );

  for (const session of userSessions) {
    presentDays.add(session.shiftDate);
    const row = perDay.get(session.shiftDate) ?? { worked: 0, expected: 0 };
    row.expected += Math.max(0, session.expectedMinutes);
    perDay.set(session.shiftDate, row);
    if (!session.checkOutAt) continue;

    const matchingEvents = sessionEvents.filter((event) => event.sessionId === session.id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id);
    let workingSince: Date | null = null;
    let sessionWorked = 0;
    const closeSessionInterval = (at: Date) => {
      if (!workingSince) return;
      const start = Math.max(workingSince.getTime(), session.checkInAt.getTime());
      const end = Math.min(at.getTime(), session.checkOutAt!.getTime());
      if (end > start) sessionWorked += Math.round((end - start) / 60_000);
      workingSince = null;
    };
    for (const event of matchingEvents) {
      if (event.occurredAt < session.checkInAt || event.occurredAt > session.checkOutAt) continue;
      if (event.action === "check_in") {
        closeSessionInterval(event.occurredAt);
        workingSince = event.occurredAt;
      } else if (event.action === "break_start" || event.action === "check_out") {
        closeSessionInterval(event.occurredAt);
      } else if (event.action === "break_end" && !workingSince) {
        workingSince = event.occurredAt;
      }
      if (event.action === "check_out") break;
    }
    // The persisted checkout timestamp is authoritative even if its event is absent.
    if (workingSince) closeSessionInterval(session.checkOutAt);
    if (sessionWorked > 0) {
      row.worked += sessionWorked;
      workedDays.add(session.shiftDate);
    }
  }

  const incompleteDaysSet = new Set(userSessions.filter((session) => !session.checkOutAt).map((session) => session.shiftDate));

  let workingSince: Date | null = null;
  let activeDay = "";
  let activeAssignment: ReportAssignment | undefined;
  let legacyWorked = 0;
  const legacyIncomplete = new Set<string>();

  const closeInterval = (at: Date) => {
    if (!workingSince || !activeDay) return;
    const safeEnd = Math.min(at.getTime(), workingSince.getTime() + 24 * 60 * 60 * 1000, now.getTime());
    legacyWorked += Math.round(Math.max(0, safeEnd - workingSince.getTime()) / 60000);
    workingSince = null;
  };

  for (const event of userEvents) {
    if (event.action === "check_in") {
      if (activeDay && inMonth(activeDay)) legacyIncomplete.add(activeDay);
      activeDay = riyadhDayKey(event.occurredAt);
      activeAssignment = userAssignments.find((assignment) => assignment.id === event.assignmentId)
        ?? userAssignments.find((assignment) => assignment.assignedAt <= event.occurredAt && (!assignment.unassignedAt || assignment.unassignedAt > event.occurredAt));
      legacyWorked = 0;
      if (inMonth(activeDay)) presentDays.add(activeDay);
      workingSince = event.occurredAt;
    } else if (event.action === "break_start" || event.action === "check_out") {
      closeInterval(event.occurredAt);
      if (event.action === "check_out" && activeDay) {
        if (inMonth(activeDay) && legacyWorked > 0) {
          const row = perDay.get(activeDay) ?? { worked: 0, expected: activeAssignment ? shiftMinutes(activeAssignment) : 0 };
          row.worked += legacyWorked;
          perDay.set(activeDay, row);
          workedDays.add(activeDay);
        }
        activeDay = "";
        legacyWorked = 0;
      }
    } else if (event.action === "break_end" && activeDay) {
      workingSince = event.occurredAt;
    }
  }
  if (activeDay && inMonth(activeDay)) legacyIncomplete.add(activeDay);
  const cutoff = now < range.end ? now : range.end;
  let absentDays = 0;
  for (const day of dateKeys(range.start, range.end, cutoff)) {
    if (!workingDay(day) || presentDays.has(day)) continue;
    const localMidnight = new Date(`${day}T00:00:00+03:00`).getTime();
    if (userAssignments.some((assignment) => {
      const [startHour, startMinute] = assignment.startTime.split(":").map(Number);
      const [endHour, endMinute] = assignment.endTime.split(":").map(Number);
      if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return false;
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      const shiftStart = localMidnight + startMinutes * 60_000;
      const shiftEnd = localMidnight + (endMinutes + (endMinutes <= startMinutes ? 1440 : 0)) * 60_000;
      return assignment.assignedAt.getTime() <= shiftStart
        && (!assignment.unassignedAt || assignment.unassignedAt.getTime() > shiftStart)
        && now.getTime() > shiftEnd + (assignment.lateCheckoutMinutes ?? 0) * 60_000;
    })) absentDays += 1;
  }

  let workedMinutes = 0;
  let overtimeMinutes = 0;
  for (const row of perDay.values()) {
    workedMinutes += row.worked;
    if (row.expected > 0) overtimeMinutes += Math.max(0, row.worked - row.expected);
  }
  return { workedMinutes, daysWorked: workedDays.size, absentDays, overtimeMinutes, incompleteDays: new Set([...incompleteDaysSet, ...legacyIncomplete]).size };
}
