import type { ProductionRoleBinding } from "./production-role";

export type ProductionStage = "film" | "printing" | "cutting";
export type ProductionStateScope = "management" | ProductionStage | "hall" | "warehouse" | "roll";
export const productionPermissions = [
  "view_production", "manage_production", "operate_film", "operate_printing", "operate_cutting",
  "view_film_dashboard", "view_printing_dashboard", "view_cutting_dashboard",
  "view_production_hall", "receive_production", "view_finished_inventory", "manage_finished_warehouse",
] as const;
export const productionStageReadPermissions = {
  film: ["operate_film", "view_film_dashboard"],
  printing: ["operate_printing", "view_printing_dashboard"],
  cutting: ["operate_cutting", "view_cutting_dashboard"],
} as const;
export type ProductionUser = {
  id: number; permissions: string[];
  role_name?: string | null; role_name_ar?: string | null;
  production_role_binding?: ProductionRoleBinding;
};
export const hasProductionPermission = (user: ProductionUser, ...keys: string[]) =>
  user.permissions.includes("admin") || keys.some(key => user.permissions.includes(key));
export type ProductSnapshot = {
  id: number; item_id: string | null; name: string | null; name_ar: string | null;
  customer_name: string | null; customer_name_ar: string | null;
  width: string | null; left_facing: string | null; right_facing: string | null;
  universal_thickness: string | null; cutting_length_cm: number | null; raw_material: string | null;
  printing_cylinder: string | null; punching: string | null; notes: string | null;
  front_print_colors: string[] | null; back_print_colors: string[] | null;
  size_caption?: string | null;
  plate_drawer_code?: string | null;
  master_batch?: {
    id: string; name: string | null; name_ar: string | null; color_hex: string | null;
  } | null;
};
export type FilmMachineDuration = {
  machine_id: string; machine_name: string | null; machine_name_ar: string | null;
  roll_count: number; first_roll_at: string; last_roll_at: string;
  duration_seconds: number | null;
};
export type ProductionOrderRecord = {
  id: number; order_id: number; production_order_number: string; order_number: string;
  customer_product_id: number | null; quantity_kg: string; final_quantity_kg: string; status: string;
  order_status: string; batch_number: string | null; product: ProductSnapshot | null;
  started_at: string | null; film_closed_at: string | null; completed_at: string | null;
  is_printed: boolean; is_roll_product: boolean; stage: string | null;
  produced_kg: string; ready_kg: string; received_kg: string; remaining_kg: string; waste_kg: string;
  roll_count?: number;
  film_durations: FilmMachineDuration[];
  previous_status?: string | null;
};

