import { currentShiftOccurrence, parseTimeMinutes, type ShiftDefinition } from "./shift-geofence";
import { isCalendarDate } from "./self-service-inputs";

type Assignment = {
  assignedAt: Date;
  unassignedAt: Date | null;
  shift: ShiftDefinition;
};
type ApprovedLeave = { start: string | null; end: string | null };
export type AttendanceDayStatus = { day: string; status: "absent" | "leave" };

export function riyadhCalendarDay(timestamp: Date): string {
  return new Date(timestamp.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
}

/** A read-only presentation: never creates attendance, absence or payroll rows. */
export function monthlyAttendanceStatuses(input: {
  month: string;
  now: Date;
  assignments: readonly Assignment[];
  recordedDays: readonly string[];
  approvedLeaves: readonly ApprovedLeave[];
  serviceStartDate: string | null;
  included: boolean;
}): { dayStatuses: AttendanceDayStatus[]; absenceAssessmentBlocked: boolean } {
  const dayStatuses: AttendanceDayStatus[] = [];
  if (!input.included) return { dayStatuses, absenceAssessmentBlocked: false };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new RangeError("Invalid attendance month");
  const validLeaves = input.approvedLeaves.filter((leave) =>
    leave.start && leave.end && isCalendarDate(leave.start) && isCalendarDate(leave.end) && leave.start <= leave.end,
  );
  // An undated approved leave could cover any day. Do not guess its period or
  // silently substitute creation/approval timestamps; ask the admin to complete it.
  let absenceAssessmentBlocked = validLeaves.length !== input.approvedLeaves.length;
  const assignments = input.assignments.filter(({ shift }) => {
    const valid = parseTimeMinutes(shift.startTime) !== null
      && parseTimeMinutes(shift.endTime) !== null && shift.startTime !== shift.endTime
      && Number.isFinite(shift.earlyCheckinMinutes) && shift.earlyCheckinMinutes >= 0
      && Number.isFinite(shift.lateCheckoutMinutes) && shift.lateCheckoutMinutes >= 0;
    if (!valid) absenceAssessmentBlocked = true;
    return valid;
  });
  const recorded = new Set(input.recordedDays);
  for (let number = 1; number <= 31; number++) {
    const day = `${input.month}-${String(number).padStart(2, "0")}`;
    if (!isCalendarDate(day)) break;
    if (recorded.has(day) || (input.serviceStartDate && day < input.serviceStartDate)) continue;
    const endedWorkday = assignments.some(({ assignedAt, unassignedAt, shift }) => {
      const occurrence = currentShiftOccurrence(shift, new Date(`${day}T${shift.startTime}:00+03:00`));
      return occurrence?.shiftDate === day
        && occurrence.shiftStartAt >= assignedAt
        && (!unassignedAt || occurrence.shiftEndAt <= unassignedAt)
        // Attendance actions remain possible at the exact grace-window boundary.
        && input.now > occurrence.end;
    });
    if (!endedWorkday) continue;
    if (validLeaves.some(({ start, end }) => start! <= day && end! >= day)) {
      dayStatuses.push({ day, status: "leave" });
    } else if (!absenceAssessmentBlocked) {
      dayStatuses.push({ day, status: "absent" });
    }
  }
  return { dayStatuses, absenceAssessmentBlocked };
}
