import type { TransferRow } from "../../shared/data-transfer";

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
