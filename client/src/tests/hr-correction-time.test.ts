import { describe, expect, test } from "@jest/globals";
import { resolveCorrectionTimes, type CorrectionTimeEntry } from "../lib/hr-correction-time";

const entries = (times: string[]): CorrectionTimeEntry[] =>
  (["check_in", "break_start", "break_end", "check_out"] as const).map((action, index) => ({
    id: index + 1, action, time: times[index],
  }));

describe("time-only correction timestamps", () => {
  test("resolves four daytime dropdowns using Riyadh time", () => {
    expect(resolveCorrectionTimes(entries(["08:00", "12:00", "12:30", "17:00"]), "2026-10-16", [])).toEqual({
      check_in: "2026-10-16T05:00:00.000Z", break_start: "2026-10-16T09:00:00.000Z",
      break_end: "2026-10-16T09:30:00.000Z", check_out: "2026-10-16T14:00:00.000Z",
    });
  });
  test("rolls across month end without changing the accounting day", () => {
    const result = resolveCorrectionTimes(entries(["19:00", "23:45", "00:15", "03:00"]), "2026-10-31", []);
    expect(result.break_start).toBe("2026-10-31T20:45:00.000Z");
    expect(result.break_end).toBe("2026-10-31T21:15:00.000Z");
    expect(result.check_out).toBe("2026-11-01T00:00:00.000Z");
  });
  test("keeps unchanged seconds and milliseconds", () => {
    const original = [
      { id: 1, action: "check_in" as const, occurred_at: "2026-10-16T05:00:42.123Z" },
      { id: 4, action: "check_out" as const, occurred_at: "2026-10-16T14:00:53.987Z" },
    ];
    expect(resolveCorrectionTimes(entries(["08:00", "", "", "17:00"]), "2026-10-16", original)).toEqual({
      check_in: original[0].occurred_at, check_out: original[1].occurred_at,
    });
  });
  test("anchors to actual checkin date when different from accounting date", () => {
    const original = [{ id: 1, action: "check_in" as const, occurred_at: "2026-10-16T21:15:00.000Z" }];
    const result = resolveCorrectionTimes(entries(["00:15", "03:00", "03:30", "08:00"]), "2026-10-16", original);
    expect(result.check_in).toBe(original[0].occurred_at);
    expect(result.check_out).toBe("2026-10-17T05:00:00.000Z");
  });
  test("does not introduce a next-day rollover for equal minutes", () => {
    const result = resolveCorrectionTimes(entries(["08:00", "12:00", "12:00", "17:00"]), "2026-10-16", []);
    expect(result.break_start).toBe(result.break_end); // Server rejects equal timestamps.
  });
});
