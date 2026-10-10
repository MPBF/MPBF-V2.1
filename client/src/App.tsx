import { lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Boxes, Copy, Eye, Factory, FileText, Gauge, LogOut, Package, Pencil, Plus, Printer, Search, Shield, Trash2, Users, UsersRound, Wrench, X, Settings2, Cog, KeyRound, Building2, Check } from "lucide-react";
import { Link, Redirect, Route, Switch, useLocation, useRoute, useSearchParams } from "wouter";
import { availableOrderTabs, selectedOrderTab, type OrderPageTab } from "./lib/order-tabs";
import { productionPermissions } from "../../shared/production";
import { initialProductionPath } from "./lib/production-navigation";
import { initialWarehousePath } from "./lib/warehouse-navigation";
import ProductionRoleBindingFields from "./components/ProductionRoleBindingFields";
import { finishedGoodsPermissionGroup, finishedGoodsPermissionDescriptions } from "./lib/finished-goods-permissions";
import { defaultBranding, fetchBrandingSnapshot, type BrandingSnapshot } from "./lib/branding";
import PageHero from "./components/PageHero";
import DeferredContent from "./components/DeferredContent";
import FlagLanguageSelector from "./components/FlagLanguageSelector";
import type { WorkspaceOrder } from "./components/OrderWorkspaceControls";
import MasterBatchSwatch from "./components/MasterBatchSwatch";
import { createLatestRequestGate, fetchAllPages, LIST_PAGE_SIZE, runLatestRequest } from "./lib/listing";
import { sortCustomerProductsByCategory } from "./lib/customer-product-sort";
import type { OrderWorkspaceAction } from "../../shared/order-workspace";
import type { OrderDisplayFolder } from "./lib/order-workspace";
import { canonicalMachineType, eligibleInlinePrinterMachines, MACHINE_CAPACITY_TYPES, MACHINE_RAW_MATERIAL_TYPES, machineTypeMatches, newAdminFormDefaults, usesGeneratedAdminId } from "./lib/admin-form-review";
import i18n, { applyLanguage, localizedName, normalizeLanguage, translate, translateError } from "./i18n";

const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const HumanResources = lazy(() => import("./pages/HumanResources"));
const ProductionPage = lazy(() => import("./pages/production/ProductionPage"));
const RawMixingPage = lazy(() => import("./pages/production/RawMixingPage"));
const ProductionMonitoringPage = lazy(() => import("./pages/production/ProductionMonitoringPage"));
const RawInventoryPage = lazy(() => import("./pages/warehouse/RawInventoryPage"));
const WarehousePage = lazy(() => import("./pages/warehouse/WarehousePage"));
const OrderCreateModal = lazy(() => import("./components/OrderCreateModal"));
const CustomerProductModal = lazy(() => import("./components/CustomerProductModal"));
const CustomerModal = lazy(() => import("./components/CustomerModal"));
const ProductionOrderModal = lazy(() => import("./components/ProductionOrderModal"));
const OrderDetailsModal = lazy(() => import("./components/OrderDetailsModal"));
const OrderPrintPage = lazy(() => import("./components/OrderPrintPage"));
const OrderWorkspaceControls = lazy(() => import("./components/OrderWorkspaceControls"));
const OrderRowActionMenu = lazy(() => import("./components/OrderWorkspaceControls").then((module) => ({ default: module.OrderRowActionMenu })));
const OrderSelectionBox = lazy(() => import("./components/OrderWorkspaceControls").then((module) => ({ default: module.OrderSelectionBox })));
const RoleSwitcher = lazy(() => import("./components/RoleSwitcher"));

type Row = Record<string, any>;
type OrderProductionSummary = {
  id: number;
  production_order_number: string;
  item_name_ar: string | null;
  item_name: string | null;
  item_id: string | null;
  quantity_kg: string;
};
type Field = { key: string; label: string; type?: "integer" | "decimal" | "date" | "select" | "percentage" | "textarea" | "boolean"; options?: string[]; relation?: string; required?: boolean; wide?: boolean; onlyMachineType?: string };
type Column = { key: string; label: string; kind?: "text" | "number" | "date" | "status" | "relation" | "color" | "boolean" | "bilingual"; priority?: boolean; unit?: string; tightUnit?: boolean; fallbackKey?: string; secondaryKey?: string; secondaryRelation?: string; joinKey?: string; joinUnit?: string; colorKey?: string; compact?: "customer"; width?: "category" | "size" | "numeric" | "combined" | "material" | "color" | "order-customer"; centered?: boolean; truncateNumbers?: boolean; customerLink?: boolean };
type Config = { path: string; title: string; singular: string; read: string[]; write: string[]; del?: string[]; fields: Field[]; columns?: Column[]; mobileColumnLimit?: number; lockedFields?: string[]; clone?: boolean };

const api = async (path: string, options: RequestInit = {}) => {
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
const listPage = (path: string, search = "", offset = 0, limit = LIST_PAGE_SIZE, displayFolder?: OrderDisplayFolder, categoryId?: string) => {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) query.set("search", search);
  if (displayFolder) query.set("display_folder", displayFolder);
  if (categoryId) query.set("category_id", categoryId);
  return api(`${path}?${query.toString()}`).then((value) => {
    if (!Array.isArray(value)) throw new Error(translate("تعذر تحميل قائمة البيانات"));
    return value as Row[];
  });
};
const list = (path: string, search = "") => {
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
const can = (user: Row, permissions: readonly string[]) => permissions.some((permission) => user.permissions?.includes("*") || user.permissions?.includes(permission));

const orderStatuses = ["waiting", "on_hold", "in_production", "for_production", "paused", "cancelled", "completed", "delivered", "archived"];
const productionStatuses = ["pending", "active", "completed", "cancelled", "archived"];
const machineTypes = ["extruder", "printer", "cutter", "quality_check"];
const statusLabels: Record<string, string> = { active: "نشط", inactive: "غير نشط", waiting: "انتظار", on_hold: "معلّق", in_production: "قيد الإنتاج", for_production: "جاهز للإنتاج", paused: "متوقف", cancelled: "ملغي", completed: "مكتمل", delivered: "مسلّم", archived: "مؤرشف", pending: "قيد الانتظار", extruder: "فيلم", printer: "طباعة", printing: "طباعة", Printer: "طباعة", cutter: "قص", cutting: "قص", Cutter: "قص", quality_check: "فحص جودة", maintenance: "صيانة", down: "متوقفة" };
const dictionaries: Record<string, string> = new Proxy(statusLabels, {
  get(target, property) {
    if (typeof property !== "string") return undefined;
    const value = target[property];
    return value ? translate(value) : value;
  },
});
const relationLabel = (row: Row, key: string) => {
  const arabicName = row[`${key}_name_ar`];
  const englishName = row[`${key}_name`];
  return localizedName(arabicName, englishName, "") ||
    (key === "order" ? row.order_number : null) ||
    (key === "production_order" ? row.production_order_number : null) || row[`${key}_id`] ||
    (typeof row[key] === "string" ? localizedName(row[key], row[key], "") : row[key]) || null;
};
const latinDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/٫/g, ".")
  .replace(/٬/g, ",");
