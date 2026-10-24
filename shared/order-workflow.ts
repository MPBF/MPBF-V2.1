export function canViewOrderWorkflow(user: { permissions?: string[] } | null | undefined) {
  return !!user?.permissions?.some(p => p === "admin" || p === "manage_production");
}

export type WorkflowPerson = {
  id: number; display_name: string | null; display_name_ar: string | null;
  full_name: string | null; username: string | null;
};
export type WorkflowOperation = {
  actor: WorkflowPerson | null; machine_name: string | null;
  machine_name_ar: string | null; at: string | null;
};
export type WorkflowContribution = {
  stage: "film" | "printing" | "cutting";
  actor: WorkflowPerson | null; quantity_kg: string; roll_count: number;
};
export type WorkflowProductionOrder = {
  id: number; production_order_number: string; status: string; stage: string | null;
  product_name: string | null; product_name_ar: string | null;
  requested_kg: string; planned_kg: string; produced_kg: string; waste_kg: string;
  roll_count: number; completed_rolls: number; contributions: WorkflowContribution[];
};
export type WorkflowRoll = {
  id: number; roll_number: string; production_order_id: number;
  production_order_number: string; stage: "film" | "printing" | "done";
  weight_kg: string; net_weight_kg: string | null; waste_kg: string;
  is_roll_product: boolean;
  film: WorkflowOperation; printing: WorkflowOperation; cutting: WorkflowOperation;
};
export type OrderWorkflow = {
  order: {
    id: number; order_number: string; created_at: string; delivery_date: string | null;
    status: string; customer_name: string | null; customer_name_ar: string | null;
  };
  production_orders: WorkflowProductionOrder[];
  rolls: WorkflowRoll[]; has_more: boolean; next_offset: number | null;
};
