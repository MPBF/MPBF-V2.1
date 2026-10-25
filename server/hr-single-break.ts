import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { attendance_events, attendance_sessions } from "@shared/schema";
import { dayRange } from "./hr-report";

/** Use the shift accounting day, including overnight breaks after midnight. */
export function dailyBreakScope(userId: number, shiftDate: string) {
  const range = dayRange(shiftDate);
  return and(
    eq(attendance_events.user_id, userId),
    eq(attendance_events.action, "break_start"),
    or(
      eq(attendance_sessions.shift_date, shiftDate),
      and(
        isNull(attendance_events.session_id),
        gte(attendance_events.occurred_at, range.start),
        lt(attendance_events.occurred_at, range.end),
      ),
    ),
  );
}
