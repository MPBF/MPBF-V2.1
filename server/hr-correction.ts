import { and, desc, eq, gt, gte, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { attendance_events, attendance_sessions, shift_definitions, user_shift_assignments } from "@shared/schema";
import { db } from "./db";
import { dayRange } from "./hr-report";
import { dailyBreakScope } from "./hr-single-break";
import { currentShiftOccurrence } from "./shift-geofence";
import { correctionSessionOverlap } from "./hr-correction-overlap";

const action = z.enum(["check_in", "break_start", "break_end", "check_out"]);
export const correctionInput = z.object({
  session_id: z.number().int().positive().nullable(),
  user_id: z.number().int().positive(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_events: z.array(z.object({
    id: z.number().int().positive(),
    updated_at: z.string().datetime(),
  }).strict()).max(500),
  events: z.array(z.object({
    id: z.number().int().positive().optional(),
    action,
    occurred_at: z.string().datetime(),
  }).strict()).min(2).max(500),
}).strict().refine(input => input.session_id == null || input.expected_events.length > 0, {
  message: "جلسة الحضور تتطلب الحركات الأصلية للتحقق من التعارض",
}).refine(input => {
  const date = new Date(`${input.shift_date}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === input.shift_date;
}, { message: "تاريخ السجل غير صالح" });

type Correction = z.infer<typeof correctionInput>;
export const bulkCorrectionInput = z.object({
  corrections: z.array(correctionInput).min(1).max(100),
}).strict().superRefine(({ corrections }, ctx) => {
  const keys = corrections.map((entry) => `${entry.user_id}:${entry.session_id == null ? entry.shift_date : `session:${entry.session_id}`}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["corrections"], message: "لا يمكن تكرار السجل ضمن التصحيح الجماعي" });
  }
});
type CorrectionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StoredEvent = { id: number; action: string; occurred_at: Date; updated_at: Date };
const conflict = (message: string): never => { throw Object.assign(new Error(message), { status: 409 }); };

/** Validate the entire replacement timeline before writing anything. No original event is deleted. */
export function validateCorrection(input: Correction, current: StoredEvent[], now = new Date()) {
  const expected = new Map(input.expected_events.map((event) => [event.id, event.updated_at]));
  const existing = new Map(current.map((event) => [event.id, event]));
  if (expected.size !== input.expected_events.length || expected.size !== current.length ||
    current.some((event) => expected.get(event.id) !== event.updated_at.toISOString())) {
    conflict("تغير سجل الحضور أثناء التصحيح؛ حدّث الصفحة ثم أعد المحاولة");
  }
  const seen = new Set<number>();
  for (const event of input.events) {
    if (event.id != null) {
      if (seen.has(event.id) || !existing.has(event.id) || existing.get(event.id)!.action !== event.action) {
        conflict("لا يمكن تغيير نوع الحركة أو تعديل حركة خارج هذا السجل");
      }
      seen.add(event.id);
    }
    if (new Date(event.occurred_at) > now) conflict("لا يمكن تسجيل حركة حضور بتاريخ مستقبلي");
  }
  if (seen.size !== current.length) conflict("يجب الحفاظ على جميع حركات السجل أثناء التصحيح");
  if (input.events.filter((event) => event.action === "break_start").length > 1 ||
    input.events.filter((event) => event.action === "break_end").length > 1) {
    conflict("يسمح باستراحة واحدة فقط في اليوم");
  }
  const timeline = input.events.slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  let state: "start" | "working" | "break" | "closed" = "start";
  for (let index = 0; index < timeline.length; index++) {
    const event = timeline[index];
    if (index && Date.parse(event.occurred_at) <= Date.parse(timeline[index - 1].occurred_at)) {
      conflict("يجب أن تكون أوقات الحركات متتابعة وغير متساوية");
    }
    if (state === "start" && event.action === "check_in") state = "working";
    else if (state === "working" && event.action === "break_start") state = "break";
    else if (state === "break" && event.action === "break_end") state = "working";
    else if (state === "working" && event.action === "check_out") state = "closed";
    else conflict("ترتيب الحركات غير صالح: حضور ثم استراحة وعودة ثم انصراف");
  }
  if (state !== "closed") conflict("يجب إكمال الحضور والانصراف وإغلاق كل استراحة");
  return timeline;
}

