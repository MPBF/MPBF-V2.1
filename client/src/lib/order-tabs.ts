export type OrderPageTab = "orders" | "production";

export const ORDER_TAB_PERMISSIONS = {
  orders: ["view_orders", "manage_orders", "admin"],
  production: ["view_production", "manage_production", "admin"],
} as const;

export function availableOrderTabs(permissions: readonly string[]): OrderPageTab[] {
  return (["orders", "production"] as const).filter((tab) =>
    permissions.includes("*") ||
    ORDER_TAB_PERMISSIONS[tab].some((permission) => permissions.includes(permission)),
  );
}

export function selectedOrderTab(
  requested: string | null,
  permissions: readonly string[],
): OrderPageTab | null {
  const tabs = availableOrderTabs(permissions);
  return tabs.find((tab) => tab === requested) ?? tabs[0] ?? null;
}