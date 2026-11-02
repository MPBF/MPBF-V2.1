import { beforeEach, expect, jest, test } from "@jest/globals";
import { db } from "../server/db";
import { attendance_events, attendance_sessions, user_shift_assignments } from "../shared/schema";
import { correctionInput, correctAttendance, correctAttendanceBulk } from "../server/hr-correction";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
const input = () => correctionInput.parse({
  user_id: 8, session_id: null, shift_date: "2026-06-29", expected_events: [],
  events: [
    { action: "check_in", occurred_at: "2026-06-29T05:00:00.000Z" },
    { action: "break_start", occurred_at: "2026-06-29T09:00:00.000Z" },
    { action: "break_end", occurred_at: "2026-06-29T09:30:00.000Z" },
    { action: "check_out", occurred_at: "2026-06-29T14:00:00.000Z" },
  ],
});
const shift = { id: "DAY", start_time: "08:00", end_time: "17:00",
  early_checkin_minutes: 15, late_checkout_minutes: 15, break_minutes: 30 };
function transaction(options: { assigned?: typeof shift | null; recorded?: boolean; overlap?: boolean;
  otherBreak?: boolean; failInsert?: boolean; staleSecond?: boolean } = {}) {
  const writes: { table: unknown; values: any }[] = [];
  const locks: unknown[] = [];
  let active = 0;
  const pending: typeof writes = [];
  const tx: any = {
    execute: async () => { locks.push(18497); },
    select: () => {
      let table: unknown, joined = false;
      const query: any = {
        from(value: unknown) { table = value; return query; },
        leftJoin() { joined = true; return query; },
        innerJoin() { return query; }, where() { return query; },
        orderBy() { if (table === attendance_events) active++; return query; },
        limit: async () => result(),
        then: (resolve: any) => resolve(result()),
      };
      function result() {
        if (table === user_shift_assignments) return options.assigned === null ? [] : [{ id: 51, shift: options.assigned ?? shift }];
        if (table === attendance_sessions) return options.overlap ? [{ id: 99 }] : [];
        if (table === attendance_events) {
          if (!joined) return [];
          return options.recorded || (options.staleSecond && active > 1) || options.otherBreak ? [{ id: 99 }] : [];
        }
        return [];
      }
      return query;
    },
    insert: (table: unknown) => ({ values: (values: any) => {
      if (options.failInsert && table === attendance_events) throw Error("insert failed");
      const row = { ...values, id: 100 };
      pending.push({ table, values });
      return { returning: async () => [row], then: (resolve: any) => resolve([]) };
    } }),
    update: (table: unknown) => ({ set: (values: any) => ({ where: async () => { pending.push({ table, values }); } }) }),
  };
  jest.mocked(db.transaction).mockImplementation(async (callback: any) => {
    try { const value = await callback(tx); writes.push(...pending); return value; }
    catch (error) { pending.length = 0; throw error; }
  });
  return { writes, locks };
}
beforeEach(() => { jest.clearAllMocks(); });
test("creates an assigned day session and four manual actions with actor attribution", async () => {
  const { writes, locks } = transaction();
  await expect(correctAttendance(input(), 7)).resolves.toEqual({ success: true });
  expect(locks.length).toBeGreaterThan(0);
  const session = writes.find(w => w.table === attendance_sessions)!;
  expect(session.values).toMatchObject({ user_id: 8, shift_date: "2026-06-29", shift_assignment_id: 51, expected_minutes: 510 });
  const events = writes.filter(w => w.table === attendance_events);
  expect(events).toHaveLength(4);
  expect(events.every(w => w.values.session_id === 100 && w.values.created_by === 7 && w.values.source === "manual")).toBe(true);
});
test("supports no-assignment daily records without inventing a shift", async () => {
  const { writes } = transaction({ assigned: null });
  await correctAttendance(input(), 7);
  expect(writes).toHaveLength(4);
  expect(writes.every(w => w.values.session_id === null)).toBe(true);
});
test("keeps overnight events in the assigned shift start date", async () => {
  const { writes } = transaction({ assigned: { ...shift, start_time: "20:00", end_time: "05:00" } });
  const draft = input();
  draft.events.forEach((event, i) => { event.occurred_at = [
    "2026-06-29T17:00:00.000Z", "2026-06-29T21:00:00.000Z",
    "2026-06-29T21:30:00.000Z", "2026-06-30T02:00:00.000Z",
  ][i]; });
  await correctAttendance(draft, 7);
  expect(writes[0].values.shift_date).toBe("2026-06-29");
  expect(writes.filter(w => w.table === attendance_events).every(w => w.values.session_id === 100)).toBe(true);
});
test.each([{ recorded: true }, { overlap: true }, { failInsert: true }])("rejects stale/overlapping/failed empty saves atomically: %j", async options => {
  const { writes } = transaction(options);
  await expect(correctAttendance(input(), 7)).rejects.toThrow();
  expect(writes).toEqual([]);
});
test("future actions, invalid dates and fake session snapshots are rejected", async () => {
  transaction();
  const draft = input(); draft.events[3].occurred_at = "2099-01-01T00:00:00.000Z";
  await expect(correctAttendance(draft, 7)).rejects.toThrow("مستقبلي");
  expect(() => correctionInput.parse({ ...input(), shift_date: "2026-02-30" })).toThrow();
  expect(() => correctionInput.parse({ ...input(), session_id: 71 })).toThrow();
});
test("a stale second empty day rolls back the first day in bulk", async () => {
  const { writes } = transaction({ staleSecond: true });
  await expect(correctAttendanceBulk({ corrections: [input(), { ...input(), user_id: 9 }] }, 7)).rejects.toThrow();
  expect(writes).toEqual([]);
});