const normalizePayload = (value: any): any => {
  if (typeof value === "string") return latinDigits(value);
  if (Array.isArray(value)) return value.map(normalizePayload);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePayload(item)]));
  return value;
};
const fmtNumber = (value: any, digits = 2, unit = "", tightUnit = false) => {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(latinDigits(String(value)));
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat(i18n.language === "ar" ? "ar-SA-u-nu-latn" : "en-US", { minimumFractionDigits: 0, maximumFractionDigits: Math.min(digits, 2) }).format(number)}${unit ? `${tightUnit ? "" : " "}${translate(unit)}` : ""}`;
};
const decimalInputValue = (value: any, precision = 2) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(latinDigits(String(value)));
  const factor = 10 ** precision;
  return Number.isFinite(number) ? String(Math.round((number + Number.EPSILON) * factor) / factor) : latinDigits(String(value));
};
const formatLocale = () => i18n.language === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
const fmtDate = (value: any) => value ? new Intl.DateTimeFormat(formatLocale(), { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00+03:00`)) : "—";
const fmtOrderDate = (value: any) => value ? new Intl.DateTimeFormat(formatLocale(), { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(value)) : "—";
const displayValue = (row: Row, col: Column) => {
  if (col.key === "production_orders_summary") {
    const entries = row.production_orders_summary as OrderProductionSummary[] | undefined;
    return entries?.length ? entries.map((entry) => `${entry.production_order_number} - ${localizedName(entry.item_name_ar, entry.item_name, entry.item_id || "—")} - ${fmtNumber(entry.quantity_kg, 2, "كجم")}`).join(i18n.language === "ar" ? "؛ " : "; ") : translate("لا توجد أوامر إنتاج");
  }
  const raw = col.kind !== "bilingual" && i18n.language === "en" && col.key.endsWith("_ar") && col.label !== translate("الاسم العربي") && col.label !== translate("الاسم بالعربية")
    ? localizedName(row[col.key], row[col.key.replace(/_ar$/, "")], String(row[col.key.replace(/_name_ar$/, "_id")] || row.id || "—"))
    : row[col.key] ?? (col.fallbackKey ? row[col.fallbackKey] : undefined);
  const value = col.kind === "relation" ? relationLabel(row, col.key) : raw;
  if (col.joinKey) {
    const first = value === null || value === undefined || value === "" ? "" : latinDigits(String(value));
    const joinedRaw = row[col.joinKey];
    const second = joinedRaw === null || joinedRaw === undefined || joinedRaw === "" ? "" : `${latinDigits(String(joinedRaw))}${col.joinUnit ? ` ${translate(col.joinUnit)}` : ""}`;
    if (!first && !second) return "X";
    if (!first) return second;
    if (!second) return first;
    return `${first} / ${second}`;
  }
  if (col.kind === "number") return fmtNumber(value, 2, col.unit, col.tightUnit);
  if (col.kind === "date") return fmtDate(value);
  if (col.kind === "boolean") return value === true ? translate("نعم") : value === false ? translate("لا") : "—";
  if (col.kind === "status") return typeof value === "boolean" ? (value ? translate("نشط") : translate("غير نشط")) : value ? translate(dictionaries[value] || value) : "—";
  const text = value === null || value === undefined || value === "" ? "—" : latinDigits(String(value));
  return col.truncateNumbers ? text.replace(/-?\d+(?:\.\d+)?/g, (number) => String(Math.trunc(Number(number)))) : text;
};
const secondaryValue = (row: Row, col: Column) => {
  if (col.secondaryRelation) return relationLabel(row, col.secondaryRelation) || "—";
  if (!col.secondaryKey) return "";
  const value = i18n.language === "en" && (col.secondaryKey.endsWith("_name") || col.secondaryKey === "name")
    ? localizedName("", row[col.secondaryKey], "")
    : row[col.secondaryKey];
  return value === null || value === undefined || value === "" ? "—" : latinDigits(String(value));
};
function OrderProductionCell({ entries }: { entries: OrderProductionSummary[] }) {
  if (!entries.length) return <span className="muted-text">{translate("لا توجد أوامر إنتاج")}</span>;
  return <div className="order-production-list">{entries.map((entry) => <div className="order-production-item" key={entry.id}><strong>{entry.production_order_number}</strong><span>{translate("الصنف:")}{" "}{localizedName(entry.item_name_ar, entry.item_name, entry.item_id || "—")}</span><span className="order-production-quantity">{fmtNumber(entry.quantity_kg, 2, "كجم")}</span></div>)}</div>;
}
const renderCell = (row: Row, col: Column) => {
  const value = displayValue(row, col);
  const content = col.kind === "color" ? <span className="color-cell"><i style={{ background: row[col.key] || "#ddd" }} />{row[col.key] || "—"}</span> : col.kind === "status" ? <span className={`tag ${!dictionaries[row[col.key]] ? "neutral" : ""}`}>{value}</span> : value;
  return col.customerLink ? <Link className="customer-link" href={`/customers/${encodeURIComponent(String(row.id))}`}>{content}</Link> : content;
};
const configs: Record<string, Config> = {
  customers: { path: "/customers", title: "العملاء", singular: "عميل", read: ["manage_customers", "manage_orders", "view_orders", "admin"], write: ["manage_customers", "manage_orders", "admin"], fields: [{ key: "name_ar", label: "الاسم بالعربية" }, { key: "name", label: "الاسم بالإنجليزية", required: true }, { key: "tax_number", label: "الرقم الضريبي" }, { key: "phone", label: "الهاتف" }, { key: "sales_rep_id", label: "المندوب", type: "integer", relation: "/customers/sales-representatives" }, { key: "city", label: "المدينة" }, { key: "is_active", label: "نشط", type: "boolean" }], columns: [{ key: "__sequence", label: "م", kind: "relation" }, { key: "name_ar", label: "الاسم العربي", priority: true, customerLink: true }, { key: "name", label: "الاسم الإنجليزي", priority: true }, { key: "plate_drawer_code", label: "رقم الدرج", priority: true }, { key: "sales_rep", label: "اسم المندوب", kind: "relation", priority: true }] },
  products: { path: "/customer-products", title: "منتجات العملاء", singular: "منتج", read: ["manage_customers", "manage_orders", "view_orders", "admin"], write: ["manage_customers", "manage_orders", "admin"], clone: true, mobileColumnLimit: 8, fields: [{ key: "customer_id", label: "العميل", relation: "/customers", required: true }, { key: "category_id", label: "التصنيف", relation: "/categories" }, { key: "item_id", label: "الصنف", relation: "/items" }, { key: "size_caption", label: "وصف المقاس" }, { key: "width", label: "العرض بالسنتيمتر", type: "decimal" }, { key: "thickness", label: "السماكة بالميكرون", type: "decimal" }, { key: "bag_weight_grams", label: "وزن الكيس بالجرام", type: "decimal" }, { key: "raw_material", label: "المادة الخام" }, { key: "master_batch_id", label: "لون الماستر باتش", relation: "/master-batch-colors" }, { key: "status", label: "الحالة", type: "select", options: ["active", "inactive"] }, { key: "notes", label: "ملاحظات", type: "textarea", wide: true }], columns: [{ key: "__sequence", label: "م", centered: true }, { key: "customer_name_ar", label: "العميل", secondaryKey: "customer_name", priority: true, compact: "customer" }, { key: "category", label: "التصنيف / الصنف", kind: "relation", secondaryRelation: "item", priority: true, centered: true, width: "category" }, { key: "size_caption", label: "وصف المقاس", truncateNumbers: true, priority: true, centered: true, width: "size" }, { key: "width", label: "العرض", kind: "number", unit: "سم", priority: true, centered: true, width: "numeric" }, { key: "thickness", label: "السماكة", kind: "number", unit: "µ", tightUnit: true, priority: true, centered: true, width: "numeric" }, { key: "printing_cylinder", label: "السلندر / الطول", joinKey: "cutting_length_cm", joinUnit: "سم", centered: true, width: "combined" }, { key: "raw_material", label: "المادة الخام", centered: true, width: "material" }, { key: "master_batch", label: "الماستر باتش", kind: "relation", colorKey: "master_batch_color_hex", centered: true, width: "color" }] },
  categories: { path: "/categories", title: "التصنيفات", singular: "تصنيف", read: ["manage_categories", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin"], write: ["manage_categories", "manage_definitions", "manage_customers", "manage_orders", "admin"], fields: [{ key: "name", label: "الاسم بالإنجليزية", required: true }, { key: "name_ar", label: "الاسم بالعربية" }, { key: "parent_id", label: "التصنيف الأب", relation: "/categories" }, { key: "overrun_percentage", label: "نسبة الزيادة في الإنتاج", type: "percentage", options: ["0", "5", "10", "20"], required: true }], columns: [{ key: "id", label: "الرمز", priority: true }, { key: "name_ar", label: "الاسم العربي", priority: true }, { key: "name", label: "الاسم الإنجليزي" }, { key: "parent", label: "التصنيف الأب", kind: "relation", priority: true }, { key: "overrun_percentage", label: "نسبة الزيادة في الإنتاج", kind: "number", unit: "%", tightUnit: true, priority: true }] },
  items: { path: "/items", title: "الأصناف", singular: "صنف", read: ["manage_items", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin"], write: ["manage_items", "manage_definitions", "manage_customers", "manage_orders", "admin"], clone: true, fields: [{ key: "category_id", label: "التصنيف", relation: "/categories" }, { key: "name", label: "الاسم بالإنجليزية" }, { key: "name_ar", label: "الاسم بالعربية" }, { key: "status", label: "الحالة", type: "select", options: ["active", "inactive"] }], columns: [{ key: "__sequence", label: "م", priority: true }, { key: "id", label: "الرمز", priority: true }, { key: "category", label: "التصنيف", kind: "relation", priority: true }, { key: "name_ar", label: "الاسم العربي", secondaryKey: "name", priority: true }] },
  colors: { path: "/master-batch-colors", title: "ألوان الماستر باتش", singular: "لون", read: ["manage_master_batch", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin"], write: ["manage_master_batch", "manage_definitions", "manage_customers", "manage_orders", "admin"], fields: [{ key: "id", label: "الرمز", required: true }, { key: "name", label: "الاسم بالإنجليزية", required: true }, { key: "name_ar", label: "الاسم بالعربية", required: true }, { key: "color_hex", label: "رمز لون الماستر باتش", required: true }, { key: "text_color", label: "رمز لون النص", required: true }, { key: "brand", label: "العلامة التجارية" }, { key: "aliases", label: "أسماء بديلة" }, { key: "is_active", label: "نشط", type: "boolean" }], columns: [{ key: "__sequence", label: "م", priority: true }, { key: "id", label: "الرمز", secondaryKey: "brand", priority: true }, { key: "name_ar", label: "الاسم العربي", priority: true }, { key: "color_hex", label: "عينة اللون", kind: "color", priority: true }] },
  orders: { path: "/orders", title: "الطلبات", singular: "طلب", read: ["view_orders", "manage_orders", "admin"], write: ["manage_orders", "admin"], fields: [{ key: "order_number", label: "رقم الطلب", required: true }, { key: "customer_id", label: "العميل", relation: "/customers", required: true }, { key: "status", label: "الحالة", type: "select", options: orderStatuses }, { key: "notes", label: "ملاحظات", type: "textarea", wide: true }], columns: [{ key: "order_number", label: "رقم الطلب", priority: true }, { key: "customer", label: "العميل", kind: "relation", priority: true, width: "order-customer" }, { key: "production_orders_summary", label: "أوامر الإنتاج", priority: true }, { key: "status", label: "الحالة", kind: "status", priority: true }] },
  production: { path: "/production-orders", title: "أوامر الإنتاج", singular: "أمر إنتاج", read: ["view_production", "manage_production", "admin"], write: ["manage_production", "admin"], fields: [{ key: "production_order_number", label: "رقم أمر الإنتاج", required: true }, { key: "order_id", label: "الطلب", relation: "/orders", required: true }, { key: "customer_product_id", label: "المنتج", relation: "/customer-products" }, { key: "quantity_kg", label: "الكمية كجم", type: "decimal", required: true }, { key: "final_quantity_kg", label: "الكمية النهائية كجم", type: "decimal", required: true }, { key: "status", label: "الحالة", type: "select", options: productionStatuses }], columns: [{ key: "production_order_number", label: "رقم الأمر", priority: true }, { key: "order", label: "رقم الطلب", kind: "relation", priority: true }, { key: "customer", label: "العميل", kind: "relation", priority: true }, { key: "product_size_caption", label: "وصف المنتج", priority: true }, { key: "quantity_kg", label: "المطلوبة", kind: "number", unit: "كجم", priority: true }, { key: "final_quantity_kg", label: "النهائية", kind: "number", unit: "كجم" }, { key: "status", label: "الحالة", kind: "status", priority: true }] },
  machines: { path: "/machines", title: "الماكينات", singular: "ماكينة", read: ["view_production", "manage_machines", "view_maintenance", "manage_maintenance", "admin"], write: ["manage_machines", "manage_maintenance", "admin"], fields: [
    { key: "id", label: "رمز الماكينة", required: true }, { key: "name", label: "الاسم بالإنجليزية", required: true }, { key: "name_ar", label: "الاسم بالعربية" }, { key: "type", label: "نوع الماكينة", type: "select", options: machineTypes, required: true }, { key: "section_id", label: "القسم", relation: "/sections" }, { key: "status", label: "حالة الماكينة", type: "select", options: ["active", "maintenance", "down"], required: true },
    { key: "capacity_small_kg_per_hour", label: "السعة الصغيرة (كجم/ساعة)", type: "decimal", onlyMachineType: MACHINE_CAPACITY_TYPES.join("|") }, { key: "capacity_medium_kg_per_hour", label: "السعة المتوسطة (كجم/ساعة)", type: "decimal", onlyMachineType: MACHINE_CAPACITY_TYPES.join("|") }, { key: "capacity_large_kg_per_hour", label: "السعة الكبيرة (كجم/ساعة)", type: "decimal", onlyMachineType: MACHINE_CAPACITY_TYPES.join("|") },
    { key: "screw_type", label: "نوع اللولب", type: "select", options: ["A", "ABA"], onlyMachineType: "extruder" }, { key: "raw_material_type", label: "نوع المادة الخام", type: "select", options: [...MACHINE_RAW_MATERIAL_TYPES], onlyMachineType: "extruder" }, { key: "min_thickness", label: "أقل سماكة (ميكرون)", type: "decimal", onlyMachineType: "extruder" }, { key: "max_thickness", label: "أعلى سماكة (ميكرون)", type: "decimal", onlyMachineType: "extruder" }, { key: "min_width_cm", label: "أقل عرض (سم)", type: "decimal", onlyMachineType: "extruder|printer" }, { key: "max_width_cm", label: "أعلى عرض (سم)", type: "decimal", onlyMachineType: "extruder|printer" }, { key: "inline_printer_id", label: "ماكينة الطباعة المدمجة", relation: "/machines", onlyMachineType: "extruder" },
    { key: "max_print_colors", label: "أقصى عدد ألوان الطباعة", type: "integer", onlyMachineType: "printer" }, { key: "min_cylinder_inch", label: "أقل محيط أسطوانة (بوصة)", type: "decimal", onlyMachineType: "printer" }, { key: "max_cylinder_inch", label: "أعلى محيط أسطوانة (بوصة)", type: "decimal", onlyMachineType: "printer" }, { key: "min_length_cm", label: "أقل طول (سم)", type: "decimal", onlyMachineType: "cutter" }, { key: "max_length_cm", label: "أعلى طول (سم)", type: "decimal", onlyMachineType: "cutter" },
    { key: "width_cm", label: "العرض الكلي (سم)", type: "decimal" }, { key: "length_cm", label: "الطول الكلي (سم)", type: "decimal" }, { key: "height_cm", label: "الارتفاع الكلي (سم)", type: "decimal" }, { key: "weight_kg", label: "الوزن (كجم)", type: "decimal" }, { key: "manufacturer", label: "الشركة المصنعة" }, { key: "serial_number", label: "الرقم التسلسلي" }, { key: "manufacture_date", label: "تاريخ التصنيع", type: "date" }, { key: "metal_plate", label: "بيانات لوحة المعدن", type: "textarea", wide: true },
  ], columns: [{ key: "id", label: "الرمز", priority: true }, { key: "name_ar", label: "الاسم", kind: "bilingual", secondaryKey: "name", priority: true }, { key: "type", label: "نوع الماكينة", kind: "status", priority: true }, { key: "section", label: "القسم", kind: "relation", priority: true }, { key: "status", label: "الحالة", kind: "status", priority: true }] },
  components: { path: "/maintenance-component-catalog", title: "كتالوج مكونات الصيانة", singular: "مكوّن", read: ["view_maintenance", "manage_maintenance", "admin"], write: ["manage_maintenance", "admin"], fields: [{ key: "id", label: "رقم المكوّن" }, { key: "machine_type", label: "نوع الماكينة", type: "select", options: machineTypes, required: true }, { key: "name_ar", label: "اسم المكوّن بالعربية", required: true }, { key: "name_en", label: "اسم المكوّن بالإنجليزية", required: true }, { key: "enabled", label: "مفعّل", type: "boolean" }], columns: [{ key: "machine_type", label: "نوع الماكينة", priority: true }, { key: "name_ar", label: "الاسم بالعربية", priority: true }, { key: "name_en", label: "الاسم بالإنجليزية" }, { key: "enabled", label: "الحالة", kind: "boolean", priority: true }] },
  users: { path: "/users", title: "مستخدمو النظام", singular: "مستخدم", read: ["manage_users", "admin"], write: ["manage_users", "admin"], fields: [{ key: "username", label: "اسم المستخدم" }, { key: "display_name", label: "الاسم" }, { key: "display_name_ar", label: "الاسم بالعربية" }, { key: "role_id", label: "الدور", type: "integer" }, { key: "section_id", label: "القسم" }, { key: "status", label: "الحالة", type: "select", options: ["active", "inactive"] }, { key: "password", label: "كلمة المرور" }] },
  roles: { path: "/roles", title: "الأدوار", singular: "دور", read: ["manage_users", "manage_roles", "admin"], write: ["manage_roles", "admin"], del: ["admin"], fields: [{ key: "name", label: "الاسم" }, { key: "name_ar", label: "الاسم بالعربية" }, { key: "permissions", label: "الصلاحيات JSON", type: "textarea", wide: true }] },
  sections: { path: "/sections", title: "الأقسام", singular: "قسم", read: ["manage_sections", "admin"], write: ["manage_sections", "admin"], fields: [{ key: "id", label: "الرمز" }, { key: "name", label: "الاسم بالإنجليزية", required: true }, { key: "name_ar", label: "الاسم بالعربية" }, { key: "description", label: "الوصف", type: "textarea" }], columns: [{ key: "id", label: "الرمز", priority: true }, { key: "name_ar", label: "الاسم العربي", priority: true }, { key: "name", label: "الاسم الإنجليزي" }, { key: "description", label: "الوصف" }] },
  settings: { path: "/system-settings", title: "إعدادات النظام", singular: "إعداد", read: ["manage_settings", "admin"], write: ["manage_settings", "admin"], fields: [{ key: "setting_key", label: "المفتاح" }, { key: "setting_value", label: "القيمة" }, { key: "setting_type", label: "النوع" }, { key: "description", label: "الوصف", type: "textarea" }] },
};

const localizeConfig = (config: Config): Config => ({
  ...config,
  title: translate(config.title),
  singular: translate(config.singular),
  fields: config.fields.map((field) => ({ ...field, label: translate(field.label) })),
  columns: config.columns?.map((column) => ({ ...column, label: translate(column.label) })),
});

const nav = [
  ["/", "لوحة الإدارة", Gauge, ["admin"]], ["/my-dashboard", "لوحة المستخدم", Users, []], ["/customers", "العملاء", Users, configs.customers.read],
  ["/orders", "الطلبات", FileText, [...configs.orders.read, ...configs.production.read]],
  ["/production", "الإنتاج والتشغيل", Factory, ["admin", ...productionPermissions, "view_mixing", "manage_mixing"]],
  ["/warehouse", "المستودع", Boxes, ["view_production_hall", "view_finished_inventory", "receive_production", "manage_finished_warehouse", "view_raw_inventory", "manage_raw_materials"]],
  ["/hr", "الموارد البشرية", UsersRound, ["manage_hr", "manage_attendance", "admin"]],
  ["/admin", "الإدارة", Shield, ["manage_users", "manage_roles", "manage_sections", "manage_settings", "manage_machines", "manage_maintenance", "manage_categories", "manage_items", "manage_master_batch", "manage_definitions", "view_orders", "manage_customers", "manage_orders", "admin"]],
] as const;

function mainNavActive(href: string, location: string) {
  return location === href || (href === "/production" || href === "/warehouse") && location.startsWith(`${href}/`);
}

function canOpenMainNavigation(user: Row, href: string, permissions: readonly string[]) {
  const account = { id: Number(user.id), permissions: user.permissions ?? [], production_role_binding: user.production_role_binding };
  if (href === "/production") return !!initialProductionPath(account);
  if (href === "/warehouse") return !!initialWarehousePath(account);
  return !permissions.length || can(user, permissions);
}

function useAuth(enabled = true) {
  const [user, setUser] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    api("/me").then((result) => { if (active) setUser(result.user); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const changed = (event: StorageEvent) => {
      if (event.key === "mpbf:role-preview-changed") window.location.reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [enabled]);
  return { user, setUser, loading };
}

function useBranding() {
  const [branding, setBranding] = useState<BrandingSnapshot>(defaultBranding);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => { void fetchBrandingSnapshot().then(setBranding).catch(() => {}).finally(() => setReady(true)); };
    load();
    const onUpdate = () => load();
    window.addEventListener("branding:updated", onUpdate);
    return () => window.removeEventListener("branding:updated", onUpdate);
  }, []);
  return { branding, ready };
}

function BrandIdentity({ branding }: { branding: BrandingSnapshot }) {
  const companyName = localizedName(branding.companyNameAr, branding.companyNameEn, "MPBF");
  return <div className="brand">{branding.logoSrc ? <img src={branding.logoSrc} alt={translate("شعار الشركة")} style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)" }} /> : <div className="brand-mark">{translate("م")}</div>}<div><strong>{companyName || "MPBF"}</strong><small>{i18n.language === "en" ? "PLASTIC MANUFACTURING" : "MPBF"}</small></div></div>;
}

function PublicLanguageSwitcher() {
  const changeLanguage = async (value: string) => {
    const language = normalizeLanguage(value);
    await i18n.changeLanguage(language);
    applyLanguage(language);
  };
  return <div className="language-switcher public-language-switcher"><FlagLanguageSelector
    value={normalizeLanguage(i18n.language)}
    effectiveLanguage={normalizeLanguage(i18n.language)}
    onChange={(value) => void changeLanguage(value)}
  /></div>;
}

function PasswordChange({ user, onComplete, setUser, defaultLanguage }: { user: Row; onComplete: (user: Row) => void; setUser: (user: Row | null) => void; defaultLanguage: "ar" | "en" }) {
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/change-password", { method: "POST", body: JSON.stringify({ password }) }); onComplete((await api("/me")).user); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  return <div className="login-page"><section className="login-box" style={{ gridColumn: "1/-1" }}><form className="login-card" onSubmit={submit}><LanguageSwitcher user={user} setUser={setUser} defaultLanguage={defaultLanguage} /><div className="eyebrow">{translate("إجراء أمني إلزامي")}</div><h2>{translate("تحديث كلمة المرور")}</h2><p>{translate("مرحباً")} {" "}{user.display_name_ar || user.username}{translate(". يجب تحديث كلمة المرور قبل متابعة العمل.")}</p>{error && <div className="error" role="alert" aria-live="assertive">{error}</div>}<div className="field"><label htmlFor="new-password">{translate("كلمة المرور الجديدة")}</label><input id="new-password" autoFocus autoComplete="new-password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div><button className="btn btn-primary" disabled={saving}>{translate("حفظ والمتابعة")}</button></form></section></div>;
}

function Login({ onLogin, branding }: { onLogin: (user: Row) => void; branding: BrandingSnapshot }) {
  const [form, setForm] = useState({ username: "", password: "" }); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { onLogin((await api("/login", { method: "POST", body: JSON.stringify(form) })).user); } catch (e) { setError((e as Error).message); } };
  return <div className="login-page"><section className="login-art"><div><BrandIdentity branding={branding} /><h1>{translate("دقة المصنع.")}<br />{translate("في كل وردية.")}</h1><p>{translate("من الطلب إلى الرول النهائي، مساحة عمل واحدة لفريق MPBF.")}</p></div><div className="grid-lines" /></section><section className="login-box"><form className="login-card" onSubmit={submit}><PublicLanguageSwitcher /><div className="eyebrow">{translate("دخول الفريق")}</div><h2>{translate("مرحباً بعودتك")}</h2><p>{translate("سجّل الدخول للوصول إلى مركز التشغيل.")}</p>{error && <div className="error" role="alert" aria-live="assertive">{error}</div>}<div className="field"><label htmlFor="login-username">{translate("اسم المستخدم")}</label><input id="login-username" autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div><div className="field"><label htmlFor="login-password">{translate("كلمة المرور")}</label><input id="login-password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div><button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>{translate("دخول آمن")}</button></form></section></div>;
}

function LanguageSwitcher({ user, setUser, defaultLanguage }: { user: Row; setUser: (user: Row | null) => void; defaultLanguage: "ar" | "en" }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preference = user.preferred_language === "ar" || user.preferred_language === "en" ? user.preferred_language : "";
  const changeLanguage = async (value: string) => {
    const preferredLanguage = value === "ar" || value === "en" ? value : null;
    setSaving(true);
    setError("");
    try {
      await api("/me/language", { method: "PUT", body: JSON.stringify({ preferred_language: preferredLanguage }) });
      const language = normalizeLanguage(preferredLanguage, defaultLanguage);
      await i18n.changeLanguage(language);
      applyLanguage(language);
      setUser({ ...user, preferred_language: preferredLanguage });
    } catch {
      setError(translate("تعذر حفظ تفضيل اللغة"));
    } finally {
      setSaving(false);
    }
  };
  return <div className="language-switcher">
    <FlagLanguageSelector value={preference} effectiveLanguage={normalizeLanguage(preference, defaultLanguage)}
      allowDefault disabled={saving} onChange={(value) => void changeLanguage(value)} />
    {error && <span className="language-error" role="alert">{error}</span>}
  </div>;
}

function Layout({ children, user, setUser, branding }: { children: ReactNode; user: Row; setUser: (user: Row | null) => void; branding: BrandingSnapshot }) {
  const displayName = localizedName(user.display_name_ar, user.display_name, user.username || "—");
  const roleSwitcherUser = { role_id: user.role_id ?? null, role_name: user.role_name ?? null,
    role_name_ar: user.role_name_ar ?? null, role_preview: user.role_preview };
  const [loc, setLoc] = useLocation();
  const visibleNav = nav.filter(([href, , , permissions]) => canOpenMainNavigation(user, href, permissions));
  const adminNav = visibleNav.find(([href]) => href === "/admin");
  const mobileNav = visibleNav.length <= 5 ? [...visibleNav] : [...visibleNav.slice(0, 4), adminNav || visibleNav[4]];
  const currentModule = visibleNav.find(([href]) => (href === "/production" || href === "/warehouse") && mainNavActive(href, loc));
  if (currentModule && !mobileNav.includes(currentModule)) mobileNav[3] = currentModule;
  const title = loc === "/" && !can(user, ["admin"]) ? "لوحة المستخدم" : nav.find(([href]) => mainNavActive(href, loc))?.[1] || "الإدارة التشغيلية";
  const logout = async () => { try { await api("/logout", { method: "POST" }); } finally { setUser(null); setLoc("/"); } };
  return <div className="shell">
    <aside className="sidebar">
      <BrandIdentity branding={branding} />
      <nav className="nav">{visibleNav.map(([href, label, Icon]) => <Link key={href} href={href} className={mainNavActive(href, loc) ? "active" : ""}><Icon /><span>{translate(label)}</span></Link>)}</nav>
      <div className="side-foot">
        {user.role_preview && <DeferredContent><RoleSwitcher user={roleSwitcherUser} placement="sidebar" /></DeferredContent>}
        {translate("نظام تشغيل المصنع")}<br /><span className="mono">MPBF / CORE 01</span>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div><h1>{translate(title)}</h1><p>{translate("مركز التحكم التشغيلي · بيانات مباشرة")}</p></div>
        <div className="top-actions">
          <LanguageSwitcher user={user} setUser={setUser} defaultLanguage={branding.defaultLanguage} />
          <div className="user-chip"><div className="avatar">{String(displayName).slice(0, 1)}</div><span>{displayName}</span></div>
          <button aria-label={translate("تسجيل الخروج")} className="btn btn-plain" onClick={logout} title={translate("تسجيل الخروج")}><LogOut size={18} /></button>
        </div>
      </header>
      {user.role_preview && <DeferredContent><RoleSwitcher user={roleSwitcherUser} placement="mobile" /></DeferredContent>}
      <div className="content">{children}</div>
      <nav className="mobile-nav">{mobileNav.map(([href, label, Icon]) => <Link key={href} href={href} className={mainNavActive(href, loc) ? "active" : ""}><Icon /><span>{translate(label)}</span></Link>)}</nav>
    </main>
  </div>;
}

function Dashboard({ user }: { user: Row }) {
  const [data, setData] = useState<Row | null>(null); const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const load = () => { setRefreshing(true); setError(""); api("/dashboard").then(setData).catch((e) => setError(e.message)).finally(() => setRefreshing(false)); };
  useEffect(load, []);
  const cards = [["customers", "العملاء", "عملاء مسجلون"], ["orders", "الطلبات", "إجمالي الطلبات"], ["production_orders", "أوامر الإنتاج", "قيد المتابعة"], ["machines", "الماكينات", "أصول المصنع"], ["users", "المستخدمون", "حسابات النظام"]];
  const shortcuts = nav.filter(([href, , , permissions]) => !["/", "/my-dashboard", "/admin"].includes(href) && canOpenMainNavigation(user, href, permissions));
  return <><PageHero kicker="نظرة تشغيلية · اليوم" title={translate("لوحة الإدارة")} description="ملخص مباشر لأداء المصنع ومحطات العمل." onRefresh={load} refreshing={refreshing} actions={<span className="tag">{translate("اتصال مباشر بالبيانات")}</span>} />{error && <div className="error">{error}</div>}<div className="stats">{cards.map(([key, label, sub]) => <div className="stat" key={key}><label>{translate(label)}</label><strong>{data ? data[key] ?? 0 : <span className="skeleton" style={{ display: "inline-block", width: 55 }} />}</strong><small>{translate(sub)}</small></div>)}</div><div className="panel"><div className="panel-head"><h3>{translate("محطات العمل")}</h3><span className="eyebrow">{translate("اختصارات سريعة")}</span></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>{shortcuts.map(([href, label, Icon]) => <Link className="btn btn-muted" href={href} key={href}><Icon size={17} />{translate(label)}</Link>)}</div></div></>;
}

function EntityPage({ kind, user, refreshToken = 0, showHero = true }: { kind: string; user: Row; refreshToken?: number; showHero?: boolean }) {
  const [, setLocation] = useLocation();
  const [params, setParams] = useSearchParams();
  const [viewingProduction, setViewingProduction] = useState<Row | null>(null);
  const [viewingOrder, setViewingOrder] = useState<number | null>(null);
  const viewOrderQuery = params.get("viewOrder");
  const [categories, setCategories] = useState<Row[]>([]);
  const [categoriesBusy, setCategoriesBusy] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoriesRetry, setCategoriesRetry] = useState(0);
  const activeCategoryId = kind === "items" ? params.get("categoryId") || undefined : undefined;
  useEffect(() => {
    if (kind !== "items") return;
    let active = true;
    setCategoriesBusy(true);
    setCategoriesError("");
    void list("/items/category-options").then((value) => {
      if (active) setCategories(value);
    }).catch((categoryError) => {
      if (active) setCategoriesError((categoryError as Error).message || translate("تعذر تحميل التصنيفات"));
    }).finally(() => {
      if (active) setCategoriesBusy(false);
    });
    return () => { active = false; };
  }, [kind, categoriesRetry]);
  useEffect(() => {
    if (kind === "items" || !params.has("categoryId")) return;
    const next = new URLSearchParams(params);
    next.delete("categoryId");
    setParams(next, { replace: true });
  }, [kind, params, setParams]);
  useEffect(() => {
    if (kind !== "orders") return;
    const id = Number(viewOrderQuery);
    setViewingOrder(viewOrderQuery && /^\d+$/.test(viewOrderQuery) && Number.isSafeInteger(id) && id > 0 ? id : null);
  }, [kind, viewOrderQuery]);
  const cfg = useMemo(() => localizeConfig(configs[kind]), [kind, i18n.language]); const [loadedRows, setRows] = useState<Row[]>([]); const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const [resultKey, setResultKey] = useState(""); const [busyState, setBusy] = useState(true); const [error, setError] = useState(""); const [edit, setEdit] = useState<Row | null>(null);
  const [displayFolder, setDisplayFolder] = useState<OrderDisplayFolder | "all">("all");
  const [folderCounts, setFolderCounts] = useState<Record<OrderDisplayFolder, number>>({ new: 0, production: 0, urgent: 0, archive: 0 });
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [folderCountsVersion, setFolderCountsVersion] = useState(0);
  const readable = can(user, cfg.read); const writable = can(user, cfg.write); const deletable = can(user, cfg.del || ["admin"]); const clonable = Boolean(cfg.clone && writable);
  const viewable = kind === "production" || kind === "orders";
  const showActions = viewable || writable || deletable || clonable;
  const requestGate = useRef(createLatestRequestGate());
  const activeFolder = kind === "orders" && displayFolder !== "all" ? displayFolder : undefined;
  const activeKey = `${cfg.path}|${search}|${page}|${activeFolder || "all"}|${activeCategoryId || "all"}|${refreshToken}`;
  const rows = resultKey === activeKey ? loadedRows : [];
  const busy = busyState || resultKey !== activeKey;
  const load = useCallback(() => {
    const request = requestGate.current.begin();
    const requestKey = activeKey;
    setBusy(true);
    setResultKey("");
    setError("");
    void runLatestRequest(requestGate.current, request, listPage(cfg.path, search, page * LIST_PAGE_SIZE, LIST_PAGE_SIZE, activeFolder, activeCategoryId), {
      onSuccess: (value) => {
        setRows(value.map((row, index) => ({ ...row, __sequence: page * LIST_PAGE_SIZE + index + 1 })));
        setResultKey(requestKey);
      },
      onError: (requestError) => {
        setRows([]);
        setResultKey(requestKey);
        setError(requestError.message);
      },
      onSettled: () => setBusy(false),
    });
  }, [activeKey, activeFolder, activeCategoryId, cfg.path, page, search]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load]);
  useEffect(() => {
    if (kind !== "orders") return;
    let active = true;
    void api("/orders/display-folders").then((response) => {
      if (!active || !response?.counts) return;
      setFolderCounts({
        new: Number(response.counts.new || 0),
        production: Number(response.counts.production || 0),
        urgent: Number(response.counts.urgent || 0),
        archive: Number(response.counts.archive || 0),
      });
    }).catch((countError) => {
      if (active) setWorkspaceError((countError as Error).message || translate("تعذر تحميل مجلدات الطلبات"));
    });
    return () => { active = false; };
  }, [kind, folderCountsVersion]);
  if (!readable) return <div className="empty"><strong>{translate("لا تملك صلاحية العرض")}</strong>{translate("تواصل مع مدير النظام.")}</div>;
  const remove = async (id: any) => {
    const warning = cfg.path === "/orders"
      ? "تأكيد حذف الطلب نهائيًا؟ سيتم حذف جميع أوامر الإنتاج والرولات والاستلامات وحركات وأرصدة المخزون المرتبطة به. الاستلامات المشتركة ستحتفظ ببنود الطلبات الأخرى. لا يمكن التراجع عن هذا الحذف."
      : "تأكيد حذف السجل؟";
    if (!deletable || !confirm(translate(warning))) return;
    try { await api(`${cfg.path}/${id}`, { method: "DELETE" }); latestLoad.current(); } catch (e) { setError((e as Error).message); }
  };
  const clone = (row: Row) => { const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...copy } = row; setEdit(copy); };
  const printOrder = (id: number) => window.open(`/orders/${encodeURIComponent(String(id))}/print`, "_blank", "noopener,noreferrer");
  const performWorkspaceAction = async (action: OrderWorkspaceAction, items: { id: number; expected_status: string }[]) => {
    if (!writable || !items.length || items.length > 100) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      await api("/orders/actions", { method: "POST", body: JSON.stringify({ action, items }) });
      setSelectedOrderIds((selected) => selected.filter((id) => !items.some((item) => item.id === id)));
      latestLoad.current();
      setFolderCountsVersion((version) => version + 1);
    } catch (actionError) {
      setWorkspaceError((actionError as Error).message);
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const moveWorkspaceOrders = async (folder: OrderDisplayFolder, items: { id: number; expected_folder: OrderDisplayFolder }[]) => {
    if (!writable || !items.length || items.length > 100) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      await api("/orders/display-folders/move", { method: "POST", body: JSON.stringify({ folder, items }) });
      setSelectedOrderIds((selected) => selected.filter((id) => !items.some((item) => item.id === id)));
      latestLoad.current();
      setFolderCountsVersion((version) => version + 1);
    } catch (moveError) {
      setWorkspaceError((moveError as Error).message);
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const deleteWorkspaceOrders = async (items: { id: number; expected_status: string }[]) => {
    if (!deletable || workspaceBusy || !items.length || items.length > 100) return;
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      await api("/orders/bulk-delete", { method: "POST", body: JSON.stringify({ items }) });
      setSelectedOrderIds([]);
      setEdit(null);
      setViewingOrder(null);
      latestLoad.current();
      setFolderCountsVersion((version) => version + 1);
    } catch (deleteError) {
      setWorkspaceError((deleteError as Error).message);
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const closeOrder = () => {
    setViewingOrder(null);
    if (viewOrderQuery) {
      const next = new URLSearchParams(params);
      next.delete("viewOrder");
      setParams(next, { replace: true });
    }
  };
  const rowActions = (row: Row, mobile = false) => <div className="actions">
    {kind === "orders" && writable && <OrderRowActionMenu row={row as WorkspaceOrder} enabled={writable && !workspaceBusy} onAction={performWorkspaceAction} />}
    {viewable && <button aria-label={kind === "orders" ? translate("عرض الطلب") : translate("عرض أمر الإنتاج")} title={translate("عرض")} className={mobile ? "btn btn-muted" : "btn btn-plain"} onClick={() => kind === "orders" ? setViewingOrder(Number(row.id)) : setViewingProduction(row)}><Eye size={16} />{mobile && translate(" عرض")}</button>}
    {kind === "orders" && <a aria-label={translate("طباعة الطلب")} title={translate("طباعة")} className={mobile ? "btn btn-muted" : "btn btn-plain"} href={`/orders/${encodeURIComponent(String(row.id))}/print`} target="_blank" rel="noopener noreferrer"><Printer size={16} />{mobile && translate(" طباعة")}</a>}
    {writable && <button aria-label={`${translate("تعديل")} ${translate(cfg.singular)}`} title={translate("تعديل")} className={mobile ? "btn btn-muted" : "btn btn-plain"} onClick={() => setEdit(row)}><Pencil size={16} />{mobile && ` ${translate("تعديل")}`}</button>}
    {clonable && <button aria-label={`${translate("استنساخ")} ${translate(cfg.singular)}`} title={translate("استنساخ")} className={mobile ? "btn btn-muted" : "btn btn-plain"} onClick={() => clone(row)}><Copy size={16} />{mobile && ` ${translate("استنساخ")}`}</button>}
    {deletable && <button aria-label={`${translate("حذف")} ${translate(cfg.singular)}`} title={translate("حذف")} className={mobile ? "btn btn-danger" : "btn btn-plain"} onClick={() => remove(row.id)}><Trash2 size={16} />{mobile && ` ${translate("حذف")}`}</button>}
  </div>;
  const cols = cfg.columns || cfg.fields.slice(0, 5).map((field) => ({ key: field.key, label: field.label, kind: field.type === "date" ? "date" : field.type === "decimal" || field.type === "integer" ? "number" : field.key === "status" ? "status" : "text" } as Column));
  const columnClass = (field: Column) => [field.priority ? "priority-column" : "", field.compact ? `compact-${field.compact}` : "", field.centered ? "centered-column" : "", field.width ? `column-${field.width}` : "", kind === "orders" && field.key === "order_number" ? "order-number-column" : ""].filter(Boolean).join(" ");
  const searchInput = <>
    <Search size={17} aria-hidden="true" />
    <label className="sr-only" htmlFor={`${kind}-search`}>{translate("بحث في")}{" "}{cfg.title}</label>
    <input id={`${kind}-search`} aria-label={`${translate("بحث في")} ${cfg.title}`} className="search" placeholder={translate("بحث في السجل…")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); setSelectedOrderIds([]); setEdit(null); }} />
  </>;
  const renderCell = (row: Row, field: Column) => {
    if (kind === "orders" && field.key === "order_number") return <span className="order-number-stack"><span className="order-number-code">{displayValue(row, field)}</span><small className="order-number-date">{fmtOrderDate(row.created_at)}</small></span>;
    if (field.key === "production_orders_summary") return <OrderProductionCell entries={Array.isArray(row.production_orders_summary) ? row.production_orders_summary : []} />;
    const content = field.colorKey ? <span className="color-stack"><MasterBatchSwatch color={{ color_hex: row[field.colorKey], name_ar: row[`${field.key}_name_ar`], name: row[`${field.key}_name`], id: row[`${field.key}_id`] }} size={22} /><span>{displayValue(row, field)}</span></span> : field.kind === "color" ? <span className="color-cell"><MasterBatchSwatch color={{ ...row, color_hex: row[field.key] }} size={20} />{row[field.key] || "—"}</span> : field.kind === "status" ? <span className={`tag ${!dictionaries[row[field.key]] ? "neutral" : ""}`}>{displayValue(row, field)}</span> : field.secondaryKey || field.secondaryRelation ? <><strong>{displayValue(row, field)}</strong><small className="cell-sub">{secondaryValue(row, field)}</small></> : displayValue(row, field);
    return field.customerLink ? <Link className="customer-link" href={`/customers/${encodeURIComponent(String(row.id))}`}>{content}</Link> : content;
  };
  return <>
    {showHero ? <PageHero kicker={translate("سجل البيانات · {{count}} سجل معروض", { count: rows.length })} title={translate(cfg.title)} description={translate("استعرض وأدر سجلات {{title}}.", { title: translate(cfg.title) })} onRefresh={load} refreshing={busy} actions={writable && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={17} />{" "}{translate("إضافة")}{" "}{translate(cfg.singular)}</button>} /> : writable && <div className="page-heading"><button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={17} />{" "}{translate("إضافة")}{" "}{translate(cfg.singular)}</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
    <section className="panel">
      {kind === "orders" && <OrderWorkspaceControls
        rows={rows as WorkspaceOrder[]}
        folder={displayFolder}
        counts={folderCounts}
        selected={selectedOrderIds}
        canManage={writable}
        canDelete={deletable}
        busy={workspaceBusy}
        error={workspaceError}
        searchControl={<div className="tools order-workspace__search">{searchInput}</div>}
        onFolderChange={(folder) => { setDisplayFolder(folder); setPage(0); setSelectedOrderIds([]); setEdit(null); setWorkspaceError(""); }}
        onSelectPage={(checked) => setSelectedOrderIds((selected) => checked ? Array.from(new Set([...selected, ...rows.map((row) => Number(row.id))])) : selected.filter((id) => !rows.some((row) => Number(row.id) === id)))}
        onClear={() => setSelectedOrderIds([])}
        onAction={performWorkspaceAction}
        onMove={moveWorkspaceOrders}
        onDelete={deleteWorkspaceOrders}
      />}
      {kind !== "orders" && <div className="panel-head">
        <div><h3>{translate("سجل")}{" "}{cfg.title}</h3><small className="muted-text">{translate("السجلات المعروضة من البيانات المحملة")}</small></div>
        {kind !== "orders" && <div className={kind === "items" ? "tools entity-tools-categories" : "tools"}>
          {searchInput}
          {kind === "items" && <div className="entity-category-filter">
            <label htmlFor="items-category-filter">{translate("التصنيف")}</label>
            <select id="items-category-filter" value={activeCategoryId || ""} disabled={categoriesBusy || Boolean(categoriesError)} onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set("categoryId", event.target.value);
              else next.delete("categoryId");
              setParams(next, { replace: true });
              setPage(0);
              setSelectedOrderIds([]);
              setEdit(null);
            }}>
              <option value="">{translate("جميع التصنيفات")}</option>
              {categories.map((category) => <option value={String(category.id)} key={category.id}>{localizedName(category.name_ar, category.name, String(category.id))}</option>)}
            </select>
          </div>}
        </div>}
      </div>}
      {kind === "items" && categoriesError && <div className="error entity-category-error" role="alert">
        <span>{categoriesError}</span>
        <button className="btn btn-muted" type="button" onClick={() => setCategoriesRetry((retry) => retry + 1)}>{translate("إعادة المحاولة")}</button>
      </div>}
      {busy ? <div style={{ padding: 20, display: "grid", gap: 12 }} aria-busy="true">{[1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}</div> : rows.length === 0 ? <div className="empty"><strong>{translate("لا توجد سجلات مطابقة")}</strong>{translate("ابدأ بإضافة أول سجل لهذا القسم.")}</div> : <div className="table-wrap">
        <table>
          <thead><tr>{kind === "orders" && writable && <th className="order-row-select"><OrderSelectionBox label={translate("حدد الصفحة الحالية")} checked={rows.length > 0 && rows.every((row) => selectedOrderIds.includes(Number(row.id)))} onChange={(checked) => setSelectedOrderIds((selected) => checked ? Array.from(new Set([...selected, ...rows.map((row) => Number(row.id))])) : selected.filter((id) => !rows.some((row) => Number(row.id) === id)))} /></th>}{cols.map((field) => <th className={columnClass(field)} key={field.key}>{field.label}</th>)}{showActions && <th>{translate("إجراء")}</th>}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{kind === "orders" && writable && <td className="order-row-select"><OrderSelectionBox label={`${translate("حدد")} ${displayValue(row, cols[0])}`} checked={selectedOrderIds.includes(Number(row.id))} onChange={() => setSelectedOrderIds((selected) => selected.includes(Number(row.id)) ? selected.filter((id) => id !== Number(row.id)) : [...selected, Number(row.id)])} /></td>}{cols.map((field) => <td className={columnClass(field)} title={displayValue(row, field)} key={field.key}>{renderCell(row, field)}</td>)}{showActions && <td>{rowActions(row)}</td>}</tr>)}</tbody>
        </table>
        <div className="mobile-cards">{rows.map((row, index) => { const primary = cols.find((c) => c.priority) || cols[0]; const subtitle = primary.secondaryKey || primary.secondaryRelation ? null : cols.find((c) => c !== primary && c.kind === "relation"); return <article className="entity-card" key={row.id ?? index}>{kind === "orders" && writable && <OrderSelectionBox label={`${translate("حدد")} ${displayValue(row, cols[0])}`} checked={selectedOrderIds.includes(Number(row.id))} onChange={() => setSelectedOrderIds((selected) => selected.includes(Number(row.id)) ? selected.filter((id) => id !== Number(row.id)) : [...selected, Number(row.id)])} />}<strong>{renderCell(row, primary)}</strong><small>{primary.secondaryKey || primary.secondaryRelation ? secondaryValue(row, primary) : displayValue(row, subtitle || cols.find((c) => c !== primary) || primary)}</small>{cols.filter((c) => c !== primary && c !== subtitle).slice(0, cfg.mobileColumnLimit ?? 4).map((field) => <div className="card-line" key={field.key}><span>{field.label}</span><b>{renderCell(row, field)}</b></div>)}{showActions && rowActions(row, true)}</article>; })}</div>
      </div>}
      {!busy && (page > 0 || rows.length === LIST_PAGE_SIZE) && <nav className="list-pagination" aria-label={`${translate("صفحات")} ${cfg.title}`}>
         <button className="btn btn-muted" type="button" disabled={page === 0} onClick={() => { setPage((current) => Math.max(0, current - 1)); setSelectedOrderIds([]); }}>{translate("السابق")}</button>
        <span>{translate("صفحة")}{" "}{page + 1}</span>
         <button className="btn btn-muted" type="button" disabled={rows.length < LIST_PAGE_SIZE} onClick={() => { setPage((current) => current + 1); setSelectedOrderIds([]); }}>{translate("التالي")}</button>
      </nav>}
    </section>
    <DeferredContent>
    {viewingProduction && <ProductionOrderModal row={viewingProduction} mode="view" onClose={() => setViewingProduction(null)} />}
    {viewingOrder && <OrderDetailsModal id={viewingOrder} canRelease={writable} onOrderChanged={() => latestLoad.current()} onClose={closeOrder} onPrint={() => printOrder(viewingOrder)} />}
    {edit && (kind === "customers" ? <CustomerModal row={edit} onClose={() => setEdit(null)} onSaved={(saved) => { const created = !edit.id; setEdit(null); if (created) setLocation(`/customers/${encodeURIComponent(String(saved.id))}`); else latestLoad.current(); }} /> : kind === "orders" && !edit.id ? <OrderCreateModal onClose={() => setEdit(null)} onSaved={() => { setEdit(null); latestLoad.current(); }} /> : <EntityModal cfg={cfg} row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); latestLoad.current(); }} />)}
    </DeferredContent>
  </>;
}

