// Centralized endpoint definitions so web/mobile cannot drift.
// Backend lives at server/routes.ts.

export const Endpoints = {
  // Mobile auth
  mobileLogin: "/api/mobile/login",
  mobileRefresh: "/api/mobile/refresh-token",
  mobileLogout: "/api/mobile/logout",
  mobileSessions: "/api/mobile/sessions",
  mobileDeviceToken: "/api/mobile/device-token",
  mobileDashboard: "/api/mobile/dashboard",
  mobileSyncMetadata: "/api/mobile/sync/metadata",
  mobileSyncAttendance: "/api/mobile/sync/attendance",
  mobileSyncActions: "/api/mobile/sync/actions",
  mobileUploadImage: "/api/mobile/upload/image",
  mobileStatus: "/api/mobile/status",

  // Web-shared (read-only on mobile in most cases)
  me: "/api/me",
  dashboardStats: "/api/dashboard/stats",
  notifications: "/api/notifications",
  notificationsUser: "/api/notifications/user",
  notificationsStream: "/api/notifications/stream",
  notificationDelete: (id: number | string) =>
    `/api/notifications/delete/${id}`,
  orders: "/api/orders",
  ordersEnhanced: "/api/orders/enhanced",
  orderById: (id: number | string) => `/api/orders/${id}`,
  myOrders: "/api/my-orders",
  productionOrders: "/api/production-orders",
  productionOrderById: (id: number | string) => `/api/production-orders/${id}`,
  machines: "/api/machines",
  customers: "/api/customers",
  inventory: "/api/inventory",
  warehouseTransactions: "/api/warehouse-transactions",
  mixingRecipes: "/api/mixing-recipes",
  maintenance: "/api/maintenance",
  maintenanceRequests: "/api/maintenance-requests",
  maintenanceActions: "/api/maintenance-actions",
  spareParts: "/api/spare-parts",
  consumableParts: "/api/consumable-parts",
  qualityIssues: "/api/quality-issues",
  qualityIssuesStats: "/api/quality-issues/stats",
  qualityIssueById: (id: number | string) => `/api/quality-issues/${id}`,
  qualityChecks: "/api/quality-checks",
  reportsOrders: "/api/reports/orders",
  health: "/api/health",
} as const;

export type EndpointMap = typeof Endpoints;
