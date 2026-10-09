type Row = Record<string, any>;
import i18n, { intlLocale, localizedName, translate } from "../i18n";

export function productionQuantityPayload(value: string): { quantity_kg: string } {
  const quantity = value.trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".");
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(quantity) || Number(quantity) <= 0) {
    throw new Error(translate("الكمية يجب أن تكون رقمًا موجبًا بالكيلو وحتى منزلتين عشريتين"));
  }
  return { quantity_kg: quantity };
}

export function productionQuantityLocked(row: Row): boolean {
  return row.status !== "pending" ||
    (row.previous_status != null && row.previous_status !== "pending") ||
    (typeof row.batch_number === "string" && row.batch_number.trim().length > 0);
}

const statuses: Record<string, string> = {
  pending: "قيد الانتظار", active: "قيد الإنتاج", completed: "مكتمل",
  cancelled: "ملغي", archived: "مؤرشف",
};
const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
const kg = (value: unknown) => value == null || value === "" ? "—" :
  Number.isFinite(Number(value)) ? `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 }).format(Number(value))} ${translate("كجم")}` : text(value);

export function productionOrderDetails(row: Row): { label: string; value: string }[] {
  const created = row.created_at ? new Date(row.created_at) : null;
  return [
    { label: "رقم أمر الإنتاج", value: text(row.production_order_number) },
    { label: "رقم الطلب", value: text(row.order_number ?? row.order_id) },
    { label: "العميل", value: localizedName(row.customer_name_ar, row.customer_name) },
    { label: "المنتج", value: text(row.product_size_caption || row.customer_product_id) },
    { label: "معرّف المنتج", value: text(row.customer_product_id) },
    { label: "الكمية المطلوبة", value: kg(row.quantity_kg) },
    { label: "الكمية النهائية", value: kg(row.final_quantity_kg) },
    { label: "نسبة الهالك", value: row.overrun_percentage == null ? "—" : `${text(row.overrun_percentage)}%` },
    { label: "الحالة", value: translate(statuses[row.status] || text(row.status)) },
    { label: "رقم التشغيلة", value: text(row.batch_number) },
    { label: "تاريخ الإنشاء", value: created && Number.isFinite(created.getTime()) ?
      new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(created) : text(row.created_at) },
  ];
}