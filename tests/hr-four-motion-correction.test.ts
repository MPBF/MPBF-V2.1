import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { db } from "../server/db";
import { correctAttendance, correctionInput, validateCorrection } from "../server/hr-correction";
import { attendance_events, attendance_sessions } from "../shared/schema";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
const stamp = "2026-06-28T18:00:00.000Z";
const original = [
  { id: 11, action: "check_in", occurred_at: new Date("2026-06-28T05:00:00Z"), updated_at: new Date(stamp) },
  { id: 12, action: "break_start", occurred_at: new Date("2026-06-28T09:00:00Z"), updated_at: new Date(stamp) },
];
const input = () => correctionInput.parse({
  user_id: 14, session_id: 71, shift_date: "2026-06-28",
  expected_events: original.map(({ id, updated_at }) => ({ id, updated_at: updated_at.toISOString() })),
  events: [
    { id: 11, action: "check_in", occurred_at: "2026-06-28T05:15:00.000Z" },
    { id: 12, action: "break_start", occurred_at: "2026-06-28T09:15:00.000Z" },
    { action: "break_end", occurred_at: "2026-06-28T09:45:00.000Z" },
    { action: "check_out", occurred_at: "2026-06-28T13:00:00.000Z" },
  ],
});
const baseSession = {
  id: 71, user_id: 14, shift_assignment_id: 9, shift_date: "2026-06-28",
  shift_start_at: new Date("2026-06-28T05:00:00Z"),
  window_start_at: new Date("2026-06-28T04:45:00Z"),
  window_end_at: new Date("2026-06-28T14:00:00Z"),
};

function mockTransaction({ session = baseSession as typeof baseSession | null, rows = original, overlap = false, failInsert = false } = {}) {
  const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  let locked = false;
  let sessionReads = 0;
  const tx = {
    execute: async () => { locked = true; },
    select: () => {
      let table: unknown;
      const result = () => {
        expect(locked).toBe(true);
        if (table === attendance_events) return rows;
        sessionReads++;
        return sessionReads === 1 ? session ? [session] : [] : overlap ? [{ id: 99 }] : [];
      };
      const query = {
        from: (value: unknown) => { table = value; return query; },
        where: () => query, orderBy: () => query, limit: () => Promise.resolve(result()),
        then: (resolve: (value: unknown[]) => void) => resolve(result()),
      };
      return query;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { writes.push({ table, values }); },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (failInsert) throw new Error("simulated database failure");
        writes.push({ table, values });
      },
    }),
  };
  jest.mocked(db.transaction).mockImplementation(async (fn) => {
    try { return await fn(tx as never) as never; }
    catch (error) { writes.length = 0; throw error; }
  });
  return { writes };
}
beforeEach(() => { jest.clearAllMocks(); });

describe("four-motion correction validation", () => {
  test("accepts edits to all four actions and missing action creation", () => {
    expect(validateCorrection(input(), original)).toHaveLength(4);
  });
  test("rejects stale data before writing", () => {
    const changed = original.map((event) => ({ ...event }));
    changed[0].updated_at = new Date("2026-06-28T19:00:00Z");
    expect(() => validateCorrection(input(), changed)).toThrow("تغير سجل الحضور");
  });
  test("rejects a new concurrent punch", () => {
    expect(() => validateCorrection(input(), [...original, { ...original[0], id: 99 }])).toThrow("تغير سجل الحضور");
  });
  test("prevents deleting or repurposing an original event", () => {
    const missing = input(); missing.events[1] = { action: "break_start", occurred_at: missing.events[1].occurred_at };
    expect(() => validateCorrection(missing, original)).toThrow("الحفاظ");
    const changed = input(); changed.events[1].action = "break_end";
    expect(() => validateCorrection(changed, original)).toThrow("نوع الحركة");
  });
  test("rejects unmatched, reversed and equal break times", () => {
    const bad = input(); bad.events[2].occurred_at = "2026-06-28T09:00:00.000Z";
    expect(() => validateCorrection(bad, original)).toThrow("ترتيب");
    bad.events[2].occurred_at = bad.events[1].occurred_at;
    expect(() => validateCorrection(bad, original)).toThrow("غير متساوية");
  });
  test("preserves multiple break pairs", () => {
    const repeated = input();
    repeated.events.splice(3, 0,
      { action: "break_start", occurred_at: "2026-06-28T10:00:00.000Z" },
      { action: "break_end", occurred_at: "2026-06-28T10:10:00.000Z" });
    expect(validateCorrection(repeated, original).filter((event) => event.action === "break_start")).toHaveLength(2);
  });
  test("permits a shift without breaks but requires checkout and forbids future timestamps", () => {
    const noBreak = input(); noBreak.events.splice(1, 2);
    noBreak.expected_events = [noBreak.expected_events[0]];
    expect(validateCorrection(noBreak, [original[0]])).toHaveLength(2);
    noBreak.events[1].occurred_at = "2099-01-01T00:00:00.000Z";
    expect(() => validateCorrection(noBreak, [original[0]])).toThrow("مستقبلي");
  });
});

