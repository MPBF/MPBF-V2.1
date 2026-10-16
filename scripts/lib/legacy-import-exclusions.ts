import type { TransferRow } from "../../shared/data-transfer";

export const productDimensionFields = ["width", "left_facing", "right_facing", "thickness", "cutting_length_cm"] as const;
export const productDesignFields = ["cliche_front_design", "cliche_back_design"] as const;

export function omitProductDesigns(source: TransferRow) {
  const row = { ...source };
  const omitted: { field: string; value: string }[] = [];
  for (const field of productDesignFields) {
    if (!(field in source)) continue;
    const value = source[field];
    if (value) omitted.push({ field, value });
    // Blank cells mean "do not import this field", not an explicit null/clear.
    row[field] = "";
  }
  return { row, omitted };
}

export function roundProductDimensions(source: TransferRow) {
  const row = { ...source };
  const changes: { field: string; before: string; after: string }[] = [];
  for (const field of productDimensionFields) {
    const value = source[field];
    if (value == null) continue;
    const parts = /^(\d+)\.(\d+)$/.exec(value.trim());
    if (!parts || !/[1-9]/.test(parts[2])) continue;
    // Exact decimal rounding: never coerce source measurements through binary floats.
    // Negative/invalid dimensions remain invalid rather than being "repaired" to zero.
    const after = (BigInt(parts[1]) + (parts[2][0] >= "5" ? 1n : 0n)).toString();
    row[field] = after;
    changes.push({ field, before: value, after });
  }
  return { row, changes };
}

export function keepCurrentProductDimensions(source: TransferRow, current: TransferRow | undefined) {
  const hasFraction = productDimensionFields.some(field => {
    const value = source[field];
    return value != null && value.trim() !== "" && Number.isFinite(Number(value)) && !Number.isInteger(Number(value));
  });
  if (!hasFraction) return { row: source, preserved: false, pending: null };
  if (!current) return {
    row: source, preserved: false,
    pending: "لا يوجد سجل حالي لهذا المنتج؛ لا يمكن اختراع مقاسات حالية أو اعتماد مقاسات الملف بدلًا منها",
  };
  if (["width", "thickness"].some(field => !current[field]?.trim() || Number(current[field]) <= 0))
    return { row: source, preserved: false, pending: "المقاسات الحالية ناقصة أو غير موجبة؛ يلزم قرار منفصل" };
  const row = { ...source };
  for (const field of productDimensionFields) if (field in source) row[field] = current[field] ?? null;
  return { row, preserved: true, pending: null };
}

export function legacyExclusion(table: string, row: TransferRow, options: { excludeUnnamed?: boolean } = {}): string | null {
  if (table === "users" && row.status?.trim().toLowerCase() === "deleted")
    return "استبعاد المستخدم المحذوف من الاستيراد حسب اعتماد المستخدم";
  if (options.excludeUnnamed) {
    const names = table === "customers" ? [row.name, row.name_ar]
      : table === "users" ? [row.display_name, row.display_name_ar, row.full_name] : null;
    if (names && names.every(name => !name?.trim()))
      return "السجل بلا اسم عربي أو إنجليزي؛ استبعاد من نسخة الاستيراد حسب اعتماد المستخدم";
  }
  if (table !== "customer_products") return null;
  const fields = ["width", "thickness"].filter(field => {
    const value = row[field]?.trim();
    return !value || /^[+-]?0+(?:\.0+)?$/.test(value);
  });
  return fields.length ? `العرض أو السماكة صفر أو فارغ: ${fields.join(", ")}` : null;
}
