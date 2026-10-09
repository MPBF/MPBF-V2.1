export type ShiftDefinition = {
  id: string;
  nameAr?: string;
  nameEn?: string;
  startTime: string;
  endTime: string;
  nextDayCheckinTime?: string;
  earlyCheckinMinutes: number;
  lateCheckoutMinutes: number;
  breakMinutes?: number;
  geofenceEnabled: boolean;
  geofenceCenterLat?: number;
  geofenceCenterLng?: number;
  geofenceRadiusMeters?: number;
};

export type ActiveShift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  geofenceStatus: "enabled" | "disabled" | "invalid";
  radiusMeters: number | null;
};

export type ShiftWindow = { start: Date; end: Date };
export type ShiftOccurrence = ShiftWindow & {
  shiftStartAt: Date;
  shiftEndAt: Date;
  shiftDate: string;
  expectedMinutes: number;
};

type ValidGeofence = {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toBoolean(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function nonNegativeMinutes(value: unknown): number {
  const number = optionalNumber(value);
  return number === undefined ? 0 : Math.max(0, number);
}

export function parseTimeMinutes(value: string): number | null {
  const match = String(value || "").trim().match(TIME_PATTERN);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function riyadhNowMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function currentShiftWindow(shift: ShiftDefinition, now = new Date()): ShiftWindow | null {
  const occurrence = currentShiftOccurrence(shift, now);
  return occurrence ? { start: occurrence.start, end: occurrence.end } : null;
}

export function currentShiftOccurrence(shift: ShiftDefinition, now = new Date()): ShiftOccurrence | null {
  const startMinutes = parseTimeMinutes(shift.startTime);
  const endMinutes = parseTimeMinutes(shift.endTime);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null;
  const riyadhOffset = 3 * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + riyadhOffset);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();
  const overnight = endMinutes <= startMinutes;
  for (const dayOffset of [0, -1, 1]) {
    const localMidnightUtc = Date.UTC(year, month, day + dayOffset);
    const shiftStartAt = new Date(localMidnightUtc + startMinutes * 60_000 - riyadhOffset);
    const shiftEndAt = new Date(localMidnightUtc + (endMinutes + (overnight ? 1440 : 0)) * 60_000 - riyadhOffset);
    const start = new Date(shiftStartAt.getTime() - shift.earlyCheckinMinutes * 60_000);
    const end = new Date(shiftEndAt.getTime() + shift.lateCheckoutMinutes * 60_000);
    if (now >= start && now <= end) {
      const localDate = new Date(localMidnightUtc);
      const shiftDate = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}`;
      return {
        start,
        end,
        shiftStartAt,
        shiftEndAt,
        shiftDate,
        expectedMinutes: Math.max(0, Math.round((shiftEndAt.getTime() - shiftStartAt.getTime()) / 60_000) - (shift.breakMinutes ?? 0)),
      };
    }
  }
  return null;
}

export function parseWorkShifts(raw: unknown): ShiftDefinition[] {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      id: String(item?.id ?? ""),
      nameAr: typeof item?.name_ar === "string" ? item.name_ar.trim() || undefined : undefined,
      nameEn: typeof item?.name_en === "string" ? item.name_en.trim() || undefined : undefined,
      startTime: String(item?.start_time ?? "").trim(),
      endTime: String(item?.end_time ?? "").trim(),
      earlyCheckinMinutes: nonNegativeMinutes(item?.early_checkin_minutes),
      lateCheckoutMinutes: nonNegativeMinutes(item?.late_checkout_minutes),
      geofenceEnabled: toBoolean(item?.geofence_enabled),
      geofenceCenterLat: optionalNumber(item?.geofence_center_lat),
      geofenceCenterLng: optionalNumber(item?.geofence_center_lng),
      geofenceRadiusMeters: optionalNumber(item?.geofence_radius_meters),
    }));
  } catch {
    return [];
  }
}

function isMinutesInWindow(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes <= endMinutes) return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

export function resolveActiveShift(shifts: ShiftDefinition[], nowMinutes: number): ShiftDefinition | null {
  for (const shift of shifts) {
    const start = parseTimeMinutes(shift.startTime);
    const end = parseTimeMinutes(shift.endTime);
    if (start === null || end === null) continue;
    const windowStart = (start - shift.earlyCheckinMinutes + 1440) % 1440;
    const windowEnd = (end + shift.lateCheckoutMinutes) % 1440;
    if (isMinutesInWindow(nowMinutes, windowStart, windowEnd)) return shift;
  }
  return null;
}

export function validGeofence(shift: ShiftDefinition): ValidGeofence | null {
  const { geofenceCenterLat: lat, geofenceCenterLng: lng, geofenceRadiusMeters: radius } = shift;
  if (lat === undefined || lat < -90 || lat > 90) return null;
  if (lng === undefined || lng < -180 || lng > 180) return null;
  if (radius === undefined || radius < 20 || radius > 5000) return null;
  return { centerLat: lat, centerLng: lng, radiusMeters: radius };
}

export function toActiveShift(shift: ShiftDefinition | null): ActiveShift | null {
  if (!shift) return null;
  const geofence = shift.geofenceEnabled ? validGeofence(shift) : null;
  return {
    id: shift.id,
    name: shift.nameAr || shift.nameEn || "الوردية الحالية",
    startTime: shift.startTime,
    endTime: shift.endTime,
    geofenceStatus: !shift.geofenceEnabled ? "disabled" : geofence ? "enabled" : "invalid",
    radiusMeters: geofence ? Math.round(geofence.radiusMeters) : null,
  };
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const latitudeDifference = toRadians(lat2 - lat1);
  const longitudeDifference = toRadians(lng2 - lng1);
  const a =
    Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(longitudeDifference / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
