/** A delivery period is measured in calendar days from the order's Riyadh date. */
export function orderDateInRiyadh(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new Error("تاريخ إنشاء الطلب غير صالح");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function deliveryDateFromDays(orderDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || !Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("تاريخ الطلب أو عدد أيام التسليم غير صالح");
  }
  const origin = new Date(`${orderDate}T00:00:00Z`);
  if (Number.isNaN(origin.getTime()) || origin.toISOString().slice(0, 10) !== orderDate) {
    throw new Error("تاريخ الطلب غير صالح");
  }
  origin.setUTCDate(origin.getUTCDate() + days);
  return origin.toISOString().slice(0, 10);
}