export const ORDER_DISPLAY_FOLDERS = ["new", "production", "urgent", "archive"] as const;
export type OrderDisplayFolder = typeof ORDER_DISPLAY_FOLDERS[number];
export const ORDER_DISPLAY_FILTERS = ["active", ...ORDER_DISPLAY_FOLDERS] as const;
export type OrderDisplayFilter = typeof ORDER_DISPLAY_FILTERS[number] | "all";
export const ORDER_ACTIVE_STATUSES = ["waiting", "in_production"] as const;
// Lifecycle filters are independent of manually assigned display folders.
export const ORDER_STATUS_FILTERS = ["active", "all", "new", "production", "completed", "cancelled"] as const;
export type OrderStatusFilter = typeof ORDER_STATUS_FILTERS[number];
export const ORDER_FILTER_STATUSES = {
  active: ORDER_ACTIVE_STATUSES,
  new: ["waiting"],
  production: ["in_production"],
  completed: ["completed"],
  cancelled: ["cancelled"],
} as const;
export const ORDER_WORKSPACE_ACTIONS = ["release", "pause", "cancel"] as const;
export type OrderWorkspaceAction = typeof ORDER_WORKSPACE_ACTIONS[number];
export const ORDER_WORKSPACE_STATUSES = ["waiting", "on_hold", "for_production", "in_production", "paused", "cancelled", "completed", "delivered", "archived"] as const;
export type OrderActionItem = { id: number; expected_status: string };
export type OrderFolderItem = { id: number; expected_folder: OrderDisplayFolder };

export function canApplyOrderAction(status: unknown, action: OrderWorkspaceAction): boolean {
  if (action === "release") return ["waiting", "on_hold", "paused"].includes(String(status));
  if (action === "pause") return ["waiting", "on_hold", "for_production", "in_production"].includes(String(status));
  return ["waiting", "on_hold", "for_production", "in_production", "paused"].includes(String(status));
}