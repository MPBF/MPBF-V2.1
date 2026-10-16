/** Current warehouse grants, separate from general production access. */
export const warehouseWorkPermissions = [
  "view_production_hall", "receive_production", "view_finished_inventory",
  "manage_finished_warehouse", "view_raw_inventory", "manage_raw_materials",
] as const;

const warehouseAccountPermissions = new Set<string>([
  ...warehouseWorkPermissions,
  "view_home", "view_user_dashboard", "view_notifications",
  // Retain existing warehouse grants for legacy warehouse endpoints.
  "view_warehouse", "manage_inventory", "view_inventory", "manage_warehouse",
  "view_warehouse_vouchers", "manage_production_hall", "view_warehouse_reports",
  "manage_warehouse_vouchers",
]);

/** Only the explicitly selected keeper role is passed here by the migration. */
export function warehouseKeeperPermissions(previous: readonly string[]): string[] {
  return [...new Set([
    ...previous.filter(permission => warehouseAccountPermissions.has(permission)),
    "view_home", "view_user_dashboard", ...warehouseWorkPermissions,
  ])];
}

/** Permission-based: no hard-coded role ID, localized name or admin-preview bypass. */
export function isWarehouseOnlyAccount(user: { permissions?: readonly string[] | null }): boolean {
  const permissions = user.permissions ?? [];
  return warehouseWorkPermissions.some(permission => permissions.includes(permission)) &&
    permissions.every(permission => warehouseAccountPermissions.has(permission));
}

export function canOpenWarehouseAccountPath(path: string): boolean {
  return path === "/" || path === "/my-dashboard" ||
    /^\/warehouse(?:\/|$)/.test(path) ||
    // Preserve existing warehouse bookmarks and private roll-label QR links.
    /^\/production\/(?:hall|warehouse)\/?$/.test(path) ||
    /^\/production\/rolls\/[1-9]\d*\/?$/.test(path);
}
