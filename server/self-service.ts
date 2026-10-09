import {
  administrative_requests,
  attendance_events,
  attendance_sessions,
  internal_messages,
  shift_definitions,
  user_shift_assignments,
  user_violations,
  users,
} from "@shared/schema";
import { aliasedTable, and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import { requireAuth, requirePermission } from "./auth";
import { db } from "./db";
import {
  attendanceSessionSummary,
  canRecordAttendance,
  completedSessionDaysInMonth,
  isPriorIncompleteSession,
  sessionEventState,
} from "./self-service-rules";
import {
  distanceMeters,
  currentShiftWindow,
  currentShiftOccurrence,
  toActiveShift,
  validGeofence,
  type ShiftDefinition,
} from "./shift-geofence";

const router = Router();
const admin = requirePermission("admin");

function httpError(message: string, status: number, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function handle(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const idParam = z.string().regex(/^[1-9]\d*$/, "المعرّف غير صالح")
  .transform(Number).refine(Number.isSafeInteger, "المعرّف غير صالح");
const attendanceInput = z.object({
  action: z.enum(["check_in", "break_start", "break_end", "check_out"]),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(10000),
}).strict();
const messageInput = z.object({
  recipient_id: z.number().int().positive(),
  body: z.string().trim().min(1, "محتوى الرسالة مطلوب").max(4000, "الرسالة طويلة جدًا"),
  reply_to_id: z.number().int().positive().optional(),
}).strict();
const requestInput = z.object({
  type: z.enum(["leave", "permission", "other"]),
  title: z.string().trim().min(1, "عنوان الطلب مطلوب").max(200),
  details: z.string().trim().min(1, "تفاصيل الطلب مطلوبة").max(10000),
}).strict();
const reviewInput = z.object({
  status: z.enum(["approved", "rejected"]),
  response: z.string().trim().max(4000).default(""),
}).strict();
const violationInput = z.object({
  user_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().min(1).max(10000),
}).strict();

function currentRiyadhMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const monthNumber = Number(parts.find((part) => part.type === "month")?.value);
  const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
  // Riyadh uses UTC+03:00. Database timestamps are stored as instants.
  const start = new Date(Date.UTC(year, monthNumber - 1, 1) - 3 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, monthNumber, 1) - 3 * 60 * 60 * 1000);
  return { month, start, end };
}

function monthForOffset(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const target = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function shiftDefinition(row: typeof shift_definitions.$inferSelect): ShiftDefinition {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en ?? undefined,
    startTime: row.start_time,
    endTime: row.end_time,
    nextDayCheckinTime: row.next_day_checkin_time,
    earlyCheckinMinutes: row.early_checkin_minutes,
    lateCheckoutMinutes: row.late_checkout_minutes,
    breakMinutes: row.break_minutes,
    geofenceEnabled: row.geofence_enabled,
    geofenceCenterLat: row.geofence_center_lat == null ? undefined : Number(row.geofence_center_lat),
    geofenceCenterLng: row.geofence_center_lng == null ? undefined : Number(row.geofence_center_lng),
    geofenceRadiusMeters: row.geofence_radius_meters,
  };
}

function enforceGeofence(shift: ShiftDefinition, input: { latitude: number; longitude: number }) {
  if (!shift.geofenceEnabled) return;
  const geofence = validGeofence(shift);
  if (!geofence) throw httpError("إعداد النطاق الجغرافي للوردية غير مكتمل", 409, "INVALID_GEOFENCE");
  const distance = distanceMeters(input.latitude, input.longitude, geofence.centerLat, geofence.centerLng);
  if (distance > geofence.radiusMeters) {
    const shiftName = shift.nameAr || shift.nameEn || "الوردية الحالية";
    throw httpError(
      `موقعك خارج نطاق الحضور المسموح لوردية ${shiftName}. يجب أن تكون داخل ${Math.round(geofence.radiusMeters)} متر.`,
      403,
      "OUTSIDE_GEOFENCE",
    );
  }
}

router.use(requireAuth);

router.get("/attendance", handle(async (req, res) => {
  const userId = req.user!.id;
  const { month, start, end } = currentRiyadhMonth();
  const serverNow = new Date();
  const shiftDateStart = month + "-01";
  const nextMonth = monthForOffset(month, 1);
  const [events, sessionRows, assignmentRows] = await Promise.all([
    db.select({
      id: attendance_events.id,
      session_id: attendance_events.session_id,
      action: attendance_events.action,
      occurred_at: attendance_events.occurred_at,
      latitude: attendance_events.latitude,
      longitude: attendance_events.longitude,
      accuracy: attendance_events.accuracy,
    })
      .from(attendance_events)
      .leftJoin(attendance_sessions, eq(attendance_events.session_id, attendance_sessions.id))
      .where(and(
        eq(attendance_events.user_id, userId),
        or(
          and(
            isNull(attendance_events.session_id),
            sql`${attendance_events.occurred_at} >= ${start}`,
            sql`${attendance_events.occurred_at} < ${end}`,
          ),
          and(
            sql`${attendance_sessions.shift_date} >= ${shiftDateStart}`,
            sql`${attendance_sessions.shift_date} < ${nextMonth}`,
          ),
        ),
      ))
      .orderBy(attendance_events.occurred_at, attendance_events.id),
    db.select().from(attendance_sessions)
      .where(and(
        eq(attendance_sessions.user_id, userId),
        or(
          and(
            sql`${attendance_sessions.shift_date} >= ${shiftDateStart}`,
            sql`${attendance_sessions.shift_date} < ${nextMonth}`,
          ),
          and(
            sql`${attendance_sessions.window_start_at} <= ${serverNow}`,
            sql`${attendance_sessions.window_end_at} >= ${serverNow}`,
          ),
          isNull(attendance_sessions.check_out_at),
        ),
      ))
      .orderBy(desc(attendance_sessions.shift_start_at)),
    db.select({ assignment_id: user_shift_assignments.id, shift: shift_definitions })
      .from(user_shift_assignments)
      .innerJoin(shift_definitions, eq(user_shift_assignments.shift_id, shift_definitions.id))
      .where(and(
        eq(user_shift_assignments.user_id, userId),
        isNull(user_shift_assignments.unassigned_at),
        eq(shift_definitions.is_active, true),
      ))
      .limit(1),
  ]);
  const assignedShift = assignmentRows[0] ? shiftDefinition(assignmentRows[0].shift) : null;
  const shiftWindow = assignedShift ? currentShiftWindow(assignedShift, serverNow) : null;
  const currentSession = sessionRows.find((session) =>
    session.window_start_at <= serverNow && session.window_end_at >= serverNow,
  );
  const currentEvents = currentSession
    ? await db.select({ action: attendance_events.action, occurred_at: attendance_events.occurred_at })
      .from(attendance_events)
      .where(and(
        eq(attendance_events.user_id, userId),
        eq(attendance_events.session_id, currentSession.id),
      ))
      .orderBy(attendance_events.occurred_at, attendance_events.id)
    : [];
  const status = currentSession ? sessionEventState(currentEvents, currentSession.check_out_at) : "out";
  const session = attendanceSessionSummary(currentEvents, serverNow);
  const withinShiftWindow = Boolean(shiftWindow);
  const daysPresent = completedSessionDaysInMonth(sessionRows, month);
  const unresolvedIncompleteSession = sessionRows.find((row) => isPriorIncompleteSession(row, serverNow));
  res.json({
    events: events.map((event) => ({
      ...event,
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
      accuracy: Number(event.accuracy),
    })),
    status,
    month,
    daysPresent,
    activeShift: toActiveShift(assignedShift),
    withinShiftWindow,
    serverNow,
    currentSession: currentSession ? {
      id: currentSession.id,
      shiftId: currentSession.shift_id,
      shiftDate: currentSession.shift_date,
      checkInAt: currentSession.check_in_at,
      checkOutAt: currentSession.check_out_at,
      incomplete: currentSession.check_out_at === null,
    } : null,
    unresolvedIncompleteSession: unresolvedIncompleteSession ? {
      id: unresolvedIncompleteSession.id,
      shiftId: unresolvedIncompleteSession.shift_id,
      shiftDate: unresolvedIncompleteSession.shift_date,
      checkInAt: unresolvedIncompleteSession.check_in_at,
      windowEndAt: unresolvedIncompleteSession.window_end_at,
    } : null,
    workedSeconds: session.workedSeconds,
    sessionStartedAt: session.startedAt,
    actionTimes: Object.fromEntries(Object.entries(session.actionTimes).map(([action, time]) => [action, time.toISOString()])),
  });
}));

router.post("/attendance", handle(async (req, res) => {
  const input = attendanceInput.parse(req.body);
  const userId = req.user!.id;
  await db.transaction(async (tx) => {
    // Serialize actions per employee so simultaneous requests cannot skip a state.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${18497}, ${userId})`);
    const now = new Date();
    if (input.action === "check_in") {
      const assignment = await tx.select({ id: user_shift_assignments.id, shift: shift_definitions })
        .from(user_shift_assignments)
        .innerJoin(shift_definitions, eq(user_shift_assignments.shift_id, shift_definitions.id))
        .where(and(
          eq(user_shift_assignments.user_id, userId),
          isNull(user_shift_assignments.unassigned_at),
          eq(shift_definitions.is_active, true),
        ))
        .limit(1);
      if (!assignment[0]) throw httpError("لم يتم تعيين وردية لك. تواصل مع إدارة الموارد البشرية", 409, "NO_SHIFT_ASSIGNMENT");
      const shift = shiftDefinition(assignment[0].shift);
      const occurrence = currentShiftOccurrence(shift, now);
      if (!occurrence) throw httpError("لا يمكن تنفيذ العملية خارج النطاق الزمني لورديتك", 403, "OUTSIDE_SHIFT_WINDOW");
      enforceGeofence(shift, input);

      const existing = await tx.select({ id: attendance_sessions.id })
        .from(attendance_sessions)
        .where(and(
          eq(attendance_sessions.user_id, userId),
          eq(attendance_sessions.shift_start_at, occurrence.shiftStartAt),
        ))
        .limit(1);
      if (existing[0]) throw httpError("تم تسجيل الحضور لهذه الوردية مسبقًا", 409, "SESSION_ALREADY_EXISTS");

      const [created] = await tx.insert(attendance_sessions).values({
        user_id: userId,
        shift_assignment_id: assignment[0].id,
        shift_id: shift.id,
        shift_date: occurrence.shiftDate,
        shift_start_at: occurrence.shiftStartAt,
        shift_end_at: occurrence.shiftEndAt,
        window_start_at: occurrence.start,
        window_end_at: occurrence.end,
        expected_minutes: occurrence.expectedMinutes,
        check_in_at: sql`clock_timestamp()`,
      }).returning({ id: attendance_sessions.id, check_in_at: attendance_sessions.check_in_at });
      await tx.insert(attendance_events).values({
        user_id: userId,
        shift_assignment_id: assignment[0].id,
        session_id: created.id,
        action: "check_in",
        occurred_at: created.check_in_at,
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        accuracy: String(input.accuracy),
      });
      return;
    }

    const openSessions = await tx.select()
      .from(attendance_sessions)
      .where(and(eq(attendance_sessions.user_id, userId), isNull(attendance_sessions.check_out_at)))
      .orderBy(desc(attendance_sessions.shift_start_at));
    const eligibleSessions = openSessions.filter((candidate) =>
      candidate.window_start_at <= now && candidate.window_end_at >= now,
    );
    if (eligibleSessions.length > 1) {
      throw httpError("توجد أكثر من جلسة حضور مفتوحة ضمن النافذة الحالية", 409, "AMBIGUOUS_OPEN_SESSION");
    }
    const session = eligibleSessions[0];
    if (!session) {
      throw httpError("لا توجد جلسة حضور مفتوحة ضمن نافذتها الزمنية", 409, "NO_OPEN_SESSION");
    }

    const originalShiftRows = await tx.select().from(shift_definitions)
      .where(eq(shift_definitions.id, session.shift_id))
      .limit(1);
    if (originalShiftRows[0]) enforceGeofence(shiftDefinition(originalShiftRows[0]), input);

    const sessionEvents = await tx.select({ id: attendance_events.id, action: attendance_events.action })
      .from(attendance_events)
      .where(and(
        eq(attendance_events.user_id, userId),
        eq(attendance_events.session_id, session.id),
      ))
      .orderBy(desc(attendance_events.id));
    const lastAction = sessionEvents[0]?.action;
    if (!canRecordAttendance(input.action, lastAction)) {
      throw httpError("هذا الإجراء غير متاح حسب حالة جلسة الحضور الحالية", 409, "INVALID_SESSION_ACTION");
    }
    if (input.action === "check_out") {
      const [closed] = await tx.update(attendance_sessions)
        .set({ check_out_at: sql`clock_timestamp()` })
        .where(and(
          eq(attendance_sessions.id, session.id),
          isNull(attendance_sessions.check_out_at),
        ))
        .returning({ check_out_at: attendance_sessions.check_out_at });
      if (!closed) throw httpError("تم إغلاق جلسة الحضور بالفعل", 409, "SESSION_ALREADY_CLOSED");
      await tx.insert(attendance_events).values({
        user_id: userId,
        shift_assignment_id: session.shift_assignment_id,
        session_id: session.id,
        action: input.action,
        occurred_at: closed.check_out_at!,
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        accuracy: String(input.accuracy),
      });
      return;
    }
    await tx.insert(attendance_events).values({
      user_id: userId,
      shift_assignment_id: session.shift_assignment_id,
      session_id: session.id,
      action: input.action,
      occurred_at: sql`clock_timestamp()`,
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      accuracy: String(input.accuracy),
    });
  });
  res.json({ success: true });
}));

router.get("/recipients", handle(async (req, res) => {
  const recipients = await db.select({
    id: users.id,
    display_name: users.display_name,
    display_name_ar: users.display_name_ar,
  })
    .from(users)
    .where(and(eq(users.status, "active"), ne(users.id, req.user!.id)))
    .orderBy(users.display_name_ar, users.display_name, users.id);
  res.json(recipients);
}));

router.get("/messages", handle(async (req, res) => {
  const userId = req.user!.id;
  const sender = aliasedTable(users, "message_sender");
  const recipient = aliasedTable(users, "message_recipient");
  const rows = await db.select({
    id: internal_messages.id,
    sender_id: internal_messages.sender_id,
    recipient_id: internal_messages.recipient_id,
    sender_name: sql<string>`COALESCE(${sender.display_name_ar}, ${sender.display_name}, ${sender.username}, 'مستخدم')`,
    recipient_name: sql<string>`COALESCE(${recipient.display_name_ar}, ${recipient.display_name}, ${recipient.username}, 'مستخدم')`,
    body: internal_messages.body,
    reply_to_id: internal_messages.reply_to_id,
    created_at: internal_messages.created_at,
    read_at: internal_messages.read_at,
  })
    .from(internal_messages)
    .innerJoin(sender, eq(internal_messages.sender_id, sender.id))
    .innerJoin(recipient, eq(internal_messages.recipient_id, recipient.id))
    .where(or(
      eq(internal_messages.sender_id, userId),
      eq(internal_messages.recipient_id, userId),
    ))
    .orderBy(desc(internal_messages.created_at), desc(internal_messages.id))
    .limit(200);
  res.json(rows);
}));

router.post("/messages", handle(async (req, res) => {
  const input = messageInput.parse(req.body);
  const senderId = req.user!.id;
  if (input.recipient_id === senderId) {
    throw httpError("لا يمكن إرسال رسالة إلى حسابك", 400);
  }
  const recipient = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.recipient_id), eq(users.status, "active")))
    .limit(1);
  if (!recipient[0]) throw httpError("المستخدم المستلِم غير موجود أو غير نشط", 404);
  if (input.reply_to_id) {
    const parent = await db.select({
      sender_id: internal_messages.sender_id,
      recipient_id: internal_messages.recipient_id,
    })
      .from(internal_messages)
      .where(eq(internal_messages.id, input.reply_to_id))
      .limit(1);
    const message = parent[0];
    const samePair = message && (
      (message.sender_id === senderId && message.recipient_id === input.recipient_id) ||
      (message.sender_id === input.recipient_id && message.recipient_id === senderId)
    );
    if (!samePair) throw httpError("لا يمكن الرد إلا على رسالة بين هذين المستخدمين", 400);
  }
  const [created] = await db.insert(internal_messages).values({
    sender_id: senderId,
    recipient_id: input.recipient_id,
    body: input.body,
    reply_to_id: input.reply_to_id ?? null,
  }).returning({
    id: internal_messages.id,
    sender_id: internal_messages.sender_id,
    recipient_id: internal_messages.recipient_id,
    body: internal_messages.body,
    reply_to_id: internal_messages.reply_to_id,
    created_at: internal_messages.created_at,
    read_at: internal_messages.read_at,
  });
  res.status(201).json(created);
}));

