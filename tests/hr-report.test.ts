import { describe, expect, it } from "@jest/globals";

import { dayRange, monthRange, riyadhDayKey, summarizeAttendance, type ReportSession } from "../server/hr-report";

describe("HR attendance reports", () => {
  it("uses Riyadh calendar boundaries", () => {
    const range = dayRange("2026-09-01");
    expect(range.start.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-01T21:00:00.000Z");
    expect(riyadhDayKey(range.start)).toBe("2026-09-01");
  });

  it("calculates work, breaks, overtime, and absence", () => {
    const range = monthRange("2026-09");
    const assignment = {
      id: 7,
      userId: 1,
      assignedAt: new Date("2026-08-31T21:00:00.000Z"),
      unassignedAt: null,
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
    };
    const events = [
      [1, "check_in", "2026-09-01T05:00:00.000Z"],
      [2, "break_start", "2026-09-01T09:00:00.000Z"],
      [3, "break_end", "2026-09-01T09:30:00.000Z"],
      [4, "check_out", "2026-09-01T14:00:00.000Z"],
    ].map(([id, action, occurredAt]) => ({
      id: Number(id), userId: 1, assignmentId: 7, action: String(action), occurredAt: new Date(String(occurredAt)),
    }));
    const totals = summarizeAttendance(1, events, [assignment], range, new Date("2026-09-03T12:00:00.000Z"));
    expect(totals.workedMinutes).toBe(510);
    expect(totals.overtimeMinutes).toBe(60);
    expect(totals.daysWorked).toBe(1);
    expect(totals.absentDays).toBe(1);
  });

  it("does not count Friday and Saturday as absence", () => {
    const range = monthRange("2026-09");
    const assignment = {
      id: 1,
      userId: 2,
      assignedAt: range.start,
      unassignedAt: null,
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 0,
    };
    const totals = summarizeAttendance(2, [], [assignment], range, new Date("2026-09-06T08:00:00.000Z"));
    expect(totals.absentDays).toBe(3);
  });

  it("waits until an overnight shift ends before counting absence, including assignments made after noon", () => {
    const range = monthRange("2026-09");
    const assignment = {
      id: 91,
      userId: 91,
      assignedAt: new Date("2026-09-28T13:00:00.000Z"),
      unassignedAt: null,
      startTime: "19:00",
      endTime: "03:00",
      breakMinutes: 0,
      lateCheckoutMinutes: 15,
    };
    const duringShift = summarizeAttendance(91, [], [assignment], range, new Date("2026-09-28T17:00:00.000Z"));
    expect(duringShift.absentDays).toBe(0);
    const afterShift = summarizeAttendance(91, [], [assignment], range, new Date("2026-09-29T01:00:00.000Z"));
    expect(afterShift.absentDays).toBe(1);
  });

  it("attributes an overnight session to its Riyadh shift date", () => {
    const range = monthRange("2026-01");
    const session: ReportSession = {
      id: 11,
      userId: 3,
      shiftDate: "2026-01-01",
      shiftStartAt: new Date("2026-01-01T16:00:00.000Z"),
      shiftEndAt: new Date("2026-01-02T00:00:00.000Z"),
      expectedMinutes: 480,
      checkInAt: new Date("2026-01-01T16:00:00.000Z"),
      checkOutAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const events = [
      { id: 1, userId: 3, assignmentId: null, sessionId: 11, action: "check_in", occurredAt: session.checkInAt },
      { id: 2, userId: 3, assignmentId: null, sessionId: 11, action: "check_out", occurredAt: session.checkOutAt! },
    ];
    const totals = summarizeAttendance(3, events, [], range, new Date("2026-02-02T00:00:00.000Z"), [session]);

    expect(totals.workedMinutes).toBe(480);
    expect(totals.daysWorked).toBe(1);
    expect(totals.overtimeMinutes).toBe(0);
  });

  it("attributes a month-boundary overnight session to the month of shiftDate", () => {
    const session: ReportSession = {
      id: 12,
      userId: 4,
      shiftDate: "2026-01-31",
      shiftStartAt: new Date("2026-01-31T16:00:00.000Z"),
      shiftEndAt: new Date("2026-02-01T00:00:00.000Z"),
      expectedMinutes: 480,
      checkInAt: new Date("2026-01-31T16:00:00.000Z"),
      checkOutAt: new Date("2026-02-01T00:00:00.000Z"),
    };
    const events = [
      { id: 1, userId: 4, assignmentId: null, sessionId: 12, action: "check_in", occurredAt: session.checkInAt },
      { id: 2, userId: 4, assignmentId: null, sessionId: 12, action: "check_out", occurredAt: session.checkOutAt! },
    ];
    const january = summarizeAttendance(4, events, [], monthRange("2026-01"), new Date("2026-03-01T00:00:00.000Z"), [session]);
    const february = summarizeAttendance(4, events, [], monthRange("2026-02"), new Date("2026-03-01T00:00:00.000Z"), [session]);

    expect(january.workedMinutes).toBe(480);
    expect(january.daysWorked).toBe(1);
    expect(february.workedMinutes).toBe(0);
    expect(february.daysWorked).toBe(0);
  });

  it("does not pay an incomplete session or count it absent", () => {
    const range = monthRange("2026-01");
    const session: ReportSession = {
      id: 13,
      userId: 5,
      shiftDate: "2026-01-04",
      shiftStartAt: new Date("2026-01-04T16:00:00.000Z"),
      shiftEndAt: new Date("2026-01-05T00:00:00.000Z"),
      expectedMinutes: 480,
      checkInAt: new Date("2026-01-04T16:00:00.000Z"),
      checkOutAt: null,
    };
    const events = [
      { id: 1, userId: 5, assignmentId: null, sessionId: 13, action: "check_in", occurredAt: session.checkInAt },
    ];
    const totals = summarizeAttendance(5, events, [], range, new Date("2026-01-10T00:00:00.000Z"), [session]);

    expect(totals.workedMinutes).toBe(0);
    expect(totals.daysWorked).toBe(0);
    expect(totals.incompleteDays).toBe(1);
    expect(totals.absentDays).toBe(0);
  });

  it("subtracts breaks and does not double count session events", () => {
    const range = monthRange("2026-01");
    const session: ReportSession = {
      id: 14,
      userId: 6,
      shiftDate: "2026-01-05",
      shiftStartAt: new Date("2026-01-05T16:00:00.000Z"),
      shiftEndAt: new Date("2026-01-06T00:00:00.000Z"),
      expectedMinutes: 450,
      checkInAt: new Date("2026-01-05T16:00:00.000Z"),
      checkOutAt: new Date("2026-01-06T00:00:00.000Z"),
    };
    const events = [
      { id: 1, userId: 6, assignmentId: null, sessionId: 14, action: "check_in", occurredAt: session.checkInAt },
      { id: 2, userId: 6, assignmentId: null, sessionId: 14, action: "break_start", occurredAt: new Date("2026-01-05T20:00:00.000Z") },
      { id: 3, userId: 6, assignmentId: null, sessionId: 14, action: "break_end", occurredAt: new Date("2026-01-05T20:30:00.000Z") },
      { id: 4, userId: 6, assignmentId: null, sessionId: 14, action: "check_out", occurredAt: session.checkOutAt! },
    ];
    const totals = summarizeAttendance(6, events, [], range, new Date("2026-02-01T00:00:00.000Z"), [session]);

    expect(totals.workedMinutes).toBe(450);
    expect(totals.daysWorked).toBe(1);
    expect(totals.overtimeMinutes).toBe(0);
  });

  it("attributes a complete legacy overnight interval to its check-in day without paying open intervals", () => {
    const range = monthRange("2026-01");
    const events = [
      { id: 1, userId: 7, assignmentId: null, action: "check_in", occurredAt: new Date("2026-01-01T20:00:00.000Z") },
      { id: 2, userId: 7, assignmentId: null, action: "check_out", occurredAt: new Date("2026-01-02T01:00:00.000Z") },
      { id: 3, userId: 7, assignmentId: null, action: "check_in", occurredAt: new Date("2026-01-02T05:00:00.000Z") },
    ];
    const totals = summarizeAttendance(7, events, [], range, new Date("2026-01-10T00:00:00.000Z"));

    expect(totals.workedMinutes).toBe(300);
    expect(totals.daysWorked).toBe(1);
  });
});
