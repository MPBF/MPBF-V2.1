import { describe, expect, it } from "@jest/globals";
import { monthlyAttendanceStatuses, riyadhCalendarDay } from "../server/self-attendance-history";
import { requestInput, reviewInput } from "../server/self-service-inputs";
import type { ShiftDefinition } from "../server/shift-geofence";

const shift: ShiftDefinition = {
  id: "day", startTime: "07:00", endTime: "15:00",
  earlyCheckinMinutes: 15, lateCheckoutMinutes: 15, geofenceEnabled: false,
};
const base = () => ({
  month: "2026-10", now: new Date("2026-10-05T12:16:00Z"),
  assignments: [{ assignedAt: new Date("2026-09-01T00:00:00Z"), unassignedAt: null as Date | null, shift }],
  recordedDays: [] as string[],
  approvedLeaves: [] as { start: string | null; end: string | null }[],
  serviceStartDate: "2026-10-01" as string | null, included: true,
});
const dates = (input = base()) => monthlyAttendanceStatuses(input).dayStatuses.map(row => row.day);

describe("read-only absence assessment", () => {
  it("includes only completed assigned workdays, never future dates", () => {
    expect(dates()).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
  });
  it("does not mark a still-open shift absent, including the exact grace boundary", () => {
    const input = base();
    input.now = new Date("2026-10-05T12:15:00Z");
    expect(dates(input)).not.toContain("2026-10-05");
    input.now = new Date("2026-10-05T12:15:00.001Z");
    expect(dates(input)).toContain("2026-10-05");
  });
  it("excludes all days before employment starts", () => {
    expect(dates({ ...base(), serviceStartDate: "2026-10-04" })).toEqual(["2026-10-04", "2026-10-05"]);
  });
  it("does not assume employment starts at the beginning of the month", () => {
    const input = base();
    input.assignments[0].assignedAt = new Date("2026-10-03T04:00:00Z");
    expect(dates(input)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
  });
  it("does not mark partial assignment days as missed full shifts", () => {
    const input = base();
    input.assignments[0].assignedAt = new Date("2026-10-03T08:00:00Z");
    input.assignments[0].unassignedAt = new Date("2026-10-05T08:00:00Z");
    expect(dates(input)).toEqual(["2026-10-04"]);
  });
  it("requires a shift assignment and attendance participation", () => {
    expect(dates({ ...base(), assignments: [] })).toEqual([]);
    expect(dates({ ...base(), included: false })).toEqual([]);
  });
  it("preserves days with real records, including incomplete or corrected sessions", () => {
    expect(dates({ ...base(), recordedDays: ["2026-10-01", "2026-10-04"] }))
      .toEqual(["2026-10-02", "2026-10-03", "2026-10-05"]);
  });
  it("shows inclusive approved leave dates as leave, never absence", () => {
    const result = monthlyAttendanceStatuses({ ...base(), approvedLeaves: [{ start: "2026-10-02", end: "2026-10-04" }] });
    expect(result.dayStatuses.map(row => row.status)).toEqual(["absent", "leave", "leave", "leave", "absent"]);
    expect(result.absenceAssessmentBlocked).toBe(false);
  });
  it("real attendance takes precedence over an approved leave", () => {
    const result = monthlyAttendanceStatuses({
      ...base(), recordedDays: ["2026-10-03"],
      approvedLeaves: [{ start: "2026-10-02", end: "2026-10-04" }],
    });
    expect(result.dayStatuses.some(row => row.day === "2026-10-03")).toBe(false);
  });
  it.each([
    { start: null, end: null },
    { start: "2026-10-01", end: null },
    { start: "2026-02-30", end: "2026-03-02" },
    { start: "2026-10-04", end: "2026-10-01" },
  ])("explicitly blocks false absence when a legacy approved leave is ambiguous: %j", (leave) => {
    const result = monthlyAttendanceStatuses({ ...base(), approvedLeaves: [leave] });
    expect(result).toEqual({ dayStatuses: [], absenceAssessmentBlocked: true });
  });
  it("can still display known dated leave while ambiguous legacy leave blocks absence", () => {
    const result = monthlyAttendanceStatuses({
      ...base(), approvedLeaves: [{ start: null, end: null }, { start: "2026-10-03", end: "2026-10-03" }],
    });
    expect(result).toEqual({ dayStatuses: [{ day: "2026-10-03", status: "leave" }], absenceAssessmentBlocked: true });
  });
  it("keeps an overnight shift pending until its next-morning grace window ends", () => {
    const input = base();
    input.assignments[0].shift = { ...shift, startTime: "19:00", endTime: "07:00" };
    input.now = new Date("2026-10-03T04:00:00Z");
    expect(dates(input)).toEqual(["2026-10-01"]);
    input.now = new Date("2026-10-03T04:16:00Z");
    expect(dates(input)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("handles leap years, month length and December rollover without overflow rows", () => {
    expect(dates({ ...base(), month: "2028-02", serviceStartDate: null, now: new Date("2028-03-01T12:00:00Z") })).toHaveLength(29);
    expect(dates({ ...base(), month: "2026-12", serviceStartDate: null, now: new Date("2027-01-01T12:00:00Z") })).toHaveLength(31);
  });
  it("does not duplicate days when assignments overlap or change", () => {
    const input = base();
    input.assignments.push({ ...input.assignments[0], shift: { ...shift, id: "other" } });
    expect(dates(input)).toHaveLength(5);
  });
  it("does not call invalid shift times absences", () => {
    const input = base();
    input.assignments[0].shift = { ...shift, startTime: "25:00" };
    expect(monthlyAttendanceStatuses(input)).toEqual({ dayStatuses: [], absenceAssessmentBlocked: true });
  });
  it("uses the Riyadh calendar and does not mutate its inputs", () => {
    expect(riyadhCalendarDay(new Date("2026-09-30T21:00:00Z"))).toBe("2026-10-01");
    const input = base(), before = JSON.stringify(input);
    monthlyAttendanceStatuses(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("leave request and review validation", () => {
  const leave = { type: "leave", title: "Leave", details: "Annual leave", leave_start_date: "2026-10-04", leave_end_date: "2026-10-06" };
  it("requires an explicit inclusive date range for new leave requests", () => {
    expect(requestInput.safeParse(leave).success).toBe(true);
    expect(requestInput.safeParse({ type: "leave", title: "Leave", details: "Dates in free text" }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-13-01", "2026-10-04T00:00:00Z", "0000-01-01", "04/10/2026"])("rejects invalid dates: %s", (date) => {
    expect(requestInput.safeParse({ ...leave, leave_start_date: date }).success).toBe(false);
  });
  it("accepts same-day and leap-day leave and rejects reversed ranges", () => {
    expect(requestInput.safeParse({ ...leave, leave_start_date: "2028-02-29", leave_end_date: "2028-02-29" }).success).toBe(true);
    expect(requestInput.safeParse({ ...leave, leave_start_date: "2026-10-07" }).success).toBe(false);
  });
  it("does not impose dates on permission/other requests or allow leave dates on them", () => {
    expect(requestInput.safeParse({ type: "permission", title: "Permission", details: "Details" }).success).toBe(true);
    expect(requestInput.safeParse({ ...leave, type: "permission" }).success).toBe(false);
  });
  it("rejects ownership, approval and unsupported fields from employee requests", () => {
    for (const extra of [{ user_id: 99 }, { status: "approved" }, { responded_at: "2026-10-01" }]) {
      expect(requestInput.safeParse({ ...leave, ...extra }).success).toBe(false);
    }
  });
  it("permits a dates-only admin correction without a status/response mutation", () => {
    expect(reviewInput.parse({ leave_start_date: "2026-10-01", leave_end_date: "2026-10-02" }))
      .toEqual({ leave_start_date: "2026-10-01", leave_end_date: "2026-10-02" });
  });
  it.each([
    {}, { response: "Changed" }, { leave_start_date: "2026-10-01" },
    { leave_start_date: "2026-10-01", leave_end_date: "2026-10-02", response: "Changed" },
    { leave_start_date: "2026-10-03", leave_end_date: "2026-10-02" },
  ])("rejects incomplete or ambiguous review updates: %j", (input) => {
    expect(reviewInput.safeParse(input).success).toBe(false);
  });
  it("keeps existing approve/reject inputs valid for route-level validation", () => {
    expect(reviewInput.safeParse({ status: "approved", response: "OK" }).success).toBe(true);
    expect(reviewInput.safeParse({ status: "rejected" }).success).toBe(true);
  });
});
