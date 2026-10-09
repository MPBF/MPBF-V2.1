import { describe, expect, test } from "@jest/globals";

import {
  attendanceSessionSummary,
  attendanceStatus,
  canRecordAttendance,
  completedSessionDaysInMonth,
  isPriorIncompleteSession,
  sessionEventState,
} from "../server/self-service-rules";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 8, minute, 0));

describe("attendance state and live-work timer", () => {
  test("allows only the next valid action", () => {
    expect(canRecordAttendance("check_in")).toBe(true);
    expect(canRecordAttendance("break_start", "check_in")).toBe(true);
    expect(canRecordAttendance("break_end", "break_start")).toBe(true);
    expect(canRecordAttendance("check_out", "break_end")).toBe(true);
    expect(canRecordAttendance("check_out", "break_start")).toBe(false);
  });

  test("pauses during break and resumes after return", () => {
    const summary = attendanceSessionSummary([
      { action: "check_in", occurred_at: at(0) },
      { action: "break_start", occurred_at: at(20) },
      { action: "break_end", occurred_at: at(30) },
    ], at(50));

    expect(summary.workedSeconds).toBe(40 * 60);
    expect(summary.actionTimes.break_start).toEqual(at(20));
    expect(attendanceStatus("break_end")).toBe("working");
  });

  test("stops permanently after checkout", () => {
    const events = [
      { action: "check_in", occurred_at: at(0) },
      { action: "check_out", occurred_at: at(45) },
    ];
    expect(attendanceSessionSummary(events, at(59)).workedSeconds).toBe(45 * 60);
    expect(attendanceSessionSummary(events, at(59)).actionTimes.check_out).toEqual(at(45));
  });

  test("keeps a break-without-return session incomplete and non-working", () => {
    const events = [
      { action: "check_in", occurred_at: at(0) },
      { action: "break_start", occurred_at: at(20) },
    ];

    expect(sessionEventState(events)).toBe("break");
    expect(canRecordAttendance("check_out", "break_start")).toBe(false);
    expect(attendanceSessionSummary(events, at(60)).workedSeconds).toBe(20 * 60);
  });

  test("marks a missing checkout from a prior window unresolved without changing its state", () => {
    const session = {
      check_out_at: null,
      window_end_at: at(40),
    };
    expect(isPriorIncompleteSession(session, at(41))).toBe(true);
    expect(isPriorIncompleteSession(session, at(39))).toBe(false);
    expect(sessionEventState([{ action: "check_in", occurred_at: at(0) }], session.check_out_at)).toBe("working");
  });

  test("counts completed attendance days by the scheduled shift date", () => {
    expect(completedSessionDaysInMonth([
      { shift_date: "2026-09-25", check_out_at: at(45) },
      { shift_date: "2026-09-25", check_out_at: at(50) },
      { shift_date: "2026-09-26", check_out_at: null },
      { shift_date: "2026-08-31", check_out_at: at(20) },
    ], "2026-09")).toBe(1);
  });
});