function EntityModal(props: { cfg: Config; row: Row; onClose: () => void; onSaved: () => void }) {
  return props.cfg.path === "/orders"
    ? <OrderCreateModal editId={props.row.id} onClose={props.onClose} onSaved={props.onSaved} />
    : props.cfg.path === "/production-orders" && props.row.id
      ? <ProductionOrderModal row={props.row} mode="edit" onClose={props.onClose} onSaved={props.onSaved} />
    : props.cfg.path === "/customer-products"
      ? <CustomerProductModal row={props.row} onClose={props.onClose} onSaved={props.onSaved} />
    : <EntityFormModal {...props} />;
}

function EntityFormModal({ cfg, row, onClose, onSaved }: { cfg: Config; row: Row; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Row>(() => {
    const createDefaults: Row = row.id ? {} : newAdminFormDefaults(cfg.path);
    const initial: Row = { ...createDefaults, ...row, permissions: Array.isArray(row.permissions) ? JSON.stringify(row.permissions, null, 2) : row.permissions };
    cfg.fields.filter((field) => field.type === "decimal" && !(cfg.path === "/customer-products" && (field.key === "width" || field.key === "thickness"))).forEach((field) => { initial[field.key] = decimalInputValue(initial[field.key], cfg.path === "/machines" && field.key.endsWith("_thickness") ? 3 : 2); });
    return initial;
  }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [options, setOptions] = useState<Record<string, Row[]>>({}); const [optionErrors, setOptionErrors] = useState<string[]>([]); const [optionsLoading, setOptionsLoading] = useState(() => cfg.fields.some((field) => Boolean(field.relation))); const [retryOptions, setRetryOptions] = useState(0);
  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    setOptionErrors([]);
    setOptions({});
    const relations = cfg.fields.filter((field) => field.relation);
    Promise.all(relations.map(async (field) => {
      try {
        const values = await list(field.relation!);
        return [field.key, values] as const;
      } catch (e) {
        return [field.key, { error: `${field.label}: ${(e as Error).message}` }] as const;
      }
    })).then((pairs) => {
      if (!active) return;
      const next: Record<string, Row[]> = {};
      const errors: string[] = [];
      pairs.forEach(([key, value]) => {
        if (Array.isArray(value)) next[key] = value.filter((item, index, all) => all.findIndex((candidate) => String(candidate.id) === String(item.id)) === index);
        else errors.push(value.error);
      });
      setOptions(next);
      setOptionErrors(errors);
      setOptionsLoading(false);
    });
    return () => { active = false; };
  }, [cfg, retryOptions]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [saving, onClose]);
  const visibleFields = cfg.fields.filter((field) => !field.onlyMachineType || machineTypeMatches(field.onlyMachineType, form.type));
  const relationOptions = (field: Field) => {
    let candidates = options[field.key] || [];
    if (cfg.path === "/machines" && field.key === "inline_printer_id") candidates = eligibleInlinePrinterMachines(candidates, row.id);
    if (cfg.path === "/categories" && field.key === "parent_id") {
      const excluded = new Set<string>(row.id ? [String(row.id)] : []);
      let changed = true;
      while (changed) {
        changed = false;
        candidates.forEach((option) => {
          if (option.parent_id && excluded.has(String(option.parent_id)) && !excluded.has(String(option.id))) {
            excluded.add(String(option.id));
            changed = true;
          }
        });
      }
      candidates = candidates.filter((option) => !excluded.has(String(option.id)));
    }
    return candidates;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (optionsLoading || optionErrors.length) {
      setError(translate("تعذر تحميل قوائم العلاقات. أعد المحاولة قبل الحفظ لتجنب تغيير العلاقات دون قصد."));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Row = {};
      const fieldsToSave = cfg.path === "/machines" && row.id ? cfg.fields : visibleFields;
      for (const field of fieldsToSave) {
        if (field.key === "id" && (usesGeneratedAdminId(cfg.path) || row.id)) continue;
        let value = form[field.key];
        if (cfg.path === "/customer-products" && (field.key === "width" || field.key === "thickness") && value !== "" && value !== undefined && value !== null) {
          const numberText = latinDigits(String(value).trim());
          const maximum = field.key === "width" ? 999999 : 99999;
          if (!/^\d+$/.test(numberText) || Number(numberText) <= 0 || Number(numberText) > maximum) throw new Error(`${field.label} يجب أن يكون رقماً صحيحاً موجباً لا يتجاوز ${maximum}`);
        }
        if (field.type === "decimal" && row.id && value === decimalInputValue(row[field.key], cfg.path === "/machines" && field.key.endsWith("_thickness") ? 3 : 2)) value = row[field.key];
        if ((value === "" || value === undefined || value === null) && field.required) throw new Error(`${field.label} مطلوب`);
        if (field.relation && row.id && String(value ?? "") === String(row[field.key] ?? "")) continue;
        if ((field.key === "color_hex" || field.key === "text_color") && value && !/^(?:transparent|#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8}))$/.test(String(value))) throw new Error(`${field.label} يجب أن يكون لون HEX مثل #12AB34 أو transparent للون الشفاف`);
        if (value === "" || value === undefined || value === null) {
          if (row.id && !field.required) body[field.key] = null;
          continue;
        }
        if (field.key === "enabled" || field.type === "boolean") body[field.key] = value === true || value === "true";
        else if (field.type === "integer" || field.type === "percentage") body[field.key] = Number(value);
        else body[field.key] = field.type === "decimal" ? String(value) : value;
      }
      if (row.id) await api(`${cfg.path}/${row.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api(cfg.path, { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const labelFor = (option: Row) => latinDigits(localizedName(option.name_ar, option.name, String(option.order_number || option.production_order_number || option.id || "—")));
  const generatedId = "يُولَّد تلقائيًا عند الحفظ";
  const idField = cfg.fields.find((field) => field.key === "id");
  const idLabel = usesGeneratedAdminId(cfg.path) ? idField?.label || (cfg.path === "/categories" ? "رمز التصنيف" : cfg.path === "/items" ? "رمز الصنف" : null) : null;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><form className={`modal ${cfg.path === "/machines" ? "wide-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="entity-dialog-title" onSubmit={save}>
    <header><h3 id="entity-dialog-title">{row.id ? translate("تعديل") : translate("إضافة")} {cfg.singular}</h3><button aria-label={translate("إغلاق الحوار")} title={translate("إغلاق")} disabled={saving} type="button" className="btn btn-plain" onClick={onClose}><X /></button></header>
    {optionsLoading && <div className="tag" role="status" style={{ margin: 18 }}>{translate("جارٍ تحميل خيارات العلاقات…")}</div>}
    {optionErrors.length > 0 && <div className="error" role="alert" style={{ margin: 18 }}>{optionErrors.join(" · ")} <button type="button" className="btn btn-muted" onClick={() => setRetryOptions((attempt) => attempt + 1)}>{translate("إعادة تحميل القوائم")}</button></div>}
    {cfg.fields.some((field) => field.relation && form[field.key] && !relationOptions(field).some((option) => String(option.id) === String(form[field.key]))) && !optionErrors.length && <div className="tag" role="status" style={{ margin: 18 }}>{translate("توجد علاقة محفوظة قديمة أو غير متاحة. ستبقى كما هي ما لم تختر بديلاً صالحاً.")}</div>}
    {error && <div className="error" role="alert" style={{ margin: 18 }}>{error}</div>}
    <div className="form-grid">
      {idLabel && <div className="field"><label htmlFor="generated-record-id">{idLabel}</label><input id="generated-record-id" value={row.id ?? generatedId} disabled readOnly /></div>}
      {visibleFields.filter((field) => field.key !== "id" || (!usesGeneratedAdminId(cfg.path) && !row.id)).map((field) => {
        const choices = field.relation ? relationOptions(field) : [];
        const currentMissing = Boolean(form[field.key]) && field.relation && !choices.some((option) => String(option.id) === String(form[field.key]));
        return <div className={field.wide ? "field wide" : "field"} key={field.key}>
          <label htmlFor={`field-${field.key}`}>{field.label}</label>
          {field.relation ? <select id={`field-${field.key}`} required={field.required} value={form[field.key] ?? ""} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}>
            <option value="">{translate("غير محدد")}</option>{choices.map((option) => <option key={option.id} value={option.id}>{labelFor(option)}</option>)}
            {currentMissing && <option value={form[field.key]}>{translate("القيمة الحالية المحفوظة:")}{" "}{String(form[field.key])}</option>}
          </select> : field.type === "select" || field.type === "percentage" ? <select id={`field-${field.key}`} required={field.required} value={form[field.key] ?? ""} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}>{field.type !== "percentage" && <option value="">{translate("اختر")}</option>}{field.options?.map((option) => <option key={option} value={option}>{field.type === "percentage" ? `${option}%` : dictionaries[option] || option}</option>)}{form[field.key] && !field.options?.includes(String(form[field.key])) && <option value={form[field.key]}>{translate("القيمة الحالية المحفوظة:")}{" "}{dictionaries[String(form[field.key])] || dictionaries[canonicalMachineType(form[field.key])] || String(form[field.key])}</option>}</select>
            : field.type === "textarea" ? <textarea id={`field-${field.key}`} required={field.required} value={form[field.key] ?? ""} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} />
            : field.type === "boolean" ? <label className="check-row"><input id={`field-${field.key}`} type="checkbox" checked={Boolean(form[field.key] ?? true)} onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })} />{form[field.key] === false ? translate("غير مفعّل") : translate("مفعّل")}</label>
            : <div className="input-with-preview"><input id={`field-${field.key}`} required={field.required} type={field.type === "date" ? "date" : field.type === "integer" || field.type === "decimal" ? "number" : "text"} min={cfg.path === "/customer-products" && (field.key === "width" || field.key === "thickness") ? "1" : undefined} max={cfg.path === "/customer-products" && field.key === "width" ? "999999" : cfg.path === "/customer-products" && field.key === "thickness" ? "99999" : undefined} step={cfg.path === "/customer-products" && (field.key === "width" || field.key === "thickness") ? "1" : field.type === "decimal" ? (cfg.path === "/machines" && field.key.endsWith("_thickness") ? "0.001" : "0.01") : undefined} value={form[field.key] ?? ""} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} />{(field.key === "color_hex" || field.key === "text_color") && <MasterBatchSwatch className="color-preview" size={20} label={translate("معاينة اللون")} color={{ color_hex: form[field.key], name_ar: field.key === "color_hex" ? form.name_ar : undefined, name: field.key === "color_hex" ? form.name : undefined }} />}</div>}
        </div>;
      })}
    </div>
    <footer><button disabled={saving || optionsLoading || optionErrors.length > 0} className="btn btn-primary">{saving ? translate("جارٍ الحفظ…") : translate("حفظ السجل")}</button><button disabled={saving} type="button" className="btn btn-muted" onClick={onClose}>{translate("إلغاء")}</button></footer>
  </form></div>;
}