describe("atomic four-motion session correction", () => {
  test("updates existing punches, adds missing ones and updates session boundaries in one transaction", async () => {
    const { writes } = mockTransaction();
    await expect(correctAttendance(input(), 7)).resolves.toEqual({ success: true });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(5);
    expect(writes[0]).toMatchObject({ table: attendance_events, values: { occurred_at: new Date("2026-06-28T05:15:00Z"), updated_by: 7 } });
    expect(writes[2]).toMatchObject({ values: { action: "break_end", created_by: 7, session_id: 71, user_id: 14 } });
    expect(writes[4]).toMatchObject({ table: attendance_sessions, values: {
      check_in_at: new Date("2026-06-28T05:15:00Z"), check_out_at: new Date("2026-06-28T13:00:00Z"),
    } });
  });
  test("works for completed sessions too", async () => {
    mockTransaction({ session: { ...baseSession, check_out_at: new Date("2026-06-28T12:00:00Z") } as typeof baseSession });
    await expect(correctAttendance(input(), 7)).resolves.toEqual({ success: true });
  });
  test("rejects overlap or out-of-window checkin without writes", async () => {
    const overlap = mockTransaction({ overlap: true });
    await expect(correctAttendance(input(), 7)).rejects.toThrow("تتداخل");
    expect(overlap.writes).toHaveLength(0);
    const outside = mockTransaction(); const bad = input(); bad.events[0].occurred_at = "2026-06-28T03:00:00.000Z";
    await expect(correctAttendance(bad, 7)).rejects.toThrow("نافذة");
    expect(outside.writes).toHaveLength(0);
  });
  test("rejects missing sessions, mismatched accounting dates and overlong corrections", async () => {
    mockTransaction({ session: null });
    await expect(correctAttendance(input(), 7)).rejects.toThrow("غير موجودة");
    const mismatch = mockTransaction();
    const wrongDay = input(); wrongDay.shift_date = "2026-06-29";
    await expect(correctAttendance(wrongDay, 7)).rejects.toThrow("تاريخ احتساب");
    expect(mismatch.writes).toHaveLength(0);
    const long = mockTransaction();
    const overlong = input(); overlong.events[3].occurred_at = "2026-06-29T06:00:00.000Z";
    await expect(correctAttendance(overlong, 7)).rejects.toThrow("24");
    expect(long.writes).toHaveLength(0);
  });
  test("keeps an overnight checkout under the original accounting date", async () => {
    const overnight = input();
    overnight.events[3].occurred_at = "2026-06-28T23:00:00.000Z";
    const { writes } = mockTransaction();
    await expect(correctAttendance(overnight, 7)).resolves.toEqual({ success: true });
    const sessionWrite = writes.find((write) => write.table === attendance_sessions)!;
    expect(sessionWrite.values.check_out_at).toEqual(new Date("2026-06-28T23:00:00Z"));
    expect(sessionWrite.values).not.toHaveProperty("shift_date");
  });
  test("rolls all changes back when inserting a missing action fails", async () => {
    const { writes } = mockTransaction({ failInsert: true });
    await expect(correctAttendance(input(), 7)).rejects.toThrow("database failure");
    expect(writes).toHaveLength(0);
  });
  test("supports unlinked daily records without attaching them to a different shift", async () => {
    const { writes } = mockTransaction();
    const legacy = input(); legacy.session_id = null;
    await expect(correctAttendance(legacy, 7)).resolves.toEqual({ success: true });
    expect(writes).toHaveLength(4);
    expect(writes[2]).toMatchObject({ values: { session_id: null } });
  });
});
