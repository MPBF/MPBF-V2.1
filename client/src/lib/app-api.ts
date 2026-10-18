import i18n, { translate, translateError } from "../i18n";
import { fetchAllPages, LIST_PAGE_SIZE } from "./listing";
import type { OrderDisplayFilter } from "./order-workspace";
import { latinDigits } from "./number-input";

export type Row = Record<string, any>;

export { latinDigits } from "./number-input";

export const normalizePayload = (value: any): any => {
  if (typeof value === "string") return latinDigits(value);
  if (Array.isArray(value)) return value.map(normalizePayload);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePayload(item)]));
  return value;
};

export const api = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallbackByStatus: Record<number, string> = {
      400: "البيانات المدخلة غير صالحة",
      401: "انتهت الجلسة أو يلزم تسجيل الدخول",
      403: "لا تملك صلاحية تنفيذ هذا الإجراء",
      404: "العنصر المطلوب غير موجود",
      409: "تعذر تنفيذ الإجراء بسبب تعارض في البيانات",
      422: "تعذر التحقق من صحة البيانات",
      429: "عدد المحاولات كبير. حاول مرة أخرى لاحقاً",
      500: "حدث خطأ داخلي في الخادم",
    };
    throw new Error(translateError((i18n.language === "en" ? body.message_en : body.message) || body.message || fallbackByStatus[response.status] || "تعذر تنفيذ الطلب"));
  }
  return normalizePayload(body);
};

export const listPage = (path: string, search = "", offset = 0, limit = LIST_PAGE_SIZE, displayFolder?: Exclude<OrderDisplayFilter, "all">, categoryId?: string) => {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) query.set("search", search);
  if (displayFolder) query.set("display_folder", displayFolder);
  if (categoryId) query.set("category_id", categoryId);
  return api(`${path}?${query.toString()}`).then((value) => {
    if (!Array.isArray(value)) throw new Error(translate("تعذر تحميل قائمة البيانات"));
    return value as Row[];
  });
};

export const list = (path: string, search = "") => {
  // These lookup endpoints intentionally return the complete, small reference list.
  if (path === "/roles" || path === "/sections") {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    return api(`${path}${query}`).then((value) => {
      if (!Array.isArray(value)) throw new Error(translate("تعذر تحميل قائمة البيانات"));
      return value as Row[];
    });
  }
  return fetchAllPages<Row>((offset, limit) => listPage(path, search, offset, limit));
};

export const can = (user: Row, permissions: readonly string[]) => permissions.some((permission) => user.permissions?.includes("*") || user.permissions?.includes(permission));