export async function correctAttendance(input: Correction, actorId: number) {
  return db.transaction((tx) => correctAttendanceInTransaction(tx, input, actorId));
}

/** Lock every employee in a stable order; any rejected record rolls back the whole batch. */
export async function correctAttendanceBulk(input: z.infer<typeof bulkCorrectionInput>, actorId: number) {
  return db.transaction(async (tx) => {
    const userIds = [...new Set(input.corrections.map((entry) => entry.user_id))].sort((a, b) => a - b);
    for (const userId of userIds) await tx.execute(sql`SELECT pg_advisory_xact_lock(${18497}, ${userId})`);
    for (const correction of input.corrections) {
      try {
        await correctAttendanceInTransaction(tx, correction, actorId);
      } catch (error) {
        const cause = error as Error & { status?: number };
        throw Object.assign(new Error(`الموظف ${correction.user_id} · ${correction.shift_date}: ${cause.message}`), { status: cause.status ?? 500 });
      }
    }
    return { success: true, corrected: input.corrections.length };
  });
}

async function correctAttendanceInTransaction(tx: CorrectionTransaction, input: Correction, actorId: number) {
  const range = dayRange(input.shift_date);
    // Same per-employee lock as self-attendance and the existing checkout correction.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${18497}, ${input.user_id})`);
    let [session] = input.session_id == null ? [] : await tx.select()
      .from(attendance_sessions).where(and(
        eq(attendance_sessions.id, input.session_id),
        eq(attendance_sessions.user_id, input.user_id),
      )).limit(1);
    if (input.session_id != null && !session) {
      throw Object.assign(new Error("جلسة الحضور غير موجودة"), { status: 404 });
    }
    if (session && session.shift_date !== input.shift_date) conflict("تاريخ احتساب الوردية لا يطابق السجل");
    const scope = and(
      eq(attendance_events.user_id, input.user_id),
      input.session_id == null ? and(
        isNull(attendance_events.session_id),
        gte(attendance_events.occurred_at, range.start),
        lt(attendance_events.occurred_at, range.end),
      ) : eq(attendance_events.session_id, input.session_id),
    );
    const current = await tx.select().from(attendance_events).where(scope).orderBy(attendance_events.id);
    const timeline = validateCorrection(input, current);
    const checkIn = new Date(timeline[0].occurred_at);
    const checkOut = new Date(timeline[timeline.length - 1].occurred_at);
    const creatingDay = input.session_id == null && input.expected_events.length === 0;
    if (creatingDay) {
      if (checkIn < range.start || checkIn >= range.end) conflict("وقت الحضور لا يطابق تاريخ السجل");
      // An empty calendar row is an optimistic snapshot too. Check all sessions,
      // including those without events, while holding the same employee lock.
      const recorded = await tx.select({ id: attendance_events.id }).from(attendance_events)
        .leftJoin(attendance_sessions, eq(attendance_events.session_id, attendance_sessions.id))
        .where(and(eq(attendance_events.user_id, input.user_id), or(
          eq(attendance_sessions.shift_date, input.shift_date),
          and(isNull(attendance_events.session_id), gte(attendance_events.occurred_at, range.start), lt(attendance_events.occurred_at, range.end)),
        ))).limit(1);
      const recordedSessions = await tx.select({ id: attendance_sessions.id }).from(attendance_sessions)
        .where(and(eq(attendance_sessions.user_id, input.user_id), eq(attendance_sessions.shift_date, input.shift_date))).limit(1);
      if (recorded.length || recordedSessions.length) conflict("تغير سجل الحضور أثناء التصحيح؛ حدّث الصفحة ثم أعد المحاولة");
      const overlapping = await tx.select({ id: attendance_sessions.id }).from(attendance_sessions)
        .where(correctionSessionOverlap(input.user_id, checkIn, checkOut)).limit(1);
      if (overlapping.length) conflict("أوقات التصحيح تتداخل مع وردية أخرى");
      const otherEvents = await tx.select({ id: attendance_events.id }).from(attendance_events)
        .where(and(eq(attendance_events.user_id, input.user_id),
          gte(attendance_events.occurred_at, checkIn), lte(attendance_events.occurred_at, checkOut),
        )).limit(1);
      if (otherEvents.length) conflict("أوقات التصحيح تتداخل مع حركات حضور أخرى");
      const [assignment] = await tx.select({ id: user_shift_assignments.id, shift: shift_definitions })
        .from(user_shift_assignments)
        .innerJoin(shift_definitions, eq(user_shift_assignments.shift_id, shift_definitions.id))
        .where(and(eq(user_shift_assignments.user_id, input.user_id),
          lte(user_shift_assignments.assigned_at, checkIn),
          or(isNull(user_shift_assignments.unassigned_at), gt(user_shift_assignments.unassigned_at, checkIn)),
        )).orderBy(desc(user_shift_assignments.assigned_at)).limit(1);
      if (assignment) {
        const shift = assignment.shift;
        const occurrence = currentShiftOccurrence({
          id: shift.id, startTime: shift.start_time, endTime: shift.end_time,
          earlyCheckinMinutes: shift.early_checkin_minutes, lateCheckoutMinutes: shift.late_checkout_minutes,
          breakMinutes: shift.break_minutes, geofenceEnabled: false,
        }, checkIn);
        if (!occurrence || occurrence.shiftDate !== input.shift_date) return conflict("وقت الحضور خارج نافذة الوردية المحددة");
        if (checkOut.getTime() > occurrence.shiftStartAt.getTime() + 86400000) conflict("تجاوزت الجلسة مهلة التصحيح البالغة 24 ساعة من بداية الوردية");
        [session] = await tx.insert(attendance_sessions).values({
          user_id: input.user_id, shift_assignment_id: assignment.id, shift_id: shift.id,
          shift_date: input.shift_date, shift_start_at: occurrence.shiftStartAt, shift_end_at: occurrence.shiftEndAt,
          window_start_at: occurrence.start, window_end_at: occurrence.end,
          expected_minutes: occurrence.expectedMinutes, check_in_at: checkIn, check_out_at: checkOut,
        }).returning();
      }
    }
    if (session) {
      if (checkIn < session.window_start_at || checkIn > session.window_end_at) {
        conflict("وقت الحضور خارج نافذة الوردية المحددة");
      }
      if (checkOut.getTime() > session.shift_start_at.getTime() + 24 * 60 * 60 * 1000) {
        conflict("تجاوزت الجلسة مهلة التصحيح البالغة 24 ساعة من بداية الوردية");
      }
      const overlapping = await tx.select({ id: attendance_sessions.id }).from(attendance_sessions)
        .where(correctionSessionOverlap(input.user_id, checkIn, checkOut, session.id)).limit(1);
      if (overlapping.length) conflict("أوقات التصحيح تتداخل مع وردية أخرى");
    } else if (timeline.some((event) => {
      const time = new Date(event.occurred_at);
      return time < range.start || time >= range.end;
    })) {
      conflict("يجب أن تبقى الحركات غير المرتبطة بوردية ضمن تاريخ السجل");
    }
    if (timeline.some((event) => event.action === "break_start")) {
      const otherBreaks = await tx.select({ id: attendance_events.id }).from(attendance_events)
        .leftJoin(attendance_sessions, eq(attendance_events.session_id, attendance_sessions.id))
        .where(and(
          dailyBreakScope(input.user_id, input.shift_date),
          notInArray(attendance_events.id, current.map((event) => event.id)),
        )).limit(1);
      if (otherBreaks.length) conflict("يسمح باستراحة واحدة فقط في اليوم");
    }
    const now = new Date();
    for (const event of timeline) {
      if (event.id != null) {
        await tx.update(attendance_events).set({
          occurred_at: new Date(event.occurred_at), updated_by: actorId, updated_at: now,
        }).where(and(eq(attendance_events.id, event.id), eq(attendance_events.user_id, input.user_id)));
      } else {
        await tx.insert(attendance_events).values({
          user_id: input.user_id,
          session_id: session?.id ?? input.session_id,
          shift_assignment_id: session?.shift_assignment_id ?? null,
          action: event.action,
          occurred_at: new Date(event.occurred_at),
          source: "manual", latitude: "0", longitude: "0", accuracy: "0",
          created_by: actorId, updated_by: actorId, updated_at: now,
        });
      }
    }
    if (session) {
      await tx.update(attendance_sessions).set({
        check_in_at: checkIn, check_out_at: checkOut,
      }).where(eq(attendance_sessions.id, session.id));
    }
    return { success: true };
}
