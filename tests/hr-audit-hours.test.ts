import { describe, expect, it } from "@jest/globals";
import { groupAttendanceEvents, type AttendanceAction } from "../client/src/lib/hr-audit-grouping";
import { auditWorkMinutes } from "../client/src/lib/hr-audit-hours";
import { summarizeAttendance } from "../server/hr-report";

const motions = (entries: [AttendanceAction, string][], expected: number | null = 450) => entries.map(([action, occurred_at], i) => ({
  id: i + 1, user_id: 7, session_id: 1, shift_date: "2026-10-16", expected_minutes: expected,
  action, occurred_at: `2026-10-16T${occurred_at}+03:00`,
}));
const calculate = (events: ReturnType<typeof motions>, incomplete = false) =>
  auditWorkMinutes(groupAttendanceEvents(events)[0], incomplete);
const day: [AttendanceAction, string][] = [
  ["check_in", "08:00:00"], ["break_start", "12:00:00"],
  ["break_end", "12:30:00"], ["check_out", "17:00:00"],
];

describe("HR audit verified work and overtime minutes", () => {
  it("subtracts the recorded break, comparing against saved net shift minutes", () => {
    expect(calculate(motions(day))).toEqual({ workedMinutes: 510, overtimeMinutes: 60 });
  });
  it("does not deduct an invented break and does not show negative overtime", () => {
    expect(calculate(motions([["check_in", "08:00:00"], ["check_out", "15:00:00"]])))
      .toEqual({ workedMinutes: 420, overtimeMinutes: 0 });
  });
  it("shows unknown overtime for historical rows without a session duration", () => {
    expect(calculate(motions(day, null))).toEqual({ workedMinutes: 510, overtimeMinutes: null });
  });
  it("withholds both totals until the row is complete", () => {
    expect(calculate(motions(day), true)).toEqual({ workedMinutes: null, overtimeMinutes: null });
    expect(calculate(motions(day.slice(0, -1)))).toEqual({ workedMinutes: null, overtimeMinutes: null });
  });
  it.each([
    [["check_in", "08:00:00"], ["break_start", "12:00:00"], ["check_out", "17:00:00"]],
    [["check_in", "08:00:00"], ["break_end", "12:00:00"], ["check_out", "17:00:00"]],
    [["check_in", "08:00:00"], ["break_start", "12:30:00"], ["break_end", "12:00:00"], ["check_out", "17:00:00"]],
    [["break_start", "07:00:00"], ["check_in", "08:00:00"], ["break_end", "12:00:00"], ["check_out", "17:00:00"]],
    [["check_in", "08:00:00"], ["check_in", "09:00:00"], ["check_out", "17:00:00"]],
    [...day, ["break_start", "13:00:00"], ["break_end", "13:15:00"]],
  ] as [AttendanceAction, string][][])("does not display misleading totals for malformed motions %j", (...entries) => {
    expect(calculate(motions(entries))).toEqual({ workedMinutes: null, overtimeMinutes: null });
  });
  it("uses actual overnight timestamps while retaining the shift start date", () => {
    const events = motions([["check_in", "20:00:00"], ["break_start", "23:00:00"], ["break_end", "23:30:00"], ["check_out", "05:00:00"]]);
    events[3].occurred_at = "2026-10-17T05:00:00+03:00";
    expect(calculate(events)).toEqual({ workedMinutes: 510, overtimeMinutes: 60 });
    expect(groupAttendanceEvents(events)[0].shift_date).toBe("2026-10-16");
  });
  it("matches monthly report interval rounding, including correction of checkout", () => {
    const events = motions([["check_in", "08:00:20"], ["break_start", "12:00:05"], ["break_end", "12:30:30"], ["check_out", "17:00:10"]]);
    const report = summarizeAttendance(7, events.map(e => ({
      id: e.id, userId: 7, assignmentId: null, sessionId: 1, action: e.action, occurredAt: new Date(e.occurred_at),
    })), [], { start: new Date("2026-10-01T00:00:00+03:00"), end: new Date("2026-11-01T00:00:00+03:00") },
    new Date("2026-11-02T00:00:00+03:00"), [{
      id: 1, userId: 7, shiftDate: "2026-10-16", expectedMinutes: 450,
      shiftStartAt: new Date("2026-10-16T08:00:00+03:00"), shiftEndAt: new Date("2026-10-16T16:00:00+03:00"),
      checkInAt: new Date(events[0].occurred_at), checkOutAt: new Date(events[3].occurred_at),
    }]);
    expect(calculate(events)).toEqual({ workedMinutes: report.workedMinutes, overtimeMinutes: report.overtimeMinutes });
    events[3].occurred_at = "2026-10-16T18:00:10+03:00";
    expect(calculate(events).workedMinutes).toBe(report.workedMinutes + 60);
  });
});
