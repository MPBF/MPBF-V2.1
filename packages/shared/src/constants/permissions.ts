// Mirror of backend permission strings.
// Mobile screens gate visibility/actions on these values.

export const Permissions = {
  ADMIN: "admin",
  MANAGE_ORDERS: "manage_orders",
  VIEW_MY_ORDERS: "view_my_orders",
  MANAGE_PRODUCTION: "manage_production",
  VIEW_FILM_DASHBOARD: "view_film_dashboard",
  VIEW_PRINTING_DASHBOARD: "view_printing_dashboard",
  VIEW_CUTTING_DASHBOARD: "view_cutting_dashboard",
  MANAGE_WAREHOUSE: "manage_warehouse",
  MANAGE_MIXING: "manage_mixing",
  MANAGE_MAINTENANCE: "manage_maintenance",
  CREATE_MAINTENANCE_REQUESTS: "create_maintenance_requests",
  MANAGE_QUALITY: "manage_quality",
  MANAGE_HR: "manage_hr",
  VIEW_REPORTS: "view_reports",
  MANAGE_USERS: "manage_users",
  MANAGE_SETTINGS: "manage_settings",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export function hasPermission(
  userPermissions: string[] | undefined,
  ...required: Permission[]
): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;
  if (userPermissions.includes(Permissions.ADMIN)) return true;
  return required.some((p) => userPermissions.includes(p));
}
