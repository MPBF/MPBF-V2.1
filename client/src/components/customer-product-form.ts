import { customerProductFacingNotice, deriveCustomerProductFields, isManualCuttingProduct, type ProductInput } from "../../../shared/customer-product-fields";

export type CustomerProductRow = Record<string, any>;
export type CustomerProductValidationOptions = {
  customers?: CustomerProductRow[];
  items?: CustomerProductRow[];
  categoryId?: string | number | null;
  validateCuttingLength?: boolean;
};
export type CustomerProductPayloadOptions = {
  categoryName?: string;
  preserveCuttingLength?: boolean;
};

const printColors = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [value];
    } catch { return [value]; }
  }
  return [];
};

/** Initialize only editable fields; joined labels and computed/helper columns are intentionally ignored. */
export function initializeCustomerProductForm(row: CustomerProductRow = {}): ProductInput {
  return {
    customer_id: row.customer_id ?? "", category_id: row.category_id ?? "", item_id: row.item_id ?? "",
    right_facing: row.right_facing ?? "", left_facing: row.left_facing ?? "", width: row.width ?? "",
    thickness: row.thickness ?? "", density: row.density ?? (row.id ? "" : "0.95"), printing_cylinder: row.printing_cylinder ?? "",
    cutting_length_cm: row.cutting_length_cm ?? "", cutting_unit: row.cutting_unit ?? "",
    punching: row.punching ?? "بدون", unit_weight_kg: row.unit_weight_kg ?? "", unit_quantity: row.unit_quantity ?? "",
    raw_material: row.raw_material ?? "", master_batch_id: row.master_batch_id ?? "",
    cliche_front_design: row.cliche_front_design ?? "", cliche_back_design: row.cliche_back_design ?? "",
    front_print_colors: printColors(row.front_print_colors), back_print_colors: printColors(row.back_print_colors),
    status: row.status ?? "active", notes: row.notes ?? "",
  };
}

const editableFields = [
  "customer_id", "category_id", "item_id", "right_facing", "left_facing", "width", "thickness", "density",
  "printing_cylinder", "cutting_length_cm", "cutting_unit", "punching", "unit_weight_kg", "unit_quantity",
  "raw_material", "master_batch_id", "cliche_front_design", "cliche_back_design", "front_print_colors",
  "back_print_colors", "status", "notes",
] as const;
const numericFields = new Set([
  "right_facing", "left_facing", "width", "thickness", "density", "cutting_length_cm", "unit_weight_kg", "unit_quantity",
]);

function comparableValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  if (key === "front_print_colors" || key === "back_print_colors") return printColors(value);
  if (numericFields.has(key)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : String(value);
  }
  if (key === "customer_id" || key === "category_id" || key === "item_id" || key === "master_batch_id") return String(value);
  return value;
}

/** Select only editable values that differ semantically from the stored row. */
export function buildCustomerProductDirtyPayload(
  initialRow: CustomerProductRow,
  payload: ProductInput,
): ProductInput {
  const changed: ProductInput = {};
  for (const key of editableFields) {
    const before = comparableValue(key, initialRow[key]);
    const after = comparableValue(key, payload[key]);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed[key] = payload[key];
  }
  return changed;
}

/** Compare source inputs using the same blank/null and numeric equivalence as dirty PUTs. */
export function customerProductSourcesChanged(
  initialRow: CustomerProductRow,
  current: ProductInput,
  keys: readonly string[],
): boolean {
  return keys.some((key) =>
    JSON.stringify(comparableValue(key, initialRow[key])) !== JSON.stringify(comparableValue(key, current[key])));
}