function CompanyProfile({ user }: { user: Row }) {
  const allowed = can(user, ["manage_settings", "admin"]);
  const [form, setForm] = useState<Row>({}); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  useEffect(() => { if (allowed) api("/company-profile").then((value) => setForm(value || {})).catch((e) => setError(e.message)); }, [allowed]);
  if (!allowed) return <div className="empty"><strong>{translate("لا تملك صلاحية العرض")}</strong>{translate("تواصل مع مدير النظام.")}</div>;
  const fields = [["name", "اسم الشركة"], ["name_ar", "اسم الشركة بالعربية"], ["address", "العنوان"], ["tax_number", "الرقم الضريبي"], ["phone", "الهاتف"], ["email", "البريد الإلكتروني"], ["working_hours_per_day", "ساعات العمل"]]; 
  const save = async (event: FormEvent) => { event.preventDefault(); setError(""); setSaved(false); try { const body = Object.fromEntries(fields.map(([key]) => [key, form[key]]).filter(([, value]) => value !== "" && value !== null && value !== undefined)); await api("/company-profile", { method: "PUT", body: JSON.stringify(body) }); setSaved(true); } catch (e) { setError((e as Error).message); } };
  return <section className="panel"><div className="panel-head"><h3>{translate("ملف الشركة")}</h3></div><form className="form-grid" onSubmit={save}>{fields.map(([key, label]) => <div className="field" key={key}><label htmlFor={`company-${key}`}>{translate(label)}</label><input id={`company-${key}`} type={key === "working_hours_per_day" ? "number" : "text"} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: key === "working_hours_per_day" ? Number(e.target.value) : e.target.value })} /></div>)}<div className="wide" aria-live="polite">{error && <div className="error" role="alert">{error}</div>}{saved && <div className="tag">{translate("تم حفظ التغييرات")}</div>}<button className="btn btn-primary">{translate("حفظ ملف الشركة")}</button></div></form></section>;
}

