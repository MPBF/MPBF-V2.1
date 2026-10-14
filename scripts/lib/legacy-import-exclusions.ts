import type { TransferRow } from "../../shared/data-transfer";

export const productDimensionFields = ["width", "left_facing", "right_facing", "thickness", "cutting_length_cm"] as const;

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

export function legacyExclusion(table: string, row: TransferRow): string | null {
  if (table === "users" && row.status?.trim().toLowerCase() === "deleted")
    return "استبعاد المستخدم المحذوف من الاستيراد حسب اعتماد المستخدم";
  if (table !== "customer_products") return null;
  const fields = ["width", "thickness"].filter(field => {
    const value = row[field]?.trim();
    return !value || /^[+-]?0+(?:\.0+)?$/.test(value);
  });
  return fields.length ? `العرض أو السماكة صفر أو فارغ: ${fields.join(", ")}` : null;
}