/** Returns an Arabic validation message, or null when all relational/numeric inputs are valid. */
export function validateCustomerProductForm(
  form: ProductInput,
  options: CustomerProductValidationOptions = {},
): string | null {
  if (!String(form.customer_id ?? "")) return "اختر عميلاً صالحاً من القائمة.";
  if (options.customers && !options.customers.some((c) => String(c.id) === String(form.customer_id))) return "اختر عميلاً صالحاً من القائمة.";
  const categoryId = options.categoryId !== undefined ? options.categoryId : form.category_id;
  if (form.item_id && options.items && categoryId != null && !options.items.some((item) =>
    String(item.id) === String(form.item_id) && String(item.category_id) === String(categoryId))) {
    return "الصنف المحفوظ لا يتبع التصنيف المحدد. اختر صنفاً متوافقاً أو امسح الصنف.";
  }
  const whole = (value: unknown) => value === "" || value == null || /^\d+$/.test(String(value));
  for (const [key, label] of [["right_facing", "الجانب الأيمن"], ["left_facing", "الجانب الأيسر"]] as const) {
    if (!whole(form[key])) return `${label}: أدخل عدداً صحيحاً غير سالب.`;
  }
  for (const [key, label, max] of [["width", "العرض", 999999], ["thickness", "السماكة", 99999]] as const) {
    const value = String(form[key] ?? "");
    if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)) return `${label}: أدخل عدداً صحيحاً بين 1 و${max}.`;
  }
  for (const [key, label, maxIntegerDigits, maxDecimalDigits] of [
    ["density", "الكثافة", 3, 3], ["unit_weight_kg", "وزن الوحدة", 5, 3],
  ] as const) {
    const value = String(form[key] ?? "");
    const decimalPattern = new RegExp(`^\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,${maxDecimalDigits}})?$`);
    if (value && (!decimalPattern.test(value) || Number(value) <= 0)) return `${label}: أدخل قيمة عشرية موجبة ضمن الدقة المسموحة.`;
  }
  if (form.unit_quantity !== "" && form.unit_quantity != null && (!whole(form.unit_quantity) || Number(form.unit_quantity) <= 0)) return "كمية العبوة يجب أن تكون عدداً صحيحاً موجباً.";
  if (options.validateCuttingLength !== false && form.cutting_length_cm !== "" && form.cutting_length_cm != null &&
    (!whole(form.cutting_length_cm) || Number(form.cutting_length_cm) <= 0)) return "طول القطع يجب أن يكون عدداً صحيحاً موجباً.";
  const facingNotice = customerProductFacingNotice(form);
  return facingNotice?.kind === "blocking" ? facingNotice.message : null;
}

/**
 * Serialize editable fields only. Computed columns and joined properties are excluded.
 * The only computed value that may be sent is cutting_length_cm, which is an editable
 * manual value for manual-cut products and is preserved for untouched legacy edits.
 */
export function buildCustomerProductPayload(
  form: ProductInput,
  options: CustomerProductPayloadOptions = {},
): ProductInput {
  const derived = deriveCustomerProductFields(form, options.categoryName || "", Boolean(options.preserveCuttingLength));
  const manualCut = isManualCuttingProduct(form, options.categoryName || "");
  const cuttingLength = options.preserveCuttingLength
    ? form.cutting_length_cm
    : manualCut ? form.cutting_length_cm : derived.cutting_length_cm;
  return {
    customer_id: String(form.customer_id ?? ""),
    category_id: form.category_id ? String(form.category_id) : null,
    item_id: form.item_id ? String(form.item_id) : null,
    right_facing: form.right_facing === "" || form.right_facing == null ? null : String(form.right_facing),
    left_facing: form.left_facing === "" || form.left_facing == null ? null : String(form.left_facing),
    width: form.width === "" || form.width == null ? null : String(form.width),
    thickness: form.thickness === "" || form.thickness == null ? null : String(form.thickness),
    density: form.density === "" || form.density == null ? null : String(form.density),
    printing_cylinder: String(form.printing_cylinder || ""),
    cutting_length_cm: cuttingLength === "" || cuttingLength == null ? null : Number(cuttingLength),
    cutting_unit: String(form.cutting_unit || ""),
    punching: String(form.punching || "بدون"),
    unit_weight_kg: form.unit_weight_kg === "" || form.unit_weight_kg == null ? null : String(form.unit_weight_kg),
    unit_quantity: form.unit_quantity === "" || form.unit_quantity == null ? null : Number(form.unit_quantity),
    raw_material: String(form.raw_material || ""),
    master_batch_id: form.master_batch_id ? String(form.master_batch_id) : null,
    cliche_front_design: String(form.cliche_front_design || ""),
    cliche_back_design: String(form.cliche_back_design || ""),
    front_print_colors: printColors(form.front_print_colors),
    back_print_colors: printColors(form.back_print_colors),
    status: String(form.status || "active"),
    notes: String(form.notes || ""),
  };
}