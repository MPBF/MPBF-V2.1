import { hasProductionPermission, type ProductionUser } from "../../../shared/production";

export const warehouseViews = [
  { view: "hall", href: "/warehouse/hall", permissions: ["view_production_hall", "receive_production"] },
  { view: "warehouse", href: "/warehouse/finished-inventory", permissions: ["view_finished_inventory", "receive_production", "manage_finished_warehouse"] },
] as const;
export type WarehouseTab = typeof warehouseViews[number]["view"];

export function availableWarehouseViews(user: ProductionUser) {
  return warehouseViews.filter(({ permissions }) => hasProductionPermission(user, ...permissions));
}
export function canOpenWarehouseView(user: ProductionUser, view: WarehouseTab | "roll") {
  const views = availableWarehouseViews(user);
  return view === "roll" ? views.length > 0 : views.some(candidate => candidate.view === view);
}
export function initialWarehousePath(user: ProductionUser): string | null {
  return availableWarehouseViews(user)[0]?.href ?? null;
}
