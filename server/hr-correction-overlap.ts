import { and, eq, lt, ne, sql } from "drizzle-orm";
import { attendance_sessions } from "@shared/schema";

/** Open sessions reserve their correction window, not every later calendar day.
 * This is only a conflict-check boundary: it never supplies a checkout for pay
 * or changes the persisted incomplete status. Real checkouts remain authoritative.
 */
export function correctionSessionOverlap(userId: number, checkIn: Date, checkOut: Date, excludedSessionId?: number) {
  return and(
    eq(attendance_sessions.user_id, userId),
    excludedSessionId == null ? undefined : ne(attendance_sessions.id, excludedSessionId),
    lt(attendance_sessions.check_in_at, checkOut),
    sql`coalesce(${attendance_sessions.check_out_at}, ${attendance_sessions.shift_start_at} + interval '24 hours') > ${checkIn}`,
  );
}