router.post("/messages/:id/read", handle(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const recipientId = req.user!.id;
  const [updated] = await db.update(internal_messages)
    .set({ read_at: new Date() })
    .where(and(
      eq(internal_messages.id, id),
      eq(internal_messages.recipient_id, recipientId),
      sql`${internal_messages.read_at} IS NULL`,
    ))
    .returning({ id: internal_messages.id });
  if (!updated) {
    const ownMessage = await db.select({ id: internal_messages.id })
      .from(internal_messages)
      .where(and(eq(internal_messages.id, id), eq(internal_messages.recipient_id, recipientId)))
      .limit(1);
    if (!ownMessage[0]) throw httpError("الرسالة غير موجودة", 404);
  }
  res.json({ success: true });
}));

router.get("/requests", handle(async (req, res) => {
  const rows = await db.select({
    id: administrative_requests.id,
    type: administrative_requests.type,
    title: administrative_requests.title,
    details: administrative_requests.details,
    status: administrative_requests.status,
    response: administrative_requests.response,
    created_at: administrative_requests.created_at,
    responded_at: administrative_requests.responded_at,
  })
    .from(administrative_requests)
    .where(eq(administrative_requests.user_id, req.user!.id))
    .orderBy(desc(administrative_requests.created_at), desc(administrative_requests.id))
    .limit(200);
  res.json(rows);
}));

