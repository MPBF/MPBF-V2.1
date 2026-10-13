// Business-data transfer is explicitly approved by the owner; security/internal
// tables and authentication secrets remain outside general import/export.
export const policies: Record<string, {
  ar: string; en: string; group: string; write: string[]; logical?: { column: string; table: string; target: string }[];
}> = {
  customers: { ar: "العملاء", en: "Customers", group: "catalogue",
    write: ["id", "name", "name_ar", "city", "address", "tax_number", "commercial_name", "unified_number", "unique_customer_number", "phone", "is_active", "plate_drawer_code"] },
  categories: { ar: "الفئات", en: "Categories", group: "catalogue",
    write: ["id", "name", "name_ar", "code", "parent_id", "overrun_percentage"],
    logical: [{ column: "parent_id", table: "categories", target: "id" }] },
  items: { ar: "الأصناف", en: "Items", group: "catalogue",
    write: ["id", "category_id", "name", "name_ar", "code", "status"],
    logical: [{ column: "category_id", table: "categories", target: "id" }] },
  users: { ar: "المستخدمون", en: "Users", group: "accounts", write: [] },
  roles: { ar: "الأدوار", en: "Roles", group: "accounts", write: [] },
  customer_products: { ar: "منتجات العملاء", en: "Customer products", group: "catalogue", write: [] },
  machines: { ar: "المكائن", en: "Machines", group: "catalogue", write: [] },
  sections: { ar: "الأقسام", en: "Sections", group: "catalogue", write: [] },
  master_batch_colors: { ar: "ألوان الماستر باتش", en: "Master batch colors", group: "catalogue", write: [] },
  orders: { ar: "الطلبات", en: "Orders", group: "production", write: [] },
  production_orders: { ar: "أوامر الإنتاج", en: "Production orders", group: "production", write: [] },
  factory_execution: { ar: "سجلات التنفيذ", en: "Execution records", group: "production", write: [] },
  factory_rolls: { ar: "الرولات", en: "Rolls", group: "production", write: [] },
  factory_queues: { ar: "طوابير الإنتاج", en: "Production queues", group: "production", write: [] },
  factory_locations: { ar: "صالات الاستلام", en: "Receiving halls", group: "warehouse", write: [] },
  factory_receipts: { ar: "سندات التام", en: "Finished receipts", group: "warehouse", write: [] },
  factory_receipt_items: { ar: "بنود سندات التام", en: "Finished receipt lines", group: "warehouse", write: [] },
  factory_inventory: { ar: "رصيد التام", en: "Finished balances", group: "warehouse", write: [] },
  factory_movements: { ar: "حركات التام", en: "Finished movements", group: "warehouse", write: [] },
  factory_deliveries: { ar: "سندات تسليم التام", en: "Finished deliveries", group: "warehouse", write: [] },
  factory_delivery_items: { ar: "بنود تسليم التام", en: "Delivery lines", group: "warehouse", write: [] },
  factory_delivery_movements: { ar: "حركات تسليم التام", en: "Delivery movements", group: "warehouse", write: [] },
  factory_raw_materials: { ar: "المواد الخام وأرصدتها", en: "Raw materials and balances", group: "warehouse", write: [] },
  factory_raw_vouchers: { ar: "سندات الخام", en: "Raw vouchers", group: "warehouse", write: [] },
  factory_raw_movements: { ar: "حركات الخام", en: "Raw movements", group: "warehouse", write: [] },
  factory_mixes: { ar: "خلطات الخام", en: "Raw mixes", group: "warehouse", write: [] },
  factory_mix_items: { ar: "بنود الخلطات", en: "Mix lines", group: "warehouse", write: [] },
};
export const sensitiveName = /password|secret|token|session|credential|auth|permission|oauth|api.?key|connection|private.?key|salt|hash|^data_transfer_|^database_backup_|^pg_|^sql_|^drizzle|migration|operations|audit|^system_|^internal_|^ai_|^mcp_|^external_|^order_number_allocations$/i;
export const protectedColumn = /password|secret|token|session|credential|auth|permission|api.?key|private.?key|replit_user_id|is_system_user/i;
export const eligibleTable = (name: string) => ["users", "roles"].includes(name) || !sensitiveName.test(name);
export const productDerived = new Set(["size_caption", "bag_weight_grams", "bags_per_kilo", "package_weight_kg", "is_printed"]);
export const privateSettingKey = /password|secret|token|session|credential|auth|permission|api.?key|private.?key|connection.?string/i;
export const labels: Record<string, string> = {
  id: "المعرّف", name: "الاسم بالإنجليزية", name_ar: "الاسم بالعربية", code: "الرمز",
  city: "المدينة", address: "العنوان", phone: "الهاتف", tax_number: "الرقم الضريبي",
  commercial_name: "الاسم التجاري", unified_number: "الرقم الموحد", unique_customer_number: "رقم العميل",
  is_active: "نشط", plate_drawer_code: "رقم الدرج", parent_id: "الفئة الأب", category_id: "الفئة",
  overrun_percentage: "نسبة الزيادة", status: "الحالة",
  username: "اسم المستخدم", display_name: "الاسم المعروض", display_name_ar: "الاسم المعروض بالعربية",
  role_id: "الدور", permissions: "صلاحيات الدور", customer_id: "العميل", item_id: "الصنف",
};
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_EXPORT_ROWS = 20000;
export const RETENTION_DAYS = 30;
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) fail("Unsafe identifier");
  return `"${value}"`;
}
