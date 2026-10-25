export type CorrectionAction = "check_in" | "break_start" | "break_end" | "check_out";

export type CorrectionTimeEntry = {
  id?: number;
  action: CorrectionAction;
  time: string;
};

export type OriginalCorrectionEvent = {
  id: number;
  action: CorrectionAction;
  occurred_at: string;
};

const timeZone = "Asia/Riyadh";
const orderedActions: CorrectionAction[] = ["check_in", "break_start", "break_end", "check_out"];

function localParts(value: string | Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Resolve minute-only Riyadh times into chronological ISO timestamps.
 * The original check-in date anchors the sequence; missing check-ins use
 * the accounting date. Events after midnight roll into the following date.
 */
export function resolveCorrectionTimes(
  entries: CorrectionTimeEntry[],
  accountingDate: string,
  originals: OriginalCorrectionEvent[],
) {
  const checkInOriginal = originals.find((entry) => entry.action === "check_in");
  const baseDate = checkInOriginal ? localParts(checkInOriginal.occurred_at).date : accountingDate;
  const byAction = new Map(entries.map((entry) => [entry.action, entry]));
  const originalById = new Map(originals.map((entry) => [entry.id, entry]));
  const result: Partial<Record<CorrectionAction, string>> = {};
  let currentDate = baseDate;
  let previousMinute: number | null = null;

  for (const action of orderedActions) {
    const entry = byAction.get(action);
    if (!entry?.time) continue;
    const [hour, minute] = entry.time.split(":").map(Number);
    const minuteOfDay = hour * 60 + minute;
    if (previousMinute !== null && minuteOfDay < previousMinute) currentDate = shiftDate(currentDate, 1);

    const original = entry.id ? originalById.get(entry.id) : undefined;
    const originalLocal = original ? localParts(original.occurred_at) : undefined;
    if (original && originalLocal?.date === currentDate && originalLocal.time === entry.time) {
      result[action] = original.occurred_at;
    } else {
      result[action] = new Date(`${currentDate}T${entry.time}:00+03:00`).toISOString();
    }
    previousMinute = minuteOfDay;
  }
  return result;
}