const permissionGroups = [
  { label: "النظام والإدارة", items: [["admin","مدير النظام"],["manage_users","إدارة المستخدمين"],["manage_roles","إدارة الأدوار والصلاحيات"],["manage_sections","إدارة الأقسام"],["manage_settings","إدارة الإعدادات"],["manage_definitions","إدارة التعريفات"],["view_system_health","صحة النظام"],["view_system_monitoring","مراقبة النظام"]] },
  { label: "الصيانة والآلات", items: [["manage_machines","إدارة الماكينات"],["manage_maintenance","إدارة الصيانة"],["manage_maintenance_actions","إجراءات الصيانة"],["create_maintenance_requests","إنشاء طلبات الصيانة"],["view_maintenance","عرض الصيانة"],["view_maintenance_reports","تقارير الصيانة"],["view_maintenance_requests","طلبات الصيانة"],["view_maintenance_stats_reports","إحصاءات الصيانة"]] },
  { label: "الإنتاج والتشغيل", items: [["manage_production","إدارة الإنتاج"],["operate_film","تشغيل الفيلم"],["operate_printing","تشغيل الطباعة"],["operate_cutting","تشغيل القص"],["view_production_hall","عرض صالة الإنتاج"],["delete_production","حذف سجلات الإنتاج"],["manage_production_hall","إدارة صالة الإنتاج"],["view_production","عرض الإنتاج"],["view_production_monitoring","مراقبة الإنتاج"],["view_production_reports","تقارير الإنتاج"],["view_today_production","إنتاج اليوم"],["view_cutting_dashboard","لوحة القص"],["view_film_dashboard","لوحة الفيلم"],["view_printing_dashboard","لوحة الطباعة"],["manage_mixing","إدارة الخلط"],["view_mixing","عرض الخلط"]] },
  finishedGoodsPermissionGroup,
  { label: "المخزون والمستودع", items: [["manage_inventory","إدارة المخزون"],["view_inventory","عرض المخزون"],["manage_warehouse","إدارة المستودع"],["view_warehouse","عرض المستودع"],["view_raw_inventory","عرض مخزون المواد الخام"],["manage_raw_materials","إدارة مواد الخام"],["manage_warehouse_vouchers","إدارة سندات المستودع"],["view_warehouse_vouchers","عرض سندات المستودع"],["view_warehouse_reports","تقارير المستودع"],["manage_spare_parts","قطع الغيار"],["manage_consumable_parts","المواد المستهلكة"],["manage_items","إدارة الأصناف"],["manage_categories","إدارة التصنيفات"]] },
  { label: "الجودة والطلبات والعملاء", items: [["manage_quality","إدارة الجودة"],["manage_quality_settings","إعدادات الجودة"],["create_quality_inspections","إنشاء فحوص الجودة"],["view_quality","عرض الجودة"],["view_quality_reports","تقارير الجودة"],["view_quality_control_reports","تقارير ضبط الجودة"],["manage_orders","إدارة الطلبات"],["view_orders","عرض الطلبات"],["view_my_orders","طلباتي"],["update_order_status","تحديث حالة الطلب"],["manage_customers","إدارة العملاء"]] },
  { label: "الموارد البشرية والحضور", items: [["manage_hr","إدارة الموارد البشرية"],["view_hr","عرض الموارد البشرية"],["view_hr_reports","تقارير الموارد البشرية"],["manage_attendance","إدارة الحضور"],["view_attendance","عرض الحضور"],["view_attendance_reports","تقارير الحضور"],["manage_leaves","إدارة الإجازات"],["manage_training","إدارة التدريب"],["view_training","عرض التدريب"],["manage_negligence","إدارة الإهمال"],["manage_work_violations","إدارة مخالفات العمل"],["record_work_violations","تسجيل مخالفات العمل"],["view_work_violations","عرض مخالفات العمل"]] },
  { label: "التحليلات والعرض", items: [["view_dashboard","لوحة المتابعة"],["view_user_dashboard","لوحة المستخدم"],["view_home","الرئيسية"],["view_reports","التقارير"],["manage_analytics","التحليلات"],["view_financial_reports","التقارير المالية"],["manage_alerts","إدارة التنبيهات"],["view_alerts","عرض التنبيهات"],["view_notifications","الإشعارات"],["manage_display_screen","إدارة شاشة العرض"],["view_display_screen","عرض الشاشة"]] },
  { label: "الذكاء والتكاملات", items: [["manage_ai_agent","إدارة وكيل الذكاء"],["use_ai_agent","استخدام وكيل الذكاء"],["view_ai_agent","عرض وكيل الذكاء"],["manage_whatsapp","إدارة واتساب"],["manage_factory_simulation","إدارة محاكاة المصنع"],["view_factory_simulation","عرض محاكاة المصنع"],["view_tools","عرض الأدوات"],["view_legacy_database","عرض قاعدة البيانات القديمة"],["view_bag_configurator","مهيئ الأكياس"],["manage_master_batch","إدارة الماستر باتش"]] },
] as const;
const allPermissionLabels = new Map<string, string>(permissionGroups.flatMap((group) => group.items as readonly (readonly [string, string])[]));

const professionOptions = [
  "مدير",
  "مشرف",
  "موظف إداري",
  "محاسب",
  "مندوب مبيعات",
  "مشغل ماكينة",
  "فني صيانة",
  "فني كهرباء",
  "فني ميكانيكا",
  "مراقب جودة",
  "أمين مستودع",
  "عامل إنتاج",
  "سائق",
  "حارس أمن",
  "عامل نظافة",
  "أخرى",
] as const;

const nationalityOptions = [
  "سعودي",
  "مصري",
  "سوداني",
  "يمني",
  "هندي",
  "باكستاني",
  "بنغلاديشي",
  "نيبالي",
  "فلبيني",
  "سريلانكي",
  "أردني",
  "سوري",
  "أخرى",
] as const;

