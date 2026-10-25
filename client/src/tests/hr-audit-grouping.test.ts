import { describe, expect, test } from "@jest/globals";

import { groupAttendanceEvents, type AttendanceAuditEvent } from "../lib/hr-audit-grouping";

type FixtureEvent = AttendanceAuditEvent & { marker: string };
const event = (id: number, marker: string, action: FixtureEvent["action"], occurred_at: string, options: Partial<FixtureEvent> = {}): FixtureEvent => ({
  id,
  marker,
  action,
  occurred_at,
  user_id: 14,
  session_id: 81,
  shift_date: "2026-04-12",
  ...options,
});

describe("HR attendance audit row grouping", () => {
  test("keeps distinct attendance sessions separate for the same employee and date", () => {
    const rows = groupAttendanceEvents([
      event(1, "first-in", "check_in", "2026-04-12T06:00:00.000Z", { session_id: 81 }),
      event(2, "first-out", "check_out", "2026-04-12T10:00:00.000Z", { session_id: 81 }),
      event(3, "second-in", "check_in", "2026-04-12T12:00:00.000Z", { session_id: 82 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sessionOrder)).toEqual([Date.parse("2026-04-12T12:00:00.000Z"), Date.parse("2026-04-12T06:00:00.000Z")]);
    expect(rows[1].events.map((entry) => entry.marker)).toEqual(["first-in", "first-out"]);
  });

  test("retains every repeated break start and return in chronological order", () => {
    const rows = groupAttendanceEvents([
      event(4, "return-2", "break_end", "2026-04-12T10:30:00.000Z"),
      event(1, "check-in", "check_in", "2026-04-12T06:00:00.000Z"),
      event(3, "break-2", "break_start", "2026-04-12T10:00:00.000Z"),
      event(2, "break-1", "break_start", "2026-04-12T08:00:00.000Z"),
      event(5, "return-1", "break_end", "2026-04-12T08:15:00.000Z"),
    ])[0];

    expect(rows.breakStarts.map((entry) => entry.marker)).toEqual(["break-1", "break-2"]);
    expect(rows.breakEnds.map((entry) => entry.marker)).toEqual(["return-1", "return-2"]);
    expect(rows.events).toHaveLength(5);
  });

  test("uses shift_date when checkout crosses into the next calendar month", () => {
    const rows = groupAttendanceEvents([
      event(1, "arrive", "check_in", "2026-04-30T20:30:00.000Z", { shift_date: "2026-04-30" }),
      event(2, "depart-next-month", "check_out", "2026-05-01T06:15:00.000Z", { shift_date: "2026-04-30" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].shift_date).toBe("2026-04-30");
    expect(rows[0].checkOuts[0].marker).toBe("depart-next-month");
  });

  test("groups unlinked events by the same Riyadh local date, not UTC date", () => {
    const rows = groupAttendanceEvents([
      event(1, "riyadh-midnight", "check_in", "2026-04-11T21:15:00.000Z", { session_id: null, shift_date: null }),
      event(2, "same-riyadh-date", "break_start", "2026-04-12T02:00:00.000Z", { session_id: null, shift_date: null }),
      event(3, "previous-riyadh-date", "check_out", "2026-04-11T20:59:00.000Z", { session_id: null, shift_date: null }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.events.some((entry) => entry.marker === "riyadh-midnight"))?.events.map((entry) => entry.marker)).toEqual(["riyadh-midnight", "same-riyadh-date"]);
    expect(rows.map((row) => row.shift_date)).toEqual(["2026-04-12", "2026-04-11"]);
  });

  test("sorts accounting dates descending and sessions deterministically within a date", () => {
    const rows = groupAttendanceEvents([
      event(1, "older-date", "check_in", "2026-04-10T08:00:00.000Z", { session_id: 1, shift_date: "2026-04-10" }),
      event(2, "earlier-session", "check_in", "2026-04-12T06:00:00.000Z", { session_id: 2, shift_date: "2026-04-12" }),
      event(3, "later-session", "check_in", "2026-04-12T12:00:00.000Z", { session_id: 3, shift_date: "2026-04-12" }),
    ]);

    expect(rows.map((row) => row.employee.marker)).toEqual(["later-session", "earlier-session", "older-date"]);
  });
});
