import { afterEach, describe, expect, test } from "@jest/globals";

import { riyadhDateTimeInput, riyadhDateTimeToIso } from "../client/src/lib/riyadh-time";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("Riyadh attendance date-time conversion", () => {
  test.each([
    ["2026-01-01T00:30:00.000Z", "2026-01-01T03:30"],
    ["2026-01-01T21:05:00.000Z", "2026-01-02T00:05"],
    ["2026-10-25T20:59:00.000Z", "2026-10-25T23:59"],
  ])("round-trips %s through a Riyadh-local input value", (iso, localInput) => {
    for (const browserTimeZone of ["America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo"]) {
      process.env.TZ = browserTimeZone;
      expect(riyadhDateTimeInput(new Date(iso))).toBe(localInput);
      expect(riyadhDateTimeToIso(localInput)).toBe(iso);
    }
  });

  test("uses the Riyadh zone for current-time defaults regardless of browser zone", () => {
    const instant = new Date("2026-06-15T21:45:00.000Z");
    process.env.TZ = "America/Los_Angeles";
    const firstBrowserValue = riyadhDateTimeInput(instant);
    process.env.TZ = "Pacific/Auckland";

    expect(firstBrowserValue).toBe("2026-06-16T00:45");
    expect(riyadhDateTimeInput(instant)).toBe(firstBrowserValue);
  });
});