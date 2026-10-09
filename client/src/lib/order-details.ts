import type { OrderDetails, OrderPrintDetails } from "../../../shared/order-details";
import i18n, { intlLocale, translate, translateError } from "../i18n";

export class OrderDetailsError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OrderDetailsError";
    this.status = status;
  }
}

const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalString = (value: unknown) => value === null || typeof value === "string";

export function isValidPublicOrderPrintPath(id: string | number, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const orderId = String(id);
  if (!/^\d+$/.test(orderId) || !Number.isSafeInteger(Number(orderId)) || Number(orderId) <= 0) return false;
  return new RegExp(`^/shared/orders/${orderId}/print\\?key=[A-Za-z0-9_-]{43}$`).test(path);
}

export function publicOrderPrintUrl(id: string | number, path: string, origin = window.location.origin): string {
  if (!isValidPublicOrderPrintPath(id, path)) return "";
  return `${origin}${path}`;
}

export async function fetchOrderDetails(id: string | number, signal: AbortSignal): Promise<OrderDetails> {
  const response = await fetch(`/api/orders/${encodeURIComponent(String(id))}/details`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : response.status === 404 ? "لم يتم العثور على الطلب." : "تعذر تحميل تفاصيل الطلب.";
    throw new OrderDetailsError(translateError(message), response.status);
  }
  const nullableRecord = (value: unknown) => value === null || record(value);
  if (!record(body) || !record(body.order) || body.order.id !== Number(id) ||
    typeof body.order.order_number !== "string" ||
    !Array.isArray(body.production_orders) ||
    !body.production_orders.every((row: unknown) => record(row) &&
      Number.isSafeInteger(row.id) && typeof row.quantity_kg === "string" &&
      typeof row.final_quantity_kg === "string" && nullableRecord(row.product)) ||
    !record(body.totals) || typeof body.totals.requested_kg !== "string" ||
    typeof body.totals.planned_kg !== "string" ||
    !record(body.actual_production) || body.actual_production.available !== false ||
    !nullableRecord(body.customer) || !nullableRecord(body.creator) || !nullableRecord(body.sales_representative)) {
    throw new OrderDetailsError(translate("استجابة تفاصيل الطلب غير مكتملة."), 500);
  }
  return body as unknown as OrderDetails;
}

export async function fetchOrderPrintLink(id: string | number, signal: AbortSignal): Promise<string> {
  const response = await fetch(`/api/orders/${encodeURIComponent(String(id))}/print-link`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = record(body) && typeof body.message === "string"
      ? body.message
      : "تعذر تحميل رابط الطباعة العامة.";
    throw new OrderDetailsError(translateError(message), response.status);
  }
  if (!record(body) || !isValidPublicOrderPrintPath(id, body.path)) {
    throw new OrderDetailsError(translate("رابط الطباعة العامة غير صالح."), 500);
  }
  return body.path;
}

export async function fetchOrderPrintDetails(id: string | number, signal: AbortSignal): Promise<OrderPrintDetails> {
  const [details, publicPrintPath] = await Promise.all([
    fetchOrderDetails(id, signal),
    fetchOrderPrintLink(id, signal),
  ]);
  return { ...details, public_print_path: publicPrintPath };
}

function isPublicPrintProduct(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value)) return false;
  const textFields = [
    "size_caption", "width", "left_facing", "right_facing", "universal_thickness",
    "raw_material", "printing_cylinder", "punching", "notes",
    "cliche_front_design", "cliche_back_design",
  ];
  if (!textFields.every((key) => optionalString(value[key])) ||
    !(value.cutting_length_cm === null || typeof value.cutting_length_cm === "number") ||
    !(value.is_printed === null || typeof value.is_printed === "boolean") ||
    ![value.front_print_colors, value.back_print_colors].every((colors) =>
      colors === null || (Array.isArray(colors) && colors.every((color) => typeof color === "string")))) return false;
  if (value.item !== null && (!record(value.item) ||
    !optionalString(value.item.name) || !optionalString(value.item.name_ar))) return false;
  if (value.color !== null && (!record(value.color) ||
    !(Number.isSafeInteger(value.color.id) || (typeof value.color.id === "string" && value.color.id.length > 0)) || !optionalString(value.color.name) ||
    !optionalString(value.color.name_ar) || !optionalString(value.color.color_hex))) return false;
  return true;
}

