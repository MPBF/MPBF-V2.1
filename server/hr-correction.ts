import { and, eq, gte, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { attendance_events, attendance_sessions } from "@shared/schema";
import { db } from "./db";
import { dayRange } from "./hr-report";
import { dailyBreakScope } from "./hr-single-break";

const action = z.enum(["check_in", "break_start", "break_end", "check_out"]);
export const correctionInput = z.object({
  session_id: z.number().int().positive().nullable(),
  user_id: z.number().int().positive(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_events: z.array(z.object({
    id: z.number().int().positive(),
    updated_at: z.string().datetime(),
  }).strict()).min(1).max(500),
  events: z.array(z.object({
    id: z.number().int().positive().optional(),
    action,
    occurred_at: z.string().datetime(),
  }).strict()).min(2).max(500),
}).strict();

type Correction = z.infer<typeof correctionInput>;
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
  const range = dayRange(input.shift_date);
  return db.transaction(async (tx) => {
    // Same per-employee lock as self-attendance and the existing checkout correction.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${18497}, ${input.user_id})`);
    const [session] = input.session_id == null ? [] : await tx.select()
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
    if (session) {
      if (checkIn < session.window_start_at || checkIn > session.window_end_at) {
        conflict("وقت الحضور خارج نافذة الوردية المحددة");
      }
      if (checkOut.getTime() > session.shift_start_at.getTime() + 24 * 60 * 60 * 1000) {
        conflict("تجاوزت الجلسة مهلة التصحيح البالغة 24 ساعة من بداية الوردية");
      }
      const overlapping = await tx.select({ id: attendance_sessions.id }).from(attendance_sessions).where(and(
        eq(attendance_sessions.user_id, input.user_id),
        ne(attendance_sessions.id, session.id),
        lt(attendance_sessions.check_in_at, checkOut),
        or(
          sql`${attendance_sessions.check_out_at} > ${checkIn}`,
          and(isNull(attendance_sessions.check_out_at), gte(attendance_sessions.check_in_at, checkIn)),
        ),
      )).limit(1);
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
          session_id: input.session_id,
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
  });
}