router.post("/requests", handle(async (req, res) => {
  const input = requestInput.parse(req.body);
  const [created] = await db.insert(administrative_requests).values({
    user_id: req.user!.id,
    ...input,
  }).returning({
    id: administrative_requests.id,
    type: administrative_requests.type,
    title: administrative_requests.title,
    details: administrative_requests.details,
    status: administrative_requests.status,
    response: administrative_requests.response,
    created_at: administrative_requests.created_at,
    responded_at: administrative_requests.responded_at,
  });
  res.status(201).json(created);
}));

router.get("/violations", handle(async (req, res) => {
  const rows = await db.select({
    id: user_violations.id,
    title: user_violations.title,
    details: user_violations.details,
    created_at: user_violations.created_at,
    acknowledged_at: user_violations.acknowledged_at,
  })
    .from(user_violations)
    .where(eq(user_violations.user_id, req.user!.id))
    .orderBy(desc(user_violations.created_at), desc(user_violations.id))
    .limit(200);
  res.json(rows);
}));

router.post("/violations/:id/ack", handle(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const userId = req.user!.id;
  const [updated] = await db.update(user_violations)
    .set({ acknowledged_at: new Date() })
    .where(and(
      eq(user_violations.id, id),
      eq(user_violations.user_id, userId),
      sql`${user_violations.acknowledged_at} IS NULL`,
    ))
    .returning({ id: user_violations.id });
  if (!updated) {
    const ownViolation = await db.select({ id: user_violations.id })
      .from(user_violations)
      .where(and(eq(user_violations.id, id), eq(user_violations.user_id, userId)))
      .limit(1);
    if (!ownViolation[0]) throw httpError("المخالفة غير موجودة", 404);
  }
  res.json({ success: true });
}));