function isPublicPrintPerson(value: unknown): boolean {
  return value === null || (record(value) &&
    ["display_name", "display_name_ar", "full_name", "username"].every((key) => optionalString(value[key])));
}

export async function fetchPublicOrderPrintDetails(
  id: string | number,
  key: string,
  signal: AbortSignal,
): Promise<OrderPrintDetails> {
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 ||
    !key || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new OrderDetailsError(translate("رابط الطباعة غير صالح أو غير متاح."), 404);
  }
  const response = await fetch(`/api/public/orders/${encodeURIComponent(String(id))}/print?key=${encodeURIComponent(key)}`, {
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const localizedMessage = record(body) ? (i18n.language === "en" ? body.message_en : body.message) : undefined;
    const message = typeof localizedMessage === "string"
      ? localizedMessage
      : response.status === 404 ? "رابط الطباعة غير صالح أو غير متاح." : "تعذر تحميل نسخة الطباعة العامة.";
    throw new OrderDetailsError(translateError(message), response.status);
  }
  const order = record(body) ? body.order : null;
  const validOrder = record(order) && order.id === Number(id) &&
    typeof order.order_number === "string" && optionalString(order.status) &&
    typeof order.created_at === "string" && optionalString(order.notes) &&
    optionalString(order.delivery_date) &&
    (order.delivery_days === null || typeof order.delivery_days === "number" || typeof order.delivery_days === "string");
  const validCustomer = record(body) && (body.customer === null || (record(body.customer) &&
    ["name", "name_ar", "phone", "plate_drawer_code"].every((key) => optionalString(body.customer[key]))));
  const validRows = record(body) && Array.isArray(body.production_orders) &&
    body.production_orders.every((row: unknown) => record(row) && Number.isSafeInteger(row.id) &&
      typeof row.quantity_kg === "string" && typeof row.final_quantity_kg === "string" &&
      isPublicPrintProduct(row.product));
  const validTotals = record(body) && record(body.totals) && typeof body.totals.planned_kg === "string";
  const validActuals = record(body) && record(body.actual_production) &&
    body.actual_production.available === false && typeof body.actual_production.message === "string";
  const validPeople = record(body) && isPublicPrintPerson(body.creator) && isPublicPrintPerson(body.sales_representative);
  if (!record(body) || !validOrder || !validCustomer || !validRows || !validTotals || !validActuals || !validPeople ||
    !isValidPublicOrderPrintPath(id, body.public_print_path)) {
    throw new OrderDetailsError(translate("استجابة نسخة الطباعة العامة غير صالحة."), 500);
  }
  return body as unknown as OrderPrintDetails;
}

export const orderStatusLabel = (status: unknown): string => {
  const labels: Record<string, string> = {
    waiting: "بانتظار التنفيذ",
    on_hold: "معلق",
    in_production: "قيد الإنتاج",
    for_production: "جاهز للإنتاج",
    paused: "متوقف",
    cancelled: "ملغي",
    completed: "مكتمل",
    delivered: "تم التسليم",
    archived: "مؤرشف",
    pending: "قيد الانتظار",
    active: "نشط",
  };
  return typeof status === "string" && status ? translate(labels[status] ?? status.replaceAll("_", " ")) : "—";
};

export const productionStatusLabel = (status: unknown): string =>
  status === "active" ? translate("قيد الإنتاج") : orderStatusLabel(status);

export const displayValue = (value: unknown): string => {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? translate("نعم") : translate("لا");
  if (Array.isArray(value)) return value.length ? value.map((part) => String(part ?? "—")).join(intlLocale() === "ar-SA-u-nu-latn" ? "، " : ", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const fieldLabel = (key: string): string =>
  key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const personName = (person: { display_name?: string | null; display_name_ar?: string | null; full_name?: string | null; username?: string | null } | null): string =>
  person?.display_name_ar || person?.display_name || person?.full_name || person?.username || "—";

export const formatOrderDate = (value: unknown): string => {
  if (value == null || value === "") return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions = i18n.language === "ar"
    ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Riyadh" }
    : { dateStyle: "short", timeZone: "Asia/Riyadh" };
  return new Intl.DateTimeFormat(intlLocale(), options).format(date).replace(/[\u061c\u200e\u200f]/g, "");
};

export const numberText = (value: unknown): string => {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 4 }).format(numeric) : "—";
};