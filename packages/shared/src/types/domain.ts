// Domain types shared between web, mobile, and (optionally) the backend.
// Keep this file decoupled from any framework imports.

export interface User {
  id: string;
  username: string;
  display_name?: string;
  display_name_ar?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  profile_image_url?: string;
  role_id?: number | null;
  role_name?: string;
  role_name_ar?: string;
  section_id?: number | null;
  permissions?: string[];
  status?: "active" | "inactive";
}

export interface AuthSession {
  token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  user: User;
}

export interface Customer {
  id: string;
  name: string;
  name_ar?: string;
  code?: string;
  phone?: string;
  city?: string;
}

export interface Order {
  id: number;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  delivery_date?: string | null;
  notes?: string | null;
  created_at: string;
  customer?: Customer | null;
}

export type OrderStatus =
  | "pending"
  | "in_production"
  | "for_production"
  | "completed"
  | "cancelled"
  | "on_hold";

export interface ProductionOrder {
  id: number;
  production_order_number: string;
  order_id: number;
  customer_product_id: number;
  quantity_kg: number | string;
  status: ProductionOrderStatus;
  created_at: string;
}

export type ProductionOrderStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled"
  | "archived";

export interface Machine {
  id: number;
  name: string;
  name_ar?: string;
  type: string;
  status: "active" | "maintenance" | "down" | "idle";
  section_id?: number | null;
}

export interface InventoryItem {
  id: number;
  name: string;
  name_ar?: string;
  category?: string;
  unit?: string;
  quantity: number | string;
  min_quantity?: number | string;
}

export interface MaintenanceRequest {
  id: number;
  request_number?: string;
  machine_id?: number | null;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "completed" | "cancelled";
  created_at: string;
}

export interface QualityIssue {
  id: number;
  issue_number?: string;
  title?: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved" | "closed";
  created_at: string;
}

export interface NotificationItem {
  id: number;
  user_id?: string | null;
  title: string;
  message: string;
  type?: string;
  is_read?: boolean;
  read_at?: string | null;
  created_at: string;
}

export interface AttendanceRecord {
  id: number;
  user_id: string;
  check_in?: string | null;
  check_out?: string | null;
  date: string;
  status: "present" | "absent" | "late" | "leave";
}

export interface DashboardStats {
  total_orders?: number;
  active_production_orders?: number;
  active_machines?: number;
  open_quality_issues?: number;
  open_maintenance_requests?: number;
  [key: string]: any;
}