router.get("/admin/requests", admin, handle(async (_req, res) => {
  const rows = await db.select({
    id: administrative_requests.id,
    user_id: administrative_requests.user_id,
    user_name: sql<string>`COALESCE(${users.display_name_ar}, ${users.display_name}, ${users.username}, 'مستخدم')`,
    type: administrative_requests.type,
    title: administrative_requests.title,
    details: administrative_requests.details,
    status: administrative_requests.status,
    response: administrative_requests.response,
    created_at: administrative_requests.created_at,
    responded_at: administrative_requests.responded_at,
  })
    .from(administrative_requests)
    .innerJoin(users, eq(administrative_requests.user_id, users.id))
    .orderBy(desc(administrative_requests.created_at), desc(administrative_requests.id))
    .limit(500);
  res.json(rows);
}));

router.patch("/admin/requests/:id", admin, handle(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = reviewInput.parse(req.body);
  const [updated] = await db.update(administrative_requests)
    .set({
      status: input.status,
      response: input.response || null,
      responded_at: new Date(),
    })
    .where(eq(administrative_requests.id, id))
    .returning({
      id: administrative_requests.id,
      user_id: administrative_requests.user_id,
      status: administrative_requests.status,
      response: administrative_requests.response,
      responded_at: administrative_requests.responded_at,
    });
  if (!updated) throw httpError("الطلب غير موجود", 404);
  res.json(updated);
}));

