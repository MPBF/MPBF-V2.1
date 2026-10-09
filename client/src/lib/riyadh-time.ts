const RIYADH_TIME_ZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET = "+03:00";

export function riyadhDateTimeInput(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).map(({ type, value: part }) => [type, part]));

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function riyadhDateTimeToIso(value: string) {
  return new Date(`${value}:00${RIYADH_UTC_OFFSET}`).toISOString();
}