function UserModal({ row, user, onClose, onSaved }: { row: Row; user: Row; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Row>({ status: "active", include_in_attendance: true, must_change_password: false, is_system_user: false, ...row });
  const [roles, setRoles] = useState<Row[]>([]); const [sections, setSections] = useState<Row[]>([]); const [error, setError] = useState(""); const [lookupError, setLookupError] = useState(""); const [loadingLookups, setLoadingLookups] = useState(true); const [saving, setSaving] = useState(false); const [retryLookups, setRetryLookups] = useState(0);
  const isAdmin = can(user, ["admin"]);
  useEffect(() => {
    let active = true;
    setLoadingLookups(true);
    setLookupError("");
    Promise.all([list("/roles"), list("/sections")]).then(([r, s]) => {
      if (active) { setRoles(r); setSections(s); }
    }).catch((e) => { if (active) setLookupError(e.message); }).finally(() => { if (active) setLoadingLookups(false); });
    return () => { active = false; };
  }, [retryLookups]);
  const textFields = [["username","اسم المستخدم"],["display_name","الاسم بالإنجليزية"],["display_name_ar","الاسم بالعربية"],["phone","الهاتف"],["email","البريد الإلكتروني"],["national_id","رقم الهوية"]] as const;
  const save = async (event: FormEvent) => { event.preventDefault(); setError(""); if (lookupError || loadingLookups) return; setSaving(true); try {
    const body: Row = {};
    textFields.forEach(([key]) => { body[key] = key === "username" ? String(form[key] || "").trim() : form[key] || null; });
    body.profession = form.profession || null;
    body.nationality = form.nationality || null;
    body.birth_date = form.birth_date || null;
    body.service_start_date = form.service_start_date || null;
    body.status = form.status || "active";
    const validRole = roles.some((role) => String(role.id) === String(form.role_id));
    const currentRoleMissing = row.id && String(form.role_id ?? "") === String(row.role_id ?? "") && !validRole;
    if (!validRole && !currentRoleMissing) throw new Error(translate("اختر دوراً صالحاً من القائمة"));
    if (!currentRoleMissing) body.role_id = Number(form.role_id);
    const validSection = !form.section_id || sections.some((section) => String(section.id) === String(form.section_id));
    const currentSectionMissing = row.id && String(form.section_id ?? "") === String(row.section_id ?? "") && !validSection;
    if (!validSection && !currentSectionMissing) throw new Error(translate("اختر قسماً صالحاً من القائمة"));
    if (!currentSectionMissing) body.section_id = form.section_id || null;
    if (form.password) body.password = form.password;
    if (form.birth_date && Number.isNaN(Date.parse(`${form.birth_date}T00:00:00`))) throw new Error(translate("تاريخ الميلاد غير صالح"));
    if (form.service_start_date && Number.isNaN(Date.parse(`${form.service_start_date}T00:00:00`))) throw new Error(translate("تاريخ بدء الخدمة غير صالح"));
    if (form.birth_date && new Date(`${form.birth_date}T00:00:00`).getTime() > Date.now()) throw new Error(translate("تاريخ الميلاد لا يمكن أن يكون في المستقبل"));
    if (form.birth_date && form.service_start_date && form.service_start_date < form.birth_date) throw new Error(translate("تاريخ بدء الخدمة يجب أن يكون بعد تاريخ الميلاد"));
    body.must_change_password = Boolean(form.must_change_password);
    body.include_in_attendance = Boolean(form.include_in_attendance);
    if (isAdmin) body.is_system_user = Boolean(form.is_system_user);
    if (!row.id && !form.password) throw new Error(translate("كلمة المرور مطلوبة عند إنشاء مستخدم"));
    setSaving(true);
    await api(row.id ? `/users/${row.id}` : "/users", { method: row.id ? "PUT" : "POST", body: JSON.stringify(body) }); onSaved();
  } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  const roleName = (role: Row) => role.name_ar || role.name || String(role.id);
  const currentRoleUnavailable = Boolean(form.role_id) && !roles.some((role) => String(role.id) === String(form.role_id));
  const currentSectionUnavailable = Boolean(form.section_id) && !sections.some((section) => String(section.id) === String(form.section_id));
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}><form className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onSubmit={save}>
    <header><div><div className="eyebrow">{translate("ملف هوية وصلاحيات")}</div><h3 id="user-dialog-title">{row.id ? translate("تعديل مستخدم") : translate("إضافة مستخدم")}</h3></div><button aria-label={translate("إغلاق حوار المستخدم")} title={translate("إغلاق")} disabled={saving} type="button" className="btn btn-plain" onClick={onClose}><X /></button></header>
    {lookupError && <div className="error" role="alert" style={{ margin: 18 }}>{lookupError} <button type="button" className="btn btn-muted" onClick={() => setRetryLookups((attempt) => attempt + 1)}>{translate("إعادة تحميل الأدوار والأقسام")}</button></div>}
    {currentRoleUnavailable || currentSectionUnavailable ? <div className="tag" role="status" style={{ margin: 18 }}>{translate("توجد علاقة قديمة غير موجودة في القوائم؛ ستبقى كما هي ما لم تختر بديلاً صالحاً.")}</div> : null}
    {error && <div className="error" role="alert" style={{ margin: 18 }}>{error}</div>}<div className="form-grid">
      <div className="field"><label htmlFor="user-record-id">{translate("رقم المستخدم")}</label><input id="user-record-id" value={row.id ?? "يُولَّد تلقائيًا عند الحفظ"} disabled readOnly /></div>
      {textFields.map(([key, label]) => <div className="field" key={key}><label htmlFor={`user-${key}`}>{translate(label)}</label><input id={`user-${key}`} name={key} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} required={key === "username"} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>)}
      <div className="field"><label htmlFor="user-profession">{translate("المهنة")}</label><select id="user-profession" value={form.profession ?? ""} onChange={(e) => setForm({ ...form, profession: e.target.value })}><option value="">{translate("اختر المهنة")}</option>{form.profession && !professionOptions.includes(form.profession as typeof professionOptions[number]) && <option value={String(form.profession)}>{String(form.profession)}</option>}{professionOptions.map((profession) => <option key={profession} value={profession}>{translate(profession)}</option>)}</select></div>
      <div className="field"><label htmlFor="user-nationality">{translate("الجنسية")}</label><select id="user-nationality" value={form.nationality ?? ""} onChange={(e) => setForm({ ...form, nationality: e.target.value })}><option value="">{translate("اختر الجنسية")}</option>{form.nationality && !nationalityOptions.includes(form.nationality as typeof nationalityOptions[number]) && <option value={String(form.nationality)}>{String(form.nationality)}</option>}{nationalityOptions.map((nationality) => <option key={nationality} value={nationality}>{translate(nationality)}</option>)}</select></div>
      <div className="field"><label htmlFor="user-role">{translate("الدور")}</label><select id="user-role" required={!currentRoleUnavailable} value={form.role_id ?? ""} onChange={(e) => setForm({ ...form, role_id: e.target.value })}><option value="">{translate("اختر الدور")}</option>{roles.map((r) => <option key={r.id} value={r.id}>{roleName(r)}</option>)}{currentRoleUnavailable && <option value={form.role_id}>{translate("الدور الحالي المحفوظ (")}{form.role_id})</option>}</select></div>
      <div className="field"><label htmlFor="user-section">{translate("القسم")}</label><select id="user-section" value={form.section_id ?? ""} onChange={(e) => setForm({ ...form, section_id: e.target.value })}><option value="">{translate("بدون قسم")}</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name_ar || s.name || s.id}</option>)}{currentSectionUnavailable && <option value={form.section_id}>{translate("القسم الحالي المحفوظ (")}{form.section_id})</option>}</select></div>
      <div className="field"><label>{translate("حالة الحساب")}</label><select value={form.status ?? "active"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">{translate("نشط")}</option><option value="inactive">{translate("غير نشط")}</option></select></div>
      <div className="field"><label>{translate("تاريخ الميلاد")}</label><input type="date" value={form.birth_date ?? ""} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
      <div className="field"><label>{translate("تاريخ بدء الخدمة")}</label><input type="date" value={form.service_start_date ?? ""} onChange={(e) => setForm({ ...form, service_start_date: e.target.value })} /></div>
      <div className="field"><label>{translate("كلمة المرور")}{" "}{row.id && <small>{translate("(اختيارية عند التعديل)")}</small>}</label><input type="password" autoComplete="new-password" minLength={8} required={!row.id} value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div className="check-grid wide">{[["must_change_password","إجبار تغيير كلمة المرور"],["include_in_attendance","يظهر في الحضور"],...(isAdmin ? [["is_system_user","حساب نظام"] as const] : [])].map(([key,label]) => <label className="check-row" key={key}><input type="checkbox" checked={Boolean(form[key])} disabled={key === "is_system_user" && !isAdmin} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{translate(label)}</label>)}</div>
    </div><footer><button disabled={saving || loadingLookups || Boolean(lookupError)} className="btn btn-primary"><Check size={16} />{saving ? translate("جارٍ الحفظ…") : translate("حفظ المستخدم")}</button><button disabled={saving} type="button" className="btn btn-muted" onClick={onClose}>{translate("إلغاء")}</button></footer>
  </form></div>;
}

function UsersAdmin({ user, refreshToken = 0 }: { user: Row; refreshToken?: number }) {
  const [loadedRows, setRows] = useState<Row[]>([]); const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const [resultKey, setResultKey] = useState(""); const [busy, setBusy] = useState(true); const [edit, setEdit] = useState<Row | null>(null); const [error, setError] = useState("");
  const requestGate = useRef(createLatestRequestGate());
  const activeKey = `${search}|${page}|${refreshToken}`;
  const rows = resultKey === activeKey ? loadedRows : [];
  const requestBusy = busy || resultKey !== activeKey;
  const load = useCallback(() => {
    const request = requestGate.current.begin();
    const requestKey = activeKey;
    setBusy(true);
    setResultKey("");
    setError("");
    void runLatestRequest(requestGate.current, request, listPage("/users", search, page * LIST_PAGE_SIZE), {
      onSuccess: (value) => {
        setRows(value);
        setResultKey(requestKey);
      },
      onError: (requestError) => {
        setRows([]);
        setResultKey(requestKey);
        setError(requestError.message);
      },
      onSettled: () => setBusy(false),
    });
  }, [activeKey, page, search]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load]);
  const remove = async (row: Row) => { if (!confirm(translate("تأكيد حذف المستخدم؟"))) return; try { await api(`/users/${row.id}`, { method: "DELETE" }); latestLoad.current(); } catch (e) { setError((e as Error).message); } };
  const arabicName = (row: Row) => row.display_name_ar || row.full_name || row.display_name || "—";
  const englishName = (row: Row) => row.display_name || row.full_name || "—";
  return <>
    <div className="page-heading"><button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={17} />{" "}{translate("إضافة مستخدم")}</button></div>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="panel">
      <div className="panel-head">
        <div><h3>{translate("دليل المستخدمين")}</h3><small className="muted-text">{translate("بيانات الهوية، الدور، والقسم")}</small></div>
        <div className="tools"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="users-search">{translate("بحث في المستخدمين")}</label><input id="users-search" aria-label={translate("بحث بالاسم أو المستخدم")} className="search" placeholder={translate("بحث بالاسم أو المستخدم…")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setEdit(null); }} /></div>
      </div>
      {requestBusy ? <div style={{ padding: 20 }} aria-busy="true"><div className="skeleton" /></div> : <div className="table-wrap">
        <table className="users-table"><thead><tr><th>{translate("الاسم")}</th><th>{translate("اسم المستخدم")}</th><th>{translate("القسم")}</th><th>{translate("الدور")}</th><th>{translate("الهاتف")}</th><th>{translate("خيارات")}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{arabicName(r)}</strong><small className="cell-sub" dir="ltr">{englishName(r)}</small></td><td>{r.username || "—"}</td><td>{r.section_name_ar || r.section_name || "—"}</td><td>{r.role_name_ar || r.role_name || "—"}</td><td>{r.phone || "—"}</td><td><div className="actions"><button aria-label={translate("تعديل المستخدم")} className="btn btn-plain" title={translate("تعديل")} onClick={() => setEdit(r)}><Pencil size={16} /></button>{can(user, ["admin"]) && <button aria-label={translate("حذف المستخدم")} className="btn btn-plain" title={translate("حذف")} onClick={() => remove(r)}><Trash2 size={16} /></button>}</div></td></tr>)}</tbody>
        </table>
        <div className="mobile-cards user-cards">{rows.map((r) => <article className="entity-card" key={r.id}><strong>{arabicName(r)}</strong><small className="cell-sub" dir="ltr">{englishName(r)}</small><div className="card-line"><span>{translate("اسم المستخدم")}</span><b>{r.username || "—"}</b></div><div className="card-line"><span>{translate("القسم")}</span><b>{r.section_name_ar || r.section_name || "—"}</b></div><div className="card-line"><span>{translate("الدور")}</span><b>{r.role_name_ar || r.role_name || "—"}</b></div><div className="card-line"><span>{translate("الهاتف")}</span><b>{r.phone || "—"}</b></div><div className="actions"><button aria-label={translate("تعديل المستخدم")} className="btn btn-muted" onClick={() => setEdit(r)}><Pencil size={15} />{" "}{translate("تعديل")}</button>{can(user, ["admin"]) && <button aria-label={translate("حذف المستخدم")} className="btn btn-danger" onClick={() => remove(r)}><Trash2 size={15} />{" "}{translate("حذف")}</button>}</div></article>)}</div>
        {!rows.length && <div className="empty"><strong>{translate("لا توجد حسابات مطابقة")}</strong>{translate("أنشئ حساباً جديداً لبدء إدارة الوصول.")}</div>}
      </div>}
      {!requestBusy && (page > 0 || rows.length === LIST_PAGE_SIZE) && <nav className="list-pagination" aria-label={translate("صفحات المستخدمين")}><button className="btn btn-muted" type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{translate("السابق")}</button><span>{translate("صفحة")}{" "}{page + 1}</span><button className="btn btn-muted" type="button" disabled={rows.length < LIST_PAGE_SIZE} onClick={() => setPage((current) => current + 1)}>{translate("التالي")}</button></nav>}
    </section>
    {edit && <UserModal row={edit} user={user} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); latestLoad.current(); }} />}
  </>;
}

