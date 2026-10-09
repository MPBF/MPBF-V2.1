export const ORDER_PRODUCTION_RELEASE_STATUSES = ["waiting", "on_hold", "paused"] as const;
export type OrderProductionReleaseStatus = typeof ORDER_PRODUCTION_RELEASE_STATUSES[number];
export function canReleaseOrderToProduction(status: unknown): status is OrderProductionReleaseStatus {
  return typeof status === "string" && ORDER_PRODUCTION_RELEASE_STATUSES.some(value => value === status);
}