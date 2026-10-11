import { hasProductionPermission, type ProductionUser } from "../../../shared/production";
import { canMonitorProduction } from "../../../shared/production-monitoring";

export const planningViews = [
  { view: "management", href: "/planning", permissions: ["view_production", "manage_production", "admin"] },
  { view: "monitoring", href: "/planning/monitoring", permissions: ["admin"] },
] as const;

export type PlanningTab = typeof planningViews[number]["view"];

/** Mirrors the former management-tab policy without promoting bound operators through broad read grants. */
export function availablePlanningViews(user: ProductionUser) {
  const operationalStages = (["film", "printing", "cutting"] as const)
    .filter(stage => user.permissions.includes(`operate_${stage}`));
  const binding = user.production_role_binding;
  const operatorOnly = !hasProductionPermission(user, "manage_production") &&
    (binding ? binding.mode === "operator" : operationalStages.length > 0);
  return planningViews.filter(({ view }) => view === "monitoring"
    ? canMonitorProduction(user)
    : !operatorOnly && hasProductionPermission(user, "view_production", "manage_production"));
}

export function canOpenPlanningView(user: ProductionUser, view: PlanningTab): boolean {
  return availablePlanningViews(user).some(candidate => candidate.view === view);
}

export function initialPlanningPath(user: ProductionUser): string | null {
  return availablePlanningViews(user)[0]?.href ?? null;
}