function RoleModal({ row, user, onClose, onSaved }: { row: Row; user: Row; onClose: () => void; onSaved: () => void }) {
  const existing: string[] = Array.isArray(row.permissions) ? row.permissions.map(String) : []; const [form, setForm] = useState<Row>({ ...row, permissions: existing, production_role_binding: row.production_role_binding ?? { mode: "general", stages: [] } }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const actorPermissions: string[] = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
  const isAdmin = can(user, ["admin"]);
  const canGrant = (permission: string) => isAdmin || (permission !== "admin" && (actorPermissions.includes("*") || actorPermissions.includes(permission)));
  const toggle = (value: string) => {
    if (!canGrant(value)) return;
    const permissions: string[] = form.permissions;
    if (value === "admin" && !window.confirm(translate("تغيير صلاحية مدير النظام قد يمنح وصولاً كاملاً للنظام أو يزيله. هل تريد المتابعة؟"))) return;
    setForm({ ...form, permissions: permissions.includes(value) ? permissions.filter((p) => p !== value) : [...permissions, value] });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!String(form.name || "").trim()) { setError(translate("اسم الدور مطلوب")); return; }
    const newlyGranted = form.permissions.filter((permission: string) => !existing.includes(permission));
    if (newlyGranted.some((permission: string) => !canGrant(permission))) { setError(translate("لا يمكنك منح صلاحيات لا تملكها")); return; }
    setSaving(true); setError("");
    try { await api(row.id ? `/roles/${row.id}` : "/roles", { method: row.id ? "PUT" : "POST", body: JSON.stringify({ name: String(form.name).trim(), name_ar: form.name_ar || null, permissions: form.permissions, production_role_binding: form.production_role_binding }) }); onSaved(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [saving, onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
    <form className="modal role-modal" role="dialog" aria-modal="true" aria-labelledby="role-dialog-title" onSubmit={save}>
      <header><div><div className="eyebrow">{translate("سياسة الوصول")}</div><h3 id="role-dialog-title">{row.id ? translate("تعديل دور") : translate("إضافة دور")}</h3></div><button aria-label={translate("إغلاق حوار الدور")} title={translate("إغلاق")} disabled={saving} type="button" className="btn btn-plain" onClick={onClose}><X /></button></header>
      {error && <div className="error" role="alert" style={{ margin: 18 }}>{error}</div>}
      <div className="role-head form-grid">
        <div className="field"><label htmlFor="role-record-id">{translate("رقم الدور")}</label><input id="role-record-id" value={row.id ?? "يُولَّد تلقائيًا عند الحفظ"} disabled readOnly /></div>
        <div className="field"><label htmlFor="role-name">{translate("اسم الدور بالإنجليزية")}</label><input id="role-name" required value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="role-name-ar">{translate("اسم الدور بالعربية")}</label><input id="role-name-ar" value={form.name_ar ?? ""} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
      </div>
      <ProductionRoleBindingFields value={form.production_role_binding} disabled={saving}
        onChange={production_role_binding => setForm({ ...form, production_role_binding })} />
      <div className="permission-summary"><KeyRound size={17} /> <strong>{form.permissions.length}</strong>{" "}{translate("صلاحية محددة")}{" "}<span>{translate("الصلاحيات التي لا تملكها محفوظة دون تغيير؛ منح صلاحية مدير النظام يتطلب تأكيداً صريحاً من مدير النظام.")}</span></div>
      <div className="permission-groups">
        {permissionGroups.map((group) => {
          const bulkKeys: string[] = group.items.map(([key]) => key).filter((key) => key !== "admin" && canGrant(key));
          const selected = bulkKeys.filter((key) => form.permissions.includes(key)).length;
          return <section className="permission-group" key={group.label}>
            <div className="permission-group-head">
              <strong>{translate(group.label)}</strong>
              {bulkKeys.length > 0 && <button type="button" className="text-button" onClick={() => setForm({ ...form, permissions: selected === bulkKeys.length ? form.permissions.filter((p: string) => !bulkKeys.includes(p)) : Array.from(new Set([...form.permissions, ...bulkKeys])) })}>{selected === bulkKeys.length ? translate("إلغاء تحديد الكل") : translate("تحديد الكل")}</button>}
              <span>{selected}/{bulkKeys.length}{" "}{translate("متاحة")}</span>
            </div>
            {"description" in group && <p className="permission-group-description">{translate(group.description)}</p>}
            <div className="permission-grid">{group.items.map(([key, label]) => <label className={`permission ${form.permissions.includes(key) ? "selected" : ""}`} key={key}>
              <input type="checkbox" checked={form.permissions.includes(key)} disabled={!canGrant(key)} aria-describedby={finishedGoodsPermissionDescriptions[key] ? `permission-description-${key}` : undefined} onChange={() => toggle(key)} />
              <span>{translate(label)}{key === "admin" ? translate(" (تأكيد مطلوب)") : ""}
                {finishedGoodsPermissionDescriptions[key] && <small id={`permission-description-${key}`}>{translate(finishedGoodsPermissionDescriptions[key])}</small>}
              </span>
            </label>)}</div>
          </section>;
        })}
        {existing.filter((p: string) => !allPermissionLabels.has(p)).length > 0 && <div className="unknown-permissions"><strong>{translate("صلاحيات محفوظة أخرى")}</strong><div>{existing.filter((p: string) => !allPermissionLabels.has(p)).map((p: string) => <span className="tag" key={p}>{p}</span>)}</div></div>}
      </div>
      <footer><button disabled={saving} className="btn btn-primary"><Check size={16} />{saving ? translate("جارٍ الحفظ…") : translate("حفظ الدور")}</button><button disabled={saving} type="button" className="btn btn-muted" onClick={onClose}>{translate("إلغاء")}</button></footer>
    </form>
  </div>;
}

function RolesAdmin({ user, refreshToken = 0 }: { user: Row; refreshToken?: number }) {
  const [rows, setRows] = useState<Row[]>([]); const [edit, setEdit] = useState<Row | null>(null); const [error, setError] = useState("");
  const writable = can(user, configs.roles.write);
  const deletable = can(user, configs.roles.del || ["admin"]);
  const requestGate = useRef(createLatestRequestGate());
  const load = useCallback(() => {
    const request = requestGate.current.begin();
    setError("");
    list("/roles").then((value) => {
      if (requestGate.current.isCurrent(request)) setRows(value);
    }).catch((e) => {
      if (requestGate.current.isCurrent(request)) setError(e.message);
    });
  }, []);
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load, refreshToken]);
  const remove = async (r: Row) => { if (!deletable || !confirm(translate("تأكيد حذف الدور؟"))) return; try { await api(`/roles/${r.id}`, { method: "DELETE" }); load(); } catch (e) { setError((e as Error).message); } };
  return <>{writable && <div className="page-heading"><button className="btn btn-primary" onClick={() => setEdit({ permissions: [] })}><Plus size={17} />{" "}{translate("إضافة دور")}</button></div>}{error && <div className="error" role="alert">{error}</div>}<div className="role-cards">{rows.map((r) => <article className="role-card" key={r.id}><div className="role-icon"><Shield size={19} /></div><div className="role-card-main"><strong>{localizedName(r.name_ar, r.name, String(r.id))}</strong><span className="cell-sub">{localizedName("", r.name, "")}</span><div className="role-count">{Array.isArray(r.permissions) ? r.permissions.length : 0}{" "}{translate("صلاحية")}</div></div><div className="actions">{writable && <button aria-label={`${translate("تعديل")} ${translate("دور")} ${localizedName(r.name_ar, r.name, String(r.id))}`} title={translate("تعديل")} className="btn btn-plain" onClick={() => setEdit(r)}><Pencil size={16} /></button>}{deletable && <button aria-label={`${translate("حذف")} ${translate("دور")} ${localizedName(r.name_ar, r.name, String(r.id))}`} title={translate("حذف")} className="btn btn-plain" onClick={() => remove(r)}><Trash2 size={16} /></button>}</div></article>)}{!rows.length && <div className="empty panel"><strong>{translate("لا توجد أدوار")}</strong>{writable ? translate("أنشئ أول سياسة وصول للنظام.") : translate("لا توجد أدوار مسجلة.")}</div>}</div>{edit && writable && <RoleModal row={edit} user={user} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}</>;
}

function SettingsAdmin({ refreshToken = 0 }: { refreshToken?: number }) {
  const [profile, setProfile] = useState<Row>({
    name: "",
    name_ar: "",
    tax_number: "",
    phone: "",
    email: "",
    address: "",
    default_language: "ar",
    working_hours_per_day: 8,
  });
  const [settings, setSettings] = useState<Row[]>([]);
  const [operations, setOperations] = useState<Row>({
    timezone: "Asia/Riyadh",
    overtime_factor: "1.50",
    weekly_holiday_day: "friday",
    enable_holiday_overtime: "true",
  });
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const languageOptions = [
    { value: "ar", label: "العربية" },
    { value: "en", label: "English" },
  ];
  const timezoneOptions = ["Asia/Riyadh", "UTC", "Asia/Dubai", "Africa/Cairo"];
  const overtimeFactorOptions = ["1.25", "1.50", "1.75", "2.00"];
  const weeklyHolidayOptions = [
    { value: "sunday", label: "الأحد" },
    { value: "monday", label: "الاثنين" },
    { value: "tuesday", label: "الثلاثاء" },
    { value: "wednesday", label: "الأربعاء" },
    { value: "thursday", label: "الخميس" },
    { value: "friday", label: "الجمعة" },
    { value: "saturday", label: "السبت" },
  ];

  const settingsByKey = useMemo(
    () => Object.fromEntries(settings.map((row) => [String(row.setting_key), row])),
    [settings],
  );

  const parseBoolean = (value: unknown, fallback = false) => {
    if (value === undefined || value === null || value === "") return fallback;
    return String(value).toLowerCase() === "true";
  };

  const getSettingValue = (key: string, fallback = "") => {
    const value = settingsByKey[key]?.setting_value;
    if (value === undefined || value === null || value === "") return fallback;
    return String(value);
  };

  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([api("/company-profile"), list("/system-settings")])
      .then(([company, sys]) => {
        if (!active) return;
        const loadedProfile = company || {};
        setSettings(Array.isArray(sys) ? sys : []);
        setProfile({
          name: loadedProfile.name ?? "",
          name_ar: loadedProfile.name_ar ?? "",
          tax_number: loadedProfile.tax_number ?? "",
          phone: loadedProfile.phone ?? "",
          email: loadedProfile.email ?? "",
          address: loadedProfile.address ?? "",
          default_language: loadedProfile.default_language ?? "ar",
          working_hours_per_day: Number(loadedProfile.working_hours_per_day ?? 8) || 8,
        });
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refreshToken]);

  useEffect(() => {
    if (!settings.length) return;
    setOperations({
      timezone: getSettingValue("factory_timezone", "Asia/Riyadh"),
      overtime_factor: getSettingValue("overtime_factor", "1.50"),
      weekly_holiday_day: getSettingValue("weekly_holiday_day", "friday"),
      enable_holiday_overtime: getSettingValue("enable_holiday_overtime", "true"),
    });
    setLogoDataUrl(getSettingValue("company_logo_data_url", ""));
    setLogoFileName(getSettingValue("company_logo_file_name", ""));
  }, [settingsByKey]);

  const upsertSetting = async (key: string, value: string, type: string, description: string) => {
    let existing = settingsByKey[key];
    if (!existing) {
      const candidates = await list("/system-settings", key);
      if (Array.isArray(candidates)) {
        const matchingSetting = candidates.find((row) => String(row.setting_key) === key);
        if (matchingSetting) existing = matchingSetting;
      }
    }
    if (existing?.id) {
      await api(`/system-settings/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ setting_value: value }),
      });
      return;
    }
    await api("/system-settings", {
      method: "POST",
      body: JSON.stringify({
        setting_key: key,
        setting_value: value,
        setting_type: type,
        description,
        is_editable: true,
      }),
    });
  };

  const saveCompanyAndOperations = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved("");
    try {
      if (!String(profile.name || "").trim()) throw new Error("اسم الشركة مطلوب");
      await api("/company-profile", {
        method: "PUT",
        body: JSON.stringify({
          name: String(profile.name).trim(),
          name_ar: profile.name_ar || null,
          tax_number: profile.tax_number || null,
          phone: profile.phone || null,
          email: profile.email || null,
          address: profile.address || null,
          default_language: profile.default_language || "ar",
          working_hours_per_day: Number(profile.working_hours_per_day) || 8,
        }),
      });

      await upsertSetting("factory_timezone", String(operations.timezone || "Asia/Riyadh"), "string", "المنطقة الزمنية للمصنع");
      await upsertSetting("overtime_factor", String(operations.overtime_factor || "1.50"), "number", "معامل ساعة العمل الإضافي");
      await upsertSetting("weekly_holiday_day", String(operations.weekly_holiday_day || "friday"), "string", "يوم العطلة الأسبوعي");
      await upsertSetting("enable_holiday_overtime", String(parseBoolean(operations.enable_holiday_overtime, true)), "boolean", "تفعيل احتساب إضافي في يوم العطلة");
      await upsertSetting("company_logo_data_url", logoDataUrl || "", "string", "ملف شعار الشركة المرفوع");
      await upsertSetting("company_logo_file_name", logoFileName || "", "string", "اسم ملف شعار الشركة");

      setSettings(await list("/system-settings"));
      setSaved(translate("تم حفظ هوية المصنع وإعدادات التشغيل"));
      window.dispatchEvent(new Event("branding:updated"));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onLogoFileChange = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(translate("ملف الشعار يجب أن يكون صورة"));
      return;
    }
    if (file.size > 1_500_000) {
      setError(translate("حجم الشعار كبير. الحد الأقصى 1.5MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(String(reader.result || ""));
      setLogoFileName(file.name);
      setError("");
    };
    reader.onerror = () => setError(translate("تعذر قراءة ملف الشعار"));
    reader.readAsDataURL(file);
  };

  return (
    <div className="settings-layout">
      <div aria-live="polite">
        {error && <div className="error" role="alert">{error}</div>}
        {saved && <div className="success"><Check size={16} />{saved}</div>}
      </div>
      <section className="panel settings-section">
        <div className="panel-head">
          <div>
            <div className="eyebrow">{translate("هوية المصنع وتشغيل النظام")}</div>
            <h3>{translate("الإعدادات الأساسية")}</h3>
          </div>
          <Building2 size={21} color="var(--orange)" />
        </div>
        <form className="form-grid" onSubmit={saveCompanyAndOperations}>
          <div className="field">
            <label htmlFor="profile-name-ar">{translate("اسم الشركة بالعربية")}</label>
            <input id="profile-name-ar" value={profile.name_ar ?? ""} onChange={(e) => setProfile({ ...profile, name_ar: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-name">{translate("اسم الشركة بالإنجليزية")}</label>
            <input id="profile-name" required value={profile.name ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-tax">{translate("الرقم الضريبي")}</label>
            <input id="profile-tax" value={profile.tax_number ?? ""} onChange={(e) => setProfile({ ...profile, tax_number: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-phone">{translate("الهاتف")}</label>
            <input id="profile-phone" type="tel" value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-email">{translate("البريد الإلكتروني")}</label>
            <input id="profile-email" type="email" value={profile.email ?? ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div className="field wide">
            <label htmlFor="profile-address">{translate("العنوان")}</label>
            <textarea id="profile-address" value={profile.address ?? ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
          </div>
          <div className="field wide">
            <label htmlFor="profile-logo-file">{translate("شعار الشركة (رفع ملف)")}</label>
            <input id="profile-logo-file" type="file" accept="image/*" onChange={onLogoFileChange} />
            {logoFileName && <small className="cell-sub">{translate("الملف الحالي:")}{" "}{logoFileName}</small>}
            {logoDataUrl && <img src={logoDataUrl} alt={translate("شعار الشركة")} style={{ marginTop: 8, maxHeight: 72, borderRadius: 8, border: "1px solid var(--line)" }} />}
          </div>
          <div className="field">
            <label htmlFor="default-language">{translate("اللغة الافتراضية")}</label>
            <select id="default-language" value={profile.default_language ?? "ar"} onChange={(e) => setProfile({ ...profile, default_language: e.target.value })}>
              {languageOptions.map((option) => <option key={option.value} value={option.value}>{translate(option.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="factory-timezone">{translate("المنطقة الزمنية")}</label>
            <select id="factory-timezone" value={operations.timezone} onChange={(e) => setOperations({ ...operations, timezone: e.target.value })}>
              {timezoneOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="work-hours-day">{translate("ساعات العمل اليومية")}</label>
            <select id="work-hours-day" value={String(profile.working_hours_per_day ?? 8)} onChange={(e) => setProfile({ ...profile, working_hours_per_day: Number(e.target.value) })}>
              {[6, 7, 8, 9, 10, 12].map((hours) => <option key={hours} value={hours}>{hours}{" "}{translate("ساعة")}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="overtime-factor">{translate("معامل ساعة الإضافي")}</label>
            <select id="overtime-factor" value={operations.overtime_factor} onChange={(e) => setOperations({ ...operations, overtime_factor: e.target.value })}>
              {overtimeFactorOptions.map((factor) => <option key={factor} value={factor}>{factor}x</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="holiday-day">{translate("يوم العطلة الأسبوعي")}</label>
            <select id="holiday-day" value={operations.weekly_holiday_day} onChange={(e) => setOperations({ ...operations, weekly_holiday_day: e.target.value })}>
              {weeklyHolidayOptions.map((day) => <option key={day.value} value={day.value}>{translate(day.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="holiday-overtime">{translate("احتساب إضافي في يوم العطلة")}</label>
            <select id="holiday-overtime" value={String(operations.enable_holiday_overtime)} onChange={(e) => setOperations({ ...operations, enable_holiday_overtime: e.target.value })}>
              <option value="true">{translate("مفعل")}</option>
              <option value="false">{translate("غير مفعل")}</option>
            </select>
          </div>
          <div className="wide">
            <button className="btn btn-primary">{translate("حفظ الإعدادات الأساسية")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}


function Admin({ user }: { user: Row }) {
  const tabs = [["users", "المستخدمون", Users, ["manage_users", "admin"]], ["roles", "الأدوار والصلاحيات", KeyRound, ["manage_roles", "admin"]], ["sections", "الأقسام", Boxes, ["manage_sections", "admin"]], ["machines", "الماكينات", Cog, ["manage_machines", "admin"]], ["components", "مكونات الصيانة", Wrench, ["manage_maintenance", "admin"]], ["categories", "التصنيفات", Boxes, configs.categories.read], ["items", "الأصناف", Package, configs.items.read], ["colors", "ألوان الماستر باتش", Cog, configs.colors.read], ["settings", "إعدادات المصنع", Settings2, ["manage_settings", "admin"]]] as const;
  const visibleTabs = tabs.filter(([, , , permissions]) => can(user, permissions));
  const [tab, setTab] = useState(visibleTabs[0]?.[0] || "users");
  const [refreshToken, setRefreshToken] = useState(0);
  // Each tab starts with page 0 and an empty search; EntityPage clears categoryId outside items.
  return <><PageHero kicker="مركز الإدارة · صلاحياتك مفعلة" title={translate("الإدارة")} description="إدارة الهوية والأصول والتعريفات من مساحة واحدة منظمة." onRefresh={() => setRefreshToken((token) => token + 1)} actions={<span className="tag"><Shield size={16} /> ADMIN / CORE</span>} /><div className="admin-tabs" role="tablist">{visibleTabs.map(([key, label, Icon]) => <button id={`admin-tab-${key}`} aria-controls={`admin-panel-${key}`} role="tab" aria-selected={tab === key} key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={17} />{translate(label)}</button>)}</div><div id={`admin-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`} style={{ marginTop: 24 }}>{tab === "users" ? <UsersAdmin user={user} refreshToken={refreshToken} /> : tab === "roles" ? <RolesAdmin user={user} refreshToken={refreshToken} /> : tab === "settings" ? <SettingsAdmin refreshToken={refreshToken} /> : <EntityPage key={tab} kind={tab} user={user} refreshToken={refreshToken} showHero={false} />}</div></>;
}

function OrdersPage({ user }: { user: Row }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshToken, setRefreshToken] = useState(0);
  const permissions: string[] = Array.isArray(user.permissions) ? user.permissions : [];
  const tabs = availableOrderTabs(permissions);
  const tab = selectedOrderTab(searchParams.get("tab"), permissions);
  const selectTab = (next: OrderPageTab) => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (next === "production") updated.set("tab", "production");
      else updated.delete("tab");
      return updated;
    });
  };

  if (!tab) return <div className="error" role="alert">{translate("لا تملك صلاحية عرض الطلبات أو أوامر الإنتاج.")}</div>;
  return <>
    <PageHero kicker="متابعة الطلبات" title={translate("الطلبات")} description="الطلبات وأوامر الإنتاج في صفحة واحدة." onRefresh={() => setRefreshToken((token) => token + 1)} />
    <div className="customer-tabs" role="tablist" aria-label={translate("أقسام الطلبات")}>
      {tabs.includes("orders") && <button id="orders-tab-orders" type="button" role="tab" aria-controls="orders-panel-orders" aria-selected={tab === "orders"} className={tab === "orders" ? "active" : ""} onClick={() => selectTab("orders")}><FileText size={17} />{" "}{translate("الطلبات")}</button>}
      {tabs.includes("production") && <button id="orders-tab-production" type="button" role="tab" aria-controls="orders-panel-production" aria-selected={tab === "production"} className={tab === "production" ? "active" : ""} onClick={() => selectTab("production")}><Factory size={17} />{" "}{translate("أوامر الإنتاج")}</button>}
    </div>
    <div id={`orders-panel-${tab}`} role="tabpanel" aria-labelledby={`orders-tab-${tab}`}>
      <EntityPage key={tab} kind={tab} user={user} refreshToken={refreshToken} showHero={false} />
    </div>
  </>;
}

function CustomersPage({ user }: { user: Row }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshToken, setRefreshToken] = useState(0);
  const tab = searchParams.get("tab") === "products" ? "products" : "customers";
  const selectTab = (next: "customers" | "products") => {
    setSearchParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (next === "products") updated.set("tab", "products");
      else updated.delete("tab");
      return updated;
    });
  };

  return <>
    <PageHero kicker="سجل العملاء" title={translate("العملاء")} description="إدارة العملاء ومنتجاتهم من صفحة واحدة." onRefresh={() => setRefreshToken((token) => token + 1)} />
    <div className="customer-tabs" role="tablist" aria-label={translate("أقسام العملاء")}>
      <button id="customer-tab-customers" type="button" role="tab" aria-controls="customer-panel-customers" aria-selected={tab === "customers"} className={tab === "customers" ? "active" : ""} onClick={() => selectTab("customers")}><Users size={17} />{" "}{translate("العملاء")}</button>
      <button id="customer-tab-products" type="button" role="tab" aria-controls="customer-panel-products" aria-selected={tab === "products"} className={tab === "products" ? "active" : ""} onClick={() => selectTab("products")}><Boxes size={17} />{" "}{translate("منتجات العملاء")}</button>
    </div>
    <div id={`customer-panel-${tab}`} role="tabpanel" aria-labelledby={`customer-tab-${tab}`}>
      <EntityPage key={tab} kind={tab} user={user} refreshToken={refreshToken} showHero={false} />
    </div>
  </>;
}

function CustomerDetail({ user }: { user: Row }) {
  const [, params] = useRoute("/customers/:id");
  const [location, setLocation] = useLocation();
  const [loadedCustomer, setCustomer] = useState<Row | null>(null);
  const [loadedProducts, setProducts] = useState<Row[]>([]);
  const [loadedCustomerId, setLoadedCustomerId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Row | null>(null);
  const [errorState, setError] = useState("");
  const [loadingState, setLoading] = useState(true);
  const customerId = params?.id || "";
  const customerIdRef = useRef(customerId);
  customerIdRef.current = customerId;
  const requestGate = useRef(createLatestRequestGate());
  const sourceCustomer = loadedCustomerId === customerId ? loadedCustomer : null;
  const customer: Row | null = sourceCustomer ? {
    ...sourceCustomer,
    name_ar: localizedName(sourceCustomer.name_ar, sourceCustomer.name),
    name: localizedName(sourceCustomer.name_ar, sourceCustomer.name),
    sales_rep_name_ar: localizedName(sourceCustomer.sales_rep_name_ar, sourceCustomer.sales_rep_name),
    sales_rep_name: localizedName(sourceCustomer.sales_rep_name_ar, sourceCustomer.sales_rep_name),
  } : null;
  const sortedProducts = useMemo(() =>
    sortCustomerProductsByCategory<Row>(loadedProducts, normalizeLanguage(i18n.language))
      .map<Row>((product, index) => ({ ...product, __sequence: index + 1 })),
  [loadedProducts, i18n.language]);
  const products = loadedCustomerId === customerId ? sortedProducts : [];
  const error = loadedCustomerId === customerId ? errorState : "";
  const loading = loadedCustomerId !== customerId || loadingState;
  const productConfig: Config = { ...localizeConfig(configs.products), lockedFields: ["customer_id"] };
  const load = useCallback(() => {
    const requestedCustomerId = customerId;
    if (customerIdRef.current !== requestedCustomerId) return;
    const request = requestGate.current.begin();
    setLoading(true);
    setError("");
    setLoadedCustomerId(null);
    setCustomer(null);
    setProducts([]);
    setEditingProduct(null);
    api(`/customers/${encodeURIComponent(requestedCustomerId)}/detail`).then((data) => {
      if (!requestGate.current.isCurrent(request) || customerIdRef.current !== requestedCustomerId) return;
      setCustomer(data.customer || null);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setLoadedCustomerId(requestedCustomerId);
    }).catch((err) => {
      if (!requestGate.current.isCurrent(request) || customerIdRef.current !== requestedCustomerId) return;
      setCustomer(null);
      setProducts([]);
      setLoadedCustomerId(requestedCustomerId);
      setError(err.message);
    }).finally(() => {
      if (requestGate.current.isCurrent(request) && customerIdRef.current === requestedCustomerId) setLoading(false);
    });
  }, [customerId]);
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load]);
  const back = () => window.history.length > 1 ? window.history.back() : setLocation("/customers");
  const writable = can(user, configs.products.write);
  const productColumns = (configs.products.columns || []).filter((column) => column.key !== "customer_name_ar").map((column) => ({ ...column, label: translate(column.label) }));
  const productColumnClass = (field: Column) => [field.priority ? "priority-column" : "", field.compact ? `compact-${field.compact}` : "", field.centered ? "centered-column" : "", field.width ? `column-${field.width}` : ""].filter(Boolean).join(" ");
  const renderProductCell = (row: Row, field: Column) => field.colorKey ? <span className="color-stack"><MasterBatchSwatch color={{ color_hex: row[field.colorKey], name_ar: row[`${field.key}_name_ar`], name: row[`${field.key}_name`], id: row[`${field.key}_id`] }} size={22} /><span>{displayValue(row, field)}</span></span> : field.kind === "color" ? <span className="color-cell"><MasterBatchSwatch color={{ ...row, color_hex: row[field.key] }} size={20} />{row[field.key] || "—"}</span> : field.kind === "status" ? <span className={`tag ${!dictionaries[row[field.key]] ? "neutral" : ""}`}>{displayValue(row, field)}</span> : field.secondaryKey || field.secondaryRelation ? <><strong>{displayValue(row, field)}</strong><small className="cell-sub">{secondaryValue(row, field)}</small></> : displayValue(row, field);
  const cloneProduct = (product: Row) => { const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...copy } = product; if (customer) setEditingProduct({ ...copy, customer_id: customer.id, __clone_source_id: product.id }); };
  return <><PageHero kicker="ملف العميل" title={customer ? customer.name_ar || customer.name || customer.id : translate("تفاصيل العميل")} description={customer?.name || (loading ? "جارٍ تحميل بيانات العميل…" : "بيانات العميل ومنتجاته المسجلة.")} onRefresh={load} refreshing={loading} actions={<button className="btn btn-muted" onClick={back}><ArrowRight size={17} />{" "}{translate("رجوع إلى العملاء")}</button>} />{error && <div className="error" role="alert">{error}</div>}{loading ? <div style={{ padding: 20 }} aria-busy="true"><div className="skeleton" /></div> : !customer ? null : <><div className="page-heading customer-detail-heading">{writable && <button className="btn btn-primary" onClick={() => setEditingProduct({ customer_id: customer.id, status: "active" })}><Plus size={17} />{" "}{translate("إضافة منتج")}</button>}</div><section className="panel customer-summary"><div><span>{translate("رمز العميل")}</span><strong>{customer.id || "—"}</strong></div><div><span>{translate("رقم الدرج")}</span><strong>{customer.plate_drawer_code || "—"}</strong></div><div><span>{translate("المندوب")}</span><strong>{customer.sales_rep_name_ar || customer.sales_rep_name || "—"}</strong></div><div><span>{translate("الهاتف")}</span><strong>{customer.phone || "—"}</strong></div><div><span>{translate("المدينة")}</span><strong>{customer.city || "—"}</strong></div><div><span>{translate("الرقم الضريبي")}</span><strong>{customer.tax_number || "—"}</strong></div></section><section className="panel"><div className="panel-head"><div><h3>{translate("منتجات العميل")}</h3><small className="muted-text">{products.length}{" "}{translate("منتج مسجل")}</small></div></div>{products.length === 0 ? <div className="empty"><strong>{translate("لا توجد منتجات لهذا العميل")}</strong>{translate("أضف أول منتج من الزر أعلاه.")}</div> : <div className="table-wrap"><table><thead><tr>{productColumns.map((field) => <th className={productColumnClass(field)} key={field.key}>{field.label}</th>)}{writable && <th>{translate("إجراء")}</th>}</tr></thead><tbody>{products.map((product) => <tr key={product.id}>{productColumns.map((field) => <td className={productColumnClass(field)} title={displayValue(product, field)} key={field.key}>{renderProductCell(product, field)}</td>)}{writable && <td><div className="actions"><button aria-label={translate("تعديل المنتج")} title={translate("تعديل المنتج")} className="btn btn-plain" onClick={() => setEditingProduct(product)}><Pencil size={16} /></button><button aria-label={translate("استنساخ المنتج")} title={translate("استنساخ المنتج")} className="btn btn-plain" onClick={() => cloneProduct(product)}><Copy size={16} /></button></div></td>}</tr>)}</tbody></table><div className="mobile-cards">{products.map((product) => { const primary = productColumns.find((column) => column.priority) || productColumns[0]; const subtitle = primary.secondaryKey || primary.secondaryRelation ? null : productColumns.find((column) => column !== primary && column.kind === "relation"); return <article className="entity-card" key={product.id}><strong>{renderProductCell(product, primary)}</strong><small>{primary.secondaryKey || primary.secondaryRelation ? secondaryValue(product, primary) : displayValue(product, subtitle || productColumns.find((column) => column !== primary) || primary)}</small>{productColumns.filter((column) => column !== primary && column !== subtitle).slice(0, configs.products.mobileColumnLimit ?? 4).map((field) => <div className="card-line" key={field.key}><span>{field.label}</span><b>{renderProductCell(product, field)}</b></div>)}{writable && <div className="actions"><button className="btn btn-muted" onClick={() => setEditingProduct(product)}><Pencil size={15} />{" "}{translate("تعديل")}</button><button className="btn btn-muted" onClick={() => cloneProduct(product)}><Copy size={15} />{" "}{translate("استنساخ")}</button></div>}</article>; })}</div></div>}</section>{editingProduct && <EntityModal cfg={productConfig} row={editingProduct} onClose={() => setEditingProduct(null)} onSaved={() => { setEditingProduct(null); load(); }} />}</>}</>;
}

function App() {
  useTranslation();
  const [publicPrintMatch, publicPrintParams] = useRoute("/shared/orders/:id/print");
  const [routeSearchParams] = useSearchParams();
  const publicPrintAccess = Boolean(publicPrintMatch && publicPrintParams);
  const auth = useAuth(!publicPrintAccess);
  const { branding, ready: brandingReady } = useBranding();
  const [languageReady, setLanguageReady] = useState(false);
  const [printMatch, printParams] = useRoute("/orders/:id/print");
  const effectiveLanguage = publicPrintAccess
    ? branding.defaultLanguage
    : normalizeLanguage(auth.user?.preferred_language, branding.defaultLanguage);
  useEffect(() => {
    if (!brandingReady || (!publicPrintAccess && auth.loading)) return;
    void i18n.changeLanguage(effectiveLanguage).then(() => {
      applyLanguage(effectiveLanguage);
      setLanguageReady(true);
    });
  }, [auth.loading, auth.user?.preferred_language, brandingReady, branding.defaultLanguage, effectiveLanguage, publicPrintAccess]);
  if (publicPrintAccess && publicPrintParams) {
    if (!brandingReady || !languageReady) return <div className="login-page"><div className="login-box"><div className="skeleton" style={{ width: 220, height: 28 }} /></div></div>;
    return <DeferredContent><OrderPrintPage id={publicPrintParams.id} branding={branding} publicAccess publicKey={routeSearchParams.get("key") ?? ""} /></DeferredContent>;
  }
  if (auth.loading || !brandingReady || !languageReady) return <div className="login-page"><div className="login-box"><div className="skeleton" style={{ width: 220, height: 28 }} /></div></div>;
  if (!auth.user) return <Login onLogin={auth.setUser} branding={branding} />;
  if (auth.user.must_change_password) return <PasswordChange user={auth.user} onComplete={auth.setUser} setUser={auth.setUser} defaultLanguage={branding.defaultLanguage} />;
  if (printMatch && printParams) {
    return can(auth.user, configs.orders.read)
      ? <DeferredContent><OrderPrintPage id={printParams.id} branding={branding} /></DeferredContent>
      : <div className="empty" role="alert"><strong>{translate("لا تملك صلاحية عرض أو طباعة الطلب")}</strong><Link className="btn btn-muted" href="/">{translate("العودة للرئيسية")}</Link></div>;
  }
  const isAdmin = can(auth.user, ["admin"]);
  const productionUser = { id: Number(auth.user.id), permissions: auth.user.permissions ?? [],
    production_role_binding: auth.user.production_role_binding };
  const productionHome = initialProductionPath(productionUser);
  const warehouseHome = initialWarehousePath(productionUser);
  return <Layout user={auth.user} setUser={auth.setUser} branding={branding}><DeferredContent><Switch>
    <Route path="/">{isAdmin ? <Dashboard user={auth.user} /> : <UserDashboard user={auth.user} />}</Route>
    <Route path="/my-dashboard"><UserDashboard user={auth.user} /></Route>
    <Route path="/hr"><HumanResources canReviewRequests={can(auth.user, ["admin"])} /></Route>
    <Route path="/customers/:id"><CustomerDetail user={auth.user} /></Route>
    <Route path="/customers"><CustomersPage user={auth.user} /></Route>
    <Route path="/products"><Redirect to="/customers?tab=products" replace /></Route>
    <Route path="/orders"><OrdersPage user={auth.user} /></Route>
    <Route path="/production/rolls/:id">{params => !productionHome && warehouseHome ? <Redirect to={`/warehouse/rolls/${params.id}`} replace /> : <ProductionPage user={productionUser} view="roll" rollId={params.id} />}</Route>
    <Route path="/production/film"><ProductionPage user={productionUser} view="film" /></Route>
    <Route path="/production/printing"><ProductionPage user={productionUser} view="printing" /></Route>
    <Route path="/production/cutting"><ProductionPage user={productionUser} view="cutting" /></Route>
    <Route path="/production/mixing"><RawMixingPage user={productionUser} /></Route>
    <Route path="/production/monitoring"><ProductionMonitoringPage user={productionUser} /></Route>
    <Route path="/warehouse/raw-materials"><RawInventoryPage user={productionUser} /></Route>
    <Route path="/production/hall"><Redirect to="/warehouse/hall" replace /></Route>
    <Route path="/production/warehouse"><Redirect to="/warehouse/finished-inventory" replace /></Route>
    <Route path="/warehouse/rolls/:id">{params => <WarehousePage user={productionUser} view="roll" rollId={params.id} />}</Route>
    <Route path="/warehouse/hall"><WarehousePage user={productionUser} view="hall" /></Route>
    <Route path="/warehouse/finished-inventory"><WarehousePage user={productionUser} view="warehouse" /></Route>
    <Route path="/warehouse">{warehouseHome ? <Redirect to={warehouseHome} replace /> : <WarehousePage user={productionUser} view="hall" />}</Route>
    <Route path="/production">{productionHome && productionHome !== "/production" ? <Redirect to={productionHome} replace /> : !productionHome && warehouseHome ? <Redirect to={warehouseHome} replace /> : <ProductionPage user={productionUser} view="management" />}</Route>
    <Route path="/admin"><Admin user={auth.user} /></Route>
    <Route>{isAdmin ? <Dashboard user={auth.user} /> : <UserDashboard user={auth.user} />}</Route>
  </Switch></DeferredContent></Layout>;
}

export default App;
