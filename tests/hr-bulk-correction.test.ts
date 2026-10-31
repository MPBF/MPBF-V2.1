import { beforeEach, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../server/db";
import { bulkCorrectionInput, correctAttendanceBulk } from "../server/hr-correction";
import { buildBulkCorrections } from "../client/src/lib/hr-bulk-correction";
import { groupAttendanceEvents, type AttendanceAction } from "../client/src/lib/hr-audit-grouping";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
const stamp = "2026-06-30T00:00:00.000Z";
const actions: AttendanceAction[] = ["check_in", "break_start", "break_end", "check_out"];
const events = [
  ...actions.map((action, i) => ({ id: 11 + i, user_id: 14, session_id: 71, shift_date: "2026-06-28", action,
    occurred_at: `2026-06-28T${["08:00", "12:00", "12:30", "16:00"][i]}:00+03:00`, updated_at: stamp })),
  { id: 21, user_id: 8, session_id: 72, shift_date: "2026-06-29", action: "check_in" as const,
    occurred_at: "2026-06-29T08:00:00+03:00", updated_at: stamp },
];
const groups = groupAttendanceEvents(events).reverse();
const times = { check_in: "08:15", break_start: "12:15", break_end: "12:45", check_out: "17:00" };
const input = () => bulkCorrectionInput.parse({ corrections: buildBulkCorrections(groups, times) });
function mockBatch({ staleSecond = false, failInsert = false } = {}) {
  const payload = input();
  const replies = payload.corrections.flatMap((entry, index) => [
    [{
      id: entry.session_id, user_id: entry.user_id, shift_date: entry.shift_date, shift_assignment_id: 1,
      window_start_at: new Date(`${entry.shift_date}T04:45:00Z`),
      window_end_at: new Date(`${entry.shift_date}T06:00:00Z`),
      shift_start_at: new Date(`${entry.shift_date}T05:00:00Z`),
    }],
    events.filter((event) => event.session_id === entry.session_id).map((event) => ({
      ...event, occurred_at: new Date(event.occurred_at),
      updated_at: new Date(staleSecond && index === 1 ? "2026-07-01T00:00:00Z" : stamp),
    })),
    [], [],
  ]);
  const writes: unknown[] = [], staged: unknown[] = [], locks: unknown[][] = [];
  const tx = {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => { locks.push(new PgDialect().sqlToQuery(query).params); },
    select: () => {
      const result = () => replies.shift();
      const query = {
        from: () => query, where: () => query, orderBy: () => query, leftJoin: () => query,
        limit: async () => result(), then: (resolve: (value: unknown) => void) => resolve(result()),
      };
      return query;
    },
    update: (table: unknown) => ({ set: (values: unknown) => ({ where: async () => { staged.push({ table, values }); } }) }),
    insert: (table: unknown) => ({ values: async (values: unknown) => {
      if (failInsert) throw new Error("insert failure");
      staged.push({ table, values });
    } }),
  };
  jest.mocked(db.transaction).mockImplementation(async (fn) => {
    const result = await fn(tx as never);
    writes.push(...staged);
    return result as never;
  });
  return { writes, locks, payload };
}
beforeEach(() => { jest.clearAllMocks(); });

test("replaces completed times and creates missing actions, keeping each target's dates and IDs", () => {
  const payload = input().corrections;
  expect(payload[0].shift_date).toBe("2026-06-28");
  expect(payload[1].shift_date).toBe("2026-06-29");
  expect(payload[0].events[0]).toMatchObject({ id: 11, occurred_at: "2026-06-28T05:15:00.000Z" });
  expect(payload[1].events[0]).toMatchObject({ id: 21, occurred_at: "2026-06-29T05:15:00.000Z" });
  expect(payload[1].events[1]).not.toHaveProperty("id");
  expect(payload[1].expected_events).toHaveLength(1);
});
test("resolves overnight dates separately without changing the accounting date", () => {
  const payload = buildBulkCorrections(groups, { check_in: "20:00", break_start: "23:00", break_end: "00:00", check_out: "05:00" });
  expect(payload[0].events[3].occurred_at).toBe("2026-06-29T02:00:00.000Z");
  expect(payload[1].events[3].occurred_at).toBe("2026-06-30T02:00:00.000Z");
  expect(payload.map((entry) => entry.shift_date)).toEqual(["2026-06-28", "2026-06-29"]);
});
test("rejects empty, oversized and duplicated batches", () => {
  expect(() => bulkCorrectionInput.parse({ corrections: [] })).toThrow();
  const single = input().corrections[0];
  expect(() => bulkCorrectionInput.parse({ corrections: [single, single] })).toThrow("تكرار");
  expect(() => bulkCorrectionInput.parse({ corrections: Array(101).fill(single) })).toThrow();
  expect(() => buildBulkCorrections(groups, { ...times, break_end: "" })).toThrow("الأوقات الأربعة");
  expect(() => buildBulkCorrections(groupAttendanceEvents([...events, { ...events[0], id: 99 }]), times)).toThrow("المكررة");
});
test("commits all targets in one transaction under ordered employee locks", async () => {
  const { writes, locks, payload } = mockBatch();
  await expect(correctAttendanceBulk(payload, 7)).resolves.toEqual({ success: true, corrected: 2 });
  expect(db.transaction).toHaveBeenCalledTimes(1);
  expect(locks.slice(0, 2)).toEqual([[18497, 8], [18497, 14]]);
  expect(writes).toHaveLength(10);
});
test("a stale second target prevents committing the already processed first target", async () => {
  const { writes, payload } = mockBatch({ staleSecond: true });
  await expect(correctAttendanceBulk(payload, 7)).rejects.toThrow("الموظف 8 · 2026-06-29");
  expect(writes).toHaveLength(0);
  expect(db.transaction).toHaveBeenCalledTimes(1);
});
test("a missing-motion insert failure rolls back every target", async () => {
  const { writes, payload } = mockBatch({ failInsert: true });
  await expect(correctAttendanceBulk(payload, 7)).rejects.toThrow("insert failure");
  expect(writes).toHaveLength(0);
});
