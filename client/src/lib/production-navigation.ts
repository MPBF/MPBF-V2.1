import { hasProductionPermission, productionStageReadPermissions, type ProductionStage, type ProductionUser } from "../../../shared/production";
import { canOpenWarehouseView } from "./warehouse-navigation";
import { canViewMixing } from "../../../shared/raw-mixing";

export const productionViews = [
  { view: "film", href: "/production/film", permissions: ["view_production", "manage_production", ...productionStageReadPermissions.film] },
  { view: "printing", href: "/production/printing", permissions: ["view_production", "manage_production", ...productionStageReadPermissions.printing] },
  { view: "cutting", href: "/production/cutting", permissions: ["view_production", "manage_production", ...productionStageReadPermissions.cutting] },
  { view: "mixing", href: "/production/mixing", permissions: ["operate_film", "view_mixing", "manage_mixing", "manage_production"] },
] as const;

export type ProductionTab = typeof productionViews[number]["view"] | "hall" | "warehouse";

/** General read grants must not turn an operator's page into other stage boards. */
export function availableProductionViews(user: ProductionUser) {
  const operationalStages = (["film", "printing", "cutting"] as const)
    .filter(stage => user.permissions.includes(`operate_${stage}`));
  const binding = user.production_role_binding;
  const stages: readonly ProductionStage[] = binding?.mode === "operator" ? binding.stages : operationalStages;
  const operatorOnly = !hasProductionPermission(user, "manage_production") &&
    (binding ? binding.mode === "operator" : operationalStages.length > 0);
  return productionViews.filter(({ view, permissions }) => view === "mixing"
    ? canViewMixing(user)
    : operatorOnly ? (view === "film" || view === "printing" || view === "cutting") &&
      stages.includes(view) &&
      hasProductionPermission(user, ...productionStageReadPermissions[view])
    : hasProductionPermission(user, ...permissions));
}

export function canOpenProductionView(user: ProductionUser, view: ProductionTab | "roll"): boolean {
  // Roll records remain accessible from the permitted board; they are not tabs.
  return view === "roll"
    ? hasProductionPermission(user, "view_production", "manage_production") ||
      productionViews.some(({ view, permissions }) => view !== "mixing" && hasProductionPermission(user, ...permissions)) ||
      canOpenWarehouseView(user,"roll")
    : availableProductionViews(user).some(candidate => candidate.view === view);
}

export function initialProductionPath(user: ProductionUser): string | null {
  return availableProductionViews(user)[0]?.href ?? null;
}