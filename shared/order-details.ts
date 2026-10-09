import type { categories, customer_products, customers, items, master_batch_colors, orders, production_orders } from "./schema";

type JsonValue<T> = T extends Date ? string : T;
type Serialized<T> = { [K in keyof T]: JsonValue<T[K]> };
export type OrderPerson = { id: number; display_name: string | null; display_name_ar: string | null; full_name: string | null; username: string | null };
export type OrderDetailProduct = Serialized<typeof customer_products.$inferSelect> & {
  category: typeof categories.$inferSelect | null;
  item: typeof items.$inferSelect | null;
  color: typeof master_batch_colors.$inferSelect | null;
};
export type OrderDetailProduction = Serialized<typeof production_orders.$inferSelect> & { product: OrderDetailProduct | null };
export type OrderDetails = {
  order: Serialized<Omit<typeof orders.$inferSelect, "share_token">>;
  customer: Serialized<typeof customers.$inferSelect> | null;
  creator: OrderPerson | null;
  sales_representative: OrderPerson | null;
  production_orders: OrderDetailProduction[];
  totals: {
    requested_kg: string;
    planned_kg: string;
    production_order_count: number;
    by_status: Record<string, number>;
  };
  actual_production: { available: false; message: string };
};

/** Narrow projection consumed by the private and anonymous order print sheets. */
export type OrderPrintPerson = {
  display_name: string | null;
  display_name_ar: string | null;
  full_name: string | null;
  username: string | null;
};
export type OrderPrintProduct = {
  size_caption: string | null;
  width: string | null;
  left_facing: string | null;
  right_facing: string | null;
  cutting_length_cm: number | null;
  universal_thickness: string | null;
  raw_material: string | null;
  printing_cylinder: string | null;
  punching: string | null;
  is_printed: boolean | null;
  front_print_colors: string[] | null;
  back_print_colors: string[] | null;
  notes: string | null;
  cliche_front_design: string | null;
  cliche_back_design: string | null;
  item: { name: string | null; name_ar: string | null } | null;
  color: { id: number | string; name: string | null; name_ar: string | null; color_hex: string | null } | null;
};
export type OrderPrintProduction = {
  id: number;
  quantity_kg: string;
  final_quantity_kg: string;
  product: OrderPrintProduct | null;
};
export type OrderPrintDetails = {
  order: {
    id: number;
    order_number: string;
    status: string | null;
    notes: string | null;
    created_at: string;
    delivery_date: string | null;
    delivery_days: number | string | null;
    previous_status?: string | null;
  };
  customer: {
    name: string | null;
    name_ar: string | null;
    phone: string | null;
    plate_drawer_code: string | null;
    /** Customer code printed by the sheet, when present. */
    code?: string | null;
  } | null;
  creator: OrderPrintPerson | null;
  sales_representative: OrderPrintPerson | null;
  production_orders: OrderPrintProduction[];
  totals: { planned_kg: string };
  actual_production: { available: false; message: string };
  public_print_path: string;
};

// Stored quantities have exactly two decimal places; sum integer hundredths,
// not floating point values or inferred "produced" amounts.
export function orderProductionTotals(rows: { quantity_kg: string; final_quantity_kg: string; status: string }[]): OrderDetails["totals"] {
  const hundredths = (value: string) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("كمية إنتاج مخزنة غير صالحة");
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  const decimal = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
  const by_status: Record<string, number> = {};
  let requested = 0n;
  let planned = 0n;
  for (const row of rows) {
    requested += hundredths(row.quantity_kg);
    planned += hundredths(row.final_quantity_kg);
    by_status[row.status] = (by_status[row.status] ?? 0) + 1;
  }
  return { requested_kg: decimal(requested), planned_kg: decimal(planned), production_order_count: rows.length, by_status };
}