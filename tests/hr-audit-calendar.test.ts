import { expect, test } from "@jest/globals";
import { buildAuditCalendar, isDatedAuditLeave } from "../client/src/lib/hr-audit-calendar";
import { groupAttendanceEvents, type AttendanceAuditEvent } from "../client/src/lib/hr-audit-grouping";

const employees = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
const punch = (id: number, day: string, action: AttendanceAuditEvent["action"], session = 10): AttendanceAuditEvent => ({
  id, user_id: 1, session_id: session, shift_date: day, action, occurred_at: `${day}T08:00:00+03:00`,
});
test("every employee gets all month days descending even with no attendance at all", () => {
  const rows = buildAuditCalendar("2026-10", employees, [], []);
  expect(rows).toHaveLength(62);
  for (const employee of employees) {
    const own = rows.filter((row) => row.user_id === employee.id);
    expect(own.map((row) => row.shift_date)).toEqual(Array.from({ length: 31 }, (_, i) => `2026-10-${String(31 - i).padStart(2, "0")}`));
    expect(own.every((row) => row.group === null && !row.approvedLeave)).toBe(true);
  }
  expect(new Set(rows.map((row) => row.key)).size).toBe(62);
});
test("uses actual month length including leap years and year boundaries", () => {
  expect(buildAuditCalendar("2024-02", [employees[0]], [], [])).toHaveLength(29);
  expect(buildAuditCalendar("2026-02", [employees[0]], [], [])).toHaveLength(28);
  expect(buildAuditCalendar("2026-04", [employees[0]], [], [])).toHaveLength(30);
  expect(buildAuditCalendar("2026-12", [employees[0]], [], []).at(-1)?.shift_date).toBe("2026-12-01");
  expect(buildAuditCalendar("2026-13", employees, [], [])).toEqual([]);
});
test("dated approved leave marks only its owner and actual dates, including month boundaries", () => {
  const rows = buildAuditCalendar("2026-10", employees, [], [
    { user_id: 1, start: "2026-09-29", end: "2026-10-02" },
    { user_id: 1, start: "2026-10-31", end: "2026-11-05" },
  ]);
  expect(rows.filter((row) => row.approvedLeave).map((row) => row.shift_date)).toEqual(["2026-10-31", "2026-10-02", "2026-10-01"]);
  expect(rows.filter((row) => row.user_id === 2).every((row) => !row.approvedLeave)).toBe(true);
  // No implied Friday/Saturday, future-day absence, or payroll estimates.
  expect(rows.find((row) => row.user_id === 1 && row.shift_date === "2026-10-09")?.approvedLeave).toBe(false);
});
test("never invents dates for incomplete, invalid or reversed legacy leave", () => {
  const leaves = [
    { user_id: 1, start: null, end: null },
    { user_id: 1, start: "2026-10-01", end: null },
    { user_id: 1, start: "2026-10-12", end: "2026-10-01" },
    { user_id: 1, start: "2026-02-30", end: "2026-10-01" },
  ];
  expect(leaves.every((leave) => !isDatedAuditLeave(leave))).toBe(true);
  expect(buildAuditCalendar("2026-10", employees, [], leaves).some((row) => row.approvedLeave)).toBe(false);
});
test("real shifts and all their punches remain intact, even on approved leave", () => {
  const groups = groupAttendanceEvents([punch(1, "2026-10-05", "check_in"), punch(2, "2026-10-05", "check_out")]);
  const rows = buildAuditCalendar("2026-10", employees, groups, [{ user_id: 1, start: "2026-10-05", end: "2026-10-05" }]);
  const real = rows.filter((row) => row.user_id === 1 && row.shift_date === "2026-10-05");
  expect(real).toHaveLength(1);
  expect(real[0].group).toBe(groups[0]);
  expect(real[0].approvedLeave).toBe(true);
  expect(groups[0].events).toHaveLength(2);
});
test("multiple shifts remain separate, overnight stamps stay on the accounting day", () => {
  const overnight = punch(2, "2026-10-31", "check_out");
  overnight.occurred_at = "2026-11-01T05:00:00+03:00";
  const groups = groupAttendanceEvents([punch(1, "2026-10-31", "check_in"), overnight, punch(3, "2026-10-31", "check_in", 11)]);
  const rows = buildAuditCalendar("2026-10", [employees[0]], groups, []);
  expect(rows).toHaveLength(32);
  expect(rows.slice(0, 2).every((row) => row.shift_date === "2026-10-31" && row.group !== null)).toBe(true);
  expect(rows.flatMap((row) => row.group?.events ?? [])).toContainEqual(overnight);
});
test("preserves historical employees with real events and handles no matching employees", () => {
  const groups = groupAttendanceEvents([punch(1, "2026-10-05", "check_in")]);
  expect(buildAuditCalendar("2026-10", [], groups, [])).toHaveLength(31);
  expect(buildAuditCalendar("2026-10", [], [], [])).toEqual([]);
});