router.get("/admin/violations", admin, handle(async (_req, res) => {
  const rows = await db.select({
    id: user_violations.id,
    user_id: user_violations.user_id,
    user_name: sql<string>`COALESCE(${users.display_name_ar}, ${users.display_name}, ${users.username}, 'مستخدم')`,
    title: user_violations.title,
    details: user_violations.details,
    created_at: user_violations.created_at,
    acknowledged_at: user_violations.acknowledged_at,
  })
    .from(user_violations)
    .innerJoin(users, eq(user_violations.user_id, users.id))
    .orderBy(desc(user_violations.created_at), desc(user_violations.id))
    .limit(500);
  res.json(rows);
}));

router.post("/admin/violations", admin, handle(async (req, res) => {
  const input = violationInput.parse(req.body);
  const user = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.user_id), eq(users.status, "active")))
    .limit(1);
  if (!user[0]) throw httpError("المستخدم المحدد غير موجود أو غير نشط", 404);
  const [created] = await db.insert(user_violations).values(input).returning({
    id: user_violations.id,
    user_id: user_violations.user_id,
    title: user_violations.title,
    details: user_violations.details,
    created_at: user_violations.created_at,
    acknowledged_at: user_violations.acknowledged_at,
  });
  res.status(201).json(created);
}));

export default router;
