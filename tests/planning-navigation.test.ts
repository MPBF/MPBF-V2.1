import { describe, expect, it } from "@jest/globals";
import { availablePlanningViews, canOpenPlanningView, initialPlanningPath } from "../client/src/lib/planning-navigation";
import { availableProductionViews, canOpenProductionView, initialProductionPath } from "../client/src/lib/production-navigation";
import type { ProductionUser } from "../shared/production";

const user = (...permissions: string[]): ProductionUser => ({ id: 7, permissions });
const tabs = (account: ProductionUser) => availablePlanningViews(account).map(tab => tab.view);

describe("planning and monitoring navigation", () => {
  it("moves administrator management and monitoring out of operations", () => {
    const account = user("admin");
    expect(tabs(account)).toEqual(["management", "monitoring"]);
    expect(availablePlanningViews(account).map(tab => tab.href)).toEqual(["/planning", "/planning/monitoring"]);
    expect(initialPlanningPath(account)).toBe("/planning");
    expect(initialProductionPath(account)).toBe("/production/film");
    expect(availableProductionViews(account).map(tab => tab.view)).toEqual(["film", "printing", "cutting", "mixing"]);
  });

  it.each(["view_production", "manage_production"])("preserves %s management but not administrator monitoring", permission => {
    const account = user(permission);
    expect(tabs(account)).toEqual(["management"]);
    expect(canOpenPlanningView(account, "management")).toBe(true);
    expect(canOpenPlanningView(account, "monitoring")).toBe(false);
    expect(initialPlanningPath(account)).toBe("/planning");
    expect(canOpenProductionView(account, "roll")).toBe(true);
  });

  it.each(["film", "printing", "cutting"] as const)("does not promote %s operators through general reading", stage => {
    const account: ProductionUser = {
      ...user("view_production", `operate_${stage}`),
      production_role_binding: { mode: "operator", stages: [stage] },
    };
    expect(tabs(account)).toEqual([]);
    expect(initialPlanningPath(account)).toBeNull();
    expect(canOpenPlanningView(account, "management")).toBe(false);
    expect(canOpenPlanningView(account, "monitoring")).toBe(false);
    expect(initialProductionPath(account)).toBe(`/production/${stage}`);
    expect(canOpenProductionView(account, "roll")).toBe(true);
  });

  it("keeps a legacy read-only bound operator out of planning", () => {
    const account: ProductionUser = {
      ...user("view_production", "view_film_dashboard"),
      production_role_binding: { mode: "operator", stages: ["film"] },
    };
    expect(tabs(account)).toEqual([]);
    expect(initialProductionPath(account)).toBe("/production/film");
  });

  it("preserves nonoperator general reading regardless of a renamed role", () => {
    const account: ProductionUser = {
      ...user("view_production", "view_film_dashboard"),
      role_name: "Film Operator",
      production_role_binding: { mode: "general", stages: [] },
    };
    expect(tabs(account)).toEqual(["management"]);
  });

  it.each(["admin", "manage_production"])("preserves %s authority with an operator binding", permission => {
    const account: ProductionUser = {
      ...user(permission),
      production_role_binding: { mode: "operator", stages: ["film"] },
    };
    expect(canOpenPlanningView(account, "management")).toBe(true);
    expect(canOpenPlanningView(account, "monitoring")).toBe(permission === "admin");
  });

  it.each(["operate_film", "view_mixing", "receive_production", "view_finished_inventory", "*", "view_reports"])(
    "does not infer planning permission from %s", permission => {
      expect(tabs(user(permission))).toEqual([]);
      expect(initialPlanningPath(user(permission))).toBeNull();
    },
  );

  it("uses preview authority instead of original administrator authority", () => {
    const preview: ProductionUser = {
      ...user("view_production", "operate_film"),
      production_role_binding: { mode: "operator", stages: ["film"] },
    };
    expect(tabs(preview)).toEqual([]);
    const restored = user("admin");
    expect(tabs(restored)).toEqual(["management", "monitoring"]);
  });
});
