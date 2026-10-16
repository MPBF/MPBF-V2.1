import { describe, expect, it } from "@jest/globals";
import { attendanceCalendarDate, groupAttendanceEventsByDay } from "../client/src/lib/self-attendance-days";

const event = (id: number, occurred_at: string, action = "check_in", shift_date?: string | null) => ({
  id, occurred_at, action, shift_date,
});

describe("monthly attendance day rows", () => {
  it("keeps an empty month empty", () => {
    expect(groupAttendanceEventsByDay([])).toEqual([]);
  });
  it("renders absence and leave days even if there are no events", () => {
    expect(groupAttendanceEventsByDay([], [
      { day: "2026-10-02", status: "leave" }, { day: "2026-10-01", status: "absent" },
    ])).toEqual([
      { day: "2026-10-01", events: [], status: "absent" },
      { day: "2026-10-02", events: [], status: "leave" },
    ]);
  });
  it("real attendance always takes precedence over a stale day status", () => {
    const events = [event(1, "2026-10-01T04:00:00Z", "check_in", "2026-10-01")];
    expect(groupAttendanceEventsByDay(events, [{ day: "2026-10-01", status: "absent" }]))
      .toEqual([{ day: "2026-10-01", events }]);
  });
  it("does not duplicate overlapping day statuses or mutate server arrays", () => {
    const statuses = [{ day: "2026-10-01", status: "absent" as const }, { day: "2026-10-01", status: "leave" as const }];
    const copy = JSON.stringify(statuses);
    expect(groupAttendanceEventsByDay([], statuses)).toEqual([{ day: "2026-10-01", events: [], status: "leave" }]);
    expect(JSON.stringify(statuses)).toBe(copy);
  });
  it("puts all four actions on one day row without changing their timestamps", () => {
    const events = [
      event(1, "2026-10-01T04:00:00Z"),
      event(2, "2026-10-01T08:00:00Z", "break_start"),
      event(3, "2026-10-01T08:30:00Z", "break_end"),
      event(4, "2026-10-01T12:00:00Z", "check_out"),
    ];
    expect(groupAttendanceEventsByDay(events)).toEqual([{ day: "2026-10-01", events }]);
  });
  it("preserves multiple breaks, partial days, and more than one session on a day", () => {
    const events = [
      event(1, "2026-10-02T04:00:00Z"),
      event(2, "2026-10-02T05:00:00Z", "break_start"),
      event(3, "2026-10-02T05:15:00Z", "break_end"),
      event(4, "2026-10-02T06:00:00Z", "break_start"),
      event(5, "2026-10-02T06:10:00Z", "break_end"),
      event(6, "2026-10-02T08:00:00Z", "check_out"),
      event(7, "2026-10-02T10:00:00Z"),
    ];
    expect(groupAttendanceEventsByDay(events)).toEqual([{ day: "2026-10-02", events }]);
  });
  it("uses Riyadh, not UTC or the browser timezone, for legacy events", () => {
    expect(attendanceCalendarDate("2026-09-30T21:30:00Z")).toBe("2026-10-01");
    expect(groupAttendanceEventsByDay([event(1, "2026-09-30T21:30:00Z", "check_in", null)])[0].day).toBe("2026-10-01");
  });
  it("keeps cross-midnight and month-boundary events on the session start day", () => {
    const events = [
      event(1, "2026-09-30T16:00:00Z", "check_in", "2026-09-30"),
      event(2, "2026-09-30T22:00:00Z", "break_start", "2026-09-30"),
      event(3, "2026-10-01T00:00:00Z", "check_out", "2026-09-30"),
    ];
    expect(groupAttendanceEventsByDay(events)).toEqual([{ day: "2026-09-30", events }]);
    expect(attendanceCalendarDate(events[2].occurred_at)).toBe("2026-10-01");
  });
  it("sorts day rows chronologically while preserving the server's event order", () => {
    const events = [
      event(3, "2026-10-03T04:00:00Z"),
      event(1, "2026-10-01T04:00:00Z"),
      event(2, "2026-10-01T04:00:00Z", "break_start"),
    ];
    const copy = [...events];
    expect(groupAttendanceEventsByDay(events).map(row => [row.day, row.events.map(e => e.id)]))
      .toEqual([["2026-10-01", [1, 2]], ["2026-10-03", [3]]]);
    expect(events).toEqual(copy);
  });
});
