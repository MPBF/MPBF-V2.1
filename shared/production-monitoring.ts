import type { ProductionStage, ProductionUser } from "./production";
import type { MixingRecord } from "./raw-mixing";

/** Explicit effective grant only: no wildcard, role name or original preview authority. */
export const canMonitorProduction = (user: ProductionUser) => user.permissions.includes("admin");
export type MonitoringFilter = {
  cursor?: string; limit?: number; stage?: ProductionStage; machine_id?: string;
  from?: string; to?: string; search?: string;
};
export type MonitoringPage<T> = { records: T[]; next: string | null };
export type ProductionEvent = {
  id: string; stage: ProductionStage; registered_at: string; roll_id: number; roll_number: string;
  machine_id: string; machine_name: string | null; machine_name_ar: string | null;
  actor_id: number | null; actor_name: string | null; actor_name_ar: string | null;
  production_order_number: string; order_number: string;
  weight_kg: string; net_weight_kg: string | null; waste_kg: string | null;
};
export type MachineMixBalance = {
  machine_id: string; machine_name: string | null; machine_name_ar: string | null;
  mixed_kg: string; consumed_kg: string; remaining_kg: string; film_kg: string; uncovered_kg: string;
};
export type MixMonitorRecord = MixingRecord & {
  tracked: boolean; consumed_kg: string; remaining_kg: string | null;
};
export type RollMixAllocation = {
  mix_id: number; roll_id: number; roll_number: string; allocated_kg: string;
  screw: "A" | "B" | null; mix_registered_at: string;
};
export type RollMixDetail = {
  roll_id: number; roll_number: string; tracked: boolean; weight_kg: string;
  uncovered_kg: string | null; allocations: MonitoringPage<RollMixAllocation>;
};
export type MixMonitorDetail = { mix: MixMonitorRecord; allocations: MonitoringPage<RollMixAllocation> };
export type MonitoringSummary = {
  activated_at: string; machines: MachineMixBalance[];
  production_machines: Pick<MachineMixBalance,"machine_id"|"machine_name"|"machine_name_ar">[];
};
export type FilmMixTracking = { consumed_kg: string; uncovered_kg: string };
