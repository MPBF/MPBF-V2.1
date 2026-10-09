import { describe, expect, test } from "@jest/globals";

import {
  distanceMeters,
  currentShiftWindow,
  currentShiftOccurrence,
  parseWorkShifts,
  resolveActiveShift,
  toActiveShift,
  validGeofence,
} from "../server/shift-geofence";

const shift = (overrides: Record<string, unknown> = {}) => ({
  id: "morning",
  name_ar: "الوردية الصباحية",
  name_en: "Morning",
  start_time: "08:00",
  end_time: "16:00",
  early_checkin_minutes: 15,
  late_checkout_minutes: 15,
  geofence_enabled: true,
  geofence_center_lat: 24.7136,
  geofence_center_lng: 46.6753,
  geofence_radius_meters: 200,
  ...overrides,
});

describe("shift geofence context", () => {
  test("uses inclusive attendance windows and preserves stored overlap priority", () => {
    const shifts = parseWorkShifts(JSON.stringify([
      shift({ id: "first", name_ar: "الأولى" }),
      shift({ id: "second", name_ar: "الثانية" }),
    ]));

    expect(resolveActiveShift(shifts, 7 * 60 + 45)?.id).toBe("first");
    expect(resolveActiveShift(shifts, 16 * 60 + 15)?.id).toBe("first");
    expect(resolveActiveShift(shifts, 7 * 60 + 44)).toBeNull();
    expect(resolveActiveShift(shifts, 16 * 60 + 16)).toBeNull();
  });

  test("resolves overnight shifts on both sides of midnight", () => {
    const shifts = parseWorkShifts([shift({ start_time: "22:00", end_time: "06:00" })]);

    expect(resolveActiveShift(shifts, 23 * 60)?.id).toBe("morning");
    expect(resolveActiveShift(shifts, 5 * 60 + 59)?.id).toBe("morning");
    expect(resolveActiveShift(shifts, 12 * 60)).toBeNull();
  });

  test("returns a safe enabled context without center coordinates", () => {
    const parsed = parseWorkShifts([shift()]);
    const context = toActiveShift(parsed[0]);

    expect(context).toEqual({
      id: "morning",
      name: "الوردية الصباحية",
      startTime: "08:00",
      endTime: "16:00",
      geofenceStatus: "enabled",
      radiusMeters: 200,
    });
    expect(context).not.toHaveProperty("geofenceCenterLat");
    expect(context).not.toHaveProperty("geofenceCenterLng");
  });

  test("distinguishes disabled and invalid geofence settings", () => {
    const [disabled] = parseWorkShifts([shift({ geofence_enabled: false })]);
    const [missingCenter] = parseWorkShifts([shift({ geofence_center_lat: null, geofence_center_lng: "" })]);
    const [badRadius] = parseWorkShifts([shift({ geofence_radius_meters: 10 })]);

    expect(toActiveShift(disabled)?.geofenceStatus).toBe("disabled");
    expect(toActiveShift(disabled)?.radiusMeters).toBeNull();
    expect(toActiveShift(missingCenter)?.geofenceStatus).toBe("invalid");
    expect(toActiveShift(badRadius)?.geofenceStatus).toBe("invalid");
    expect(validGeofence(missingCenter)).toBeNull();
    expect(validGeofence(badRadius)).toBeNull();
  });

  test("ignores malformed settings and shifts with invalid times", () => {
    expect(parseWorkShifts("not-json")).toEqual([]);
    expect(resolveActiveShift(parseWorkShifts([shift({ start_time: "25:00" })]), 9 * 60)).toBeNull();
    expect(toActiveShift(null)).toBeNull();
  });

  test("calculates distance in meters for enforcement", () => {
    expect(distanceMeters(24.7136, 46.6753, 24.7136, 46.6753)).toBe(0);
    expect(distanceMeters(24.7136, 46.6753, 24.7226, 46.6753)).toBeGreaterThan(990);
  });

  test("scopes attendance state to the current shift occurrence", () => {
    const morning = parseWorkShifts([shift({ start_time: "08:00", end_time: "16:00", early_checkin_minutes: 15, late_checkout_minutes: 15 })])[0];
    const current = currentShiftWindow(morning, new Date("2026-09-25T09:00:00+03:00"));
    expect(current?.start.toISOString()).toBe("2026-09-25T04:45:00.000Z");
    expect(current?.end.toISOString()).toBe("2026-09-25T13:15:00.000Z");
    expect(currentShiftWindow(morning, new Date("2026-09-25T18:00:00+03:00"))).toBeNull();
  });

  test("finds the same overnight shift before and after midnight", () => {
    const night = parseWorkShifts([shift({ start_time: "19:00", end_time: "03:00", early_checkin_minutes: 60, late_checkout_minutes: 60 })])[0];
    expect(currentShiftWindow(night, new Date("2026-09-25T20:00:00+03:00"))).not.toBeNull();
    expect(currentShiftWindow(night, new Date("2026-09-26T02:00:00+03:00"))).not.toBeNull();
    expect(currentShiftWindow(night, new Date("2026-09-26T08:00:00+03:00"))).toBeNull();
  });

  test("anchors an overnight occurrence and its shift date to the Riyadh start day", () => {
    const night = parseWorkShifts([shift({
      start_time: "19:00",
      end_time: "03:00",
      early_checkin_minutes: 60,
      late_checkout_minutes: 60,
    })])[0];
    const occurrence = currentShiftOccurrence(night, new Date("2026-09-26T02:00:00+03:00"));

    expect(occurrence).toEqual({
      start: new Date("2026-09-25T15:00:00.000Z"),
      end: new Date("2026-09-26T01:00:00.000Z"),
      shiftStartAt: new Date("2026-09-25T16:00:00.000Z"),
      shiftEndAt: new Date("2026-09-26T00:00:00.000Z"),
      shiftDate: "2026-09-25",
      expectedMinutes: 8 * 60,
    });
  });

  test("accepts a midnight shift's early check-in on the preceding calendar day", () => {
    const shiftDefinition = parseWorkShifts([shift({
      start_time: "00:30",
      end_time: "08:30",
      early_checkin_minutes: 60,
    })])[0];
    const occurrence = currentShiftOccurrence(shiftDefinition, new Date("2026-02-01T23:45:00+03:00"));
    expect(occurrence?.shiftDate).toBe("2026-02-02");
    expect(occurrence?.shiftStartAt.toISOString()).toBe("2026-02-01T21:30:00.000Z");
  });
});
