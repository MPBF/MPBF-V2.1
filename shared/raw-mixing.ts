import { hasProductionPermission, type ProductionUser } from "./production";

export const formatMixNumber = (id: number): string =>
  Number.isSafeInteger(id) && id > 0 ? `Mix-${String(id).padStart(4, "0")}` : "—";
export const canManageMixing = (user: ProductionUser): boolean =>
  hasProductionPermission(user, "manage_mixing");

export function canRecordMixing(user: ProductionUser): boolean {
  return hasProductionPermission(user, "manage_mixing") ||
    (hasProductionPermission(user, "operate_film") &&
      (user.production_role_binding?.mode !== "operator" || user.production_role_binding.stages.includes("film")));
}
export function canViewMixing(user: ProductionUser): boolean {
  return canRecordMixing(user) || hasProductionPermission(user, "view_mixing", "manage_production");
}
/** Display policy only: recorded mixes and their history remain accessible. */
export function canViewSavedMixingComposition(user: ProductionUser): boolean {
  const filmOperator = user.permissions.includes("operate_film") ||
    (user.production_role_binding?.mode === "operator" && user.production_role_binding.stages.includes("film"));
  return !filmOperator || hasProductionPermission(user, "manage_production");
}
export function canViewRawInventory(user: ProductionUser): boolean {
  return hasProductionPermission(user, "view_raw_inventory", "manage_raw_materials");
}
export type RawMaterial = {
  id: number; item_id: string; code: string; name: string; name_ar: string; quantity_kg: string; is_active: boolean;
};
export type MixingInput = {
  request_id: string; machine_id: string; screw?: "A" | "B"; notes?: string;
  items: { material_id: number; quantity_kg: string }[];
};
export type MixingRecord = {
  id: number; machine_id: string; screw: "A" | "B" | null; machine_name: string | null; machine_name_ar: string | null;
  created_by: number; actor_name: string | null; actor_name_ar: string | null;
  created_at: string; notes: string | null; total_kg: string;
  items: { material_id: number; code: string; name: string; name_ar: string; quantity_kg: string }[];
  revision?: number; can_edit_contents?: boolean;
};
export type MixingUpdateInput = {
  request_id: string; expected_revision: number; notes?: string;
  contents?: Omit<MixingInput, "request_id" | "notes">;
};
export type MixingDeleteInput = { request_id: string; expected_revision: number };
export type MixingState = {
  materials: RawMaterial[];
  machines: { id: string; name: string | null; name_ar: string | null; status: string; screw_type: string | null }[];
  latest_mixes: MixingRecord[];
  records: MixingRecord[]; next_before: number | null;
  raw_vouchers?: RawVoucher[];
};
export type RawMovementInput = {
  request_id: string; kind: "receipt" | "issue"; notes?: string;
  items: { material_id: number; quantity_kg: string }[];
};
export type RawVoucher = {
  id: number; kind: "receipt" | "issue"; total_kg: string; created_at: string;
  created_by: number; actor_name: string | null; actor_name_ar: string | null; notes: string | null;
  items: MixingRecord["items"];
};