/** Pending plans are visible before execution, but historical work cannot restart. */
export function canStartFilmProductionOrder(order: Pick<ProductionOrderRecord,
  "status" | "order_status" | "batch_number" | "final_quantity_kg"> &
  Partial<Pick<ProductionOrderRecord, "previous_status" | "started_at" | "film_closed_at" | "completed_at">>): boolean {
  if (!["for_production", "in_production"].includes(order.order_status) ||
    order.status !== "pending" || order.batch_number || order.started_at ||
    order.film_closed_at || order.completed_at ||
    (order.previous_status && order.previous_status !== "pending")) return false;
  try { return kgHundredths(order.final_quantity_kg) > 0n; }
  catch { return false; }
}
export type ProductionRollRecord = {
  id: number; production_order_id: number; roll_number: string; weight_kg: string;
  stage: "film" | "printing" | "done"; film_machine_id: string; created_by: number | null;
  created_at: string; production_minutes: number | null; is_last_roll: boolean;
  printing_machine_id: string | null; printed_by: number | null; printed_at: string | null;
  cutting_machine_id: string | null; cut_by: number | null; cut_completed_at: string | null;
  net_weight_kg: string | null; waste_kg: string;
  production_order_number: string; product: ProductSnapshot; is_printed: boolean; is_roll_product: boolean;
  order_number?: string; order_status?: string; production_order_status?: string;
  production_stage?: string; batch_number?: string | null;
  created_actor?: ProductionActor | null;
};
export type ProductionMachine = {
  id: string; name: string | null; name_ar: string | null; type: string; status: string;
  inline_printer_id: string | null; min_thickness: string | null; max_thickness: string | null;
  min_width_cm: string | null; max_width_cm: string | null;
};
export type ProductionActor = {
  id: number; display_name: string | null; display_name_ar: string | null;
  full_name: string | null; username: string | null;
};
export type ProductionRollDetail = ProductionRollRecord & {
  film_duration: FilmMachineDuration;
  created_actor: ProductionActor | null;
  printed_actor: ProductionActor | null;
  cut_actor: ProductionActor | null;
};
export type ProductionQueue = { id: number; production_order_id: number; stage: ProductionStage; machine_id: string; position: number };
export type StorageLocation = { id: number; name: string; name_ar: string; is_active: boolean };
export type ReceiptItem = {
  id: number; production_order_id: number; customer_product_id: number; item_id: string | null;
  location_id: number; quantity_kg: string;
  line_number?: number | null;
  production_order_number?: string; location_name?: string; location_name_ar?: string;
};
export type ProductionReceipt = {
  id: number; voucher_number: string; created_at: string; created_by: number | null; notes: string | null;
  items: ReceiptItem[];
};
export type InventoryRecord = {
  id: number; customer_product_id: number; production_order_id: number; item_id: string | null;
  location_id: number; quantity_kg: string; production_order_number: string; batch_number: string | null;
  product: ProductSnapshot; location_name: string; location_name_ar: string;
  production_order_status?: string;
};
export type InventoryMovement = {
  id: number; receipt_id: number; receipt_item_id: number; quantity_kg: string; created_at: string;
  voucher_number: string; production_order_id: number; location_id: number;
  production_order_number?: string;
};
export type ProductionState = {
  orders: ProductionOrderRecord[]; rolls: ProductionRollRecord[]; machines: ProductionMachine[];
  queues: ProductionQueue[]; locations: StorageLocation[]; receipts: ProductionReceipt[];
  inventory: InventoryRecord[]; movements: InventoryMovement[];
  totals?: { orders: number; rolls: number; receipts: number; movements: number; inventory: number; inventory_kg: string };
};
export type ProductionHistoryKind = "orders" | "rolls" | "receipts" | "movements" | "inventory";
export type ProductionHistoryRecords = {
  orders: ProductionOrderRecord; rolls: ProductionRollRecord; receipts: ProductionReceipt;
  movements: InventoryMovement; inventory: InventoryRecord;
};
export type ProductionHistoryFilter = {
  before?: number; limit?: number; search?: string; status?: string; from?: string; to?: string;
  order_id?: number; location_id?: number;
};
export type ProductionHistoryPage<K extends ProductionHistoryKind> = {
  records: ProductionHistoryRecords[K][]; next: number | null;
};
export type ReceiptInput = {
  request_id: string; notes?: string;
  items: { production_order_id: number; location_id?: number; quantity_kg: string }[];
};
export type FilmInput = {
  request_id: string; machine_id: string; weight_kg: string;
  is_last_roll?: boolean; inline_printed?: boolean;
};
export function machineStage(type: string | null): ProductionStage | null {
  const normalized = String(type ?? "").toLowerCase();
  return normalized === "extruder" ? "film" : ["printer", "printing"].includes(normalized)
    ? "printing" : ["cutter", "cutting"].includes(normalized) ? "cutting" : null;
}
export function isPlasticRoll(name: string | null, nameAr: string | null) {
  return /plastic\s*roll|رولات?\s*(?:بلاستيك|بلاستيكية)|رول\s*بلاستيك/i.test(`${name ?? ""} ${nameAr ?? ""}`);
}
export function kgHundredths(value: string): bigint {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid quantity");
  const [whole, decimals = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
}
export const kgString = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
/** A roll that reaches or exceeds the film plan closes it without truncating its weight. */
export function filmRollReachesTarget(plannedKg: string, producedKg: string, rollKg: string): boolean {
  const weight = kgHundredths(rollKg);
  return weight > 0n && kgHundredths(producedKg) + weight >= kgHundredths(plannedKg);
}
export const stageAfterFilm = (printed: boolean, rollProduct: boolean, inlinePrinted: boolean) =>
  rollProduct && (!printed || inlinePrinted) ? "done" : printed && inlinePrinted ? "printing" : "film";
export const stageAfterPrinting = (rollProduct: boolean) => rollProduct ? "done" : "printing";
export const eligibleForCutting = (roll: Pick<ProductionRollRecord, "stage" | "is_printed" | "is_roll_product" | "printed_at">) =>
  !roll.is_roll_product && roll.stage !== "done" && (!roll.is_printed || !!roll.printed_at);