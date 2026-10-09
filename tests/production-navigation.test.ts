import { describe, expect, it } from "@jest/globals";
import { availableProductionViews, canOpenProductionView, initialProductionPath } from "../client/src/lib/production-navigation";
import type { ProductionUser } from "../shared/production";

const user = (...permissions: string[]): ProductionUser => ({ id: 7, permissions });
const tabs = (account: ProductionUser) => availableProductionViews(account).map(item => item.view);

describe("production operator tab boundaries", () => {
  it.each(["film", "printing", "cutting"] as const)("limits %s operators despite general read grants", stage => {
    const account = user(`operate_${stage}`, "view_production", "view_production_hall", "receive_production", "view_finished_inventory");
    expect(tabs(account)).toEqual([stage]);
    expect(initialProductionPath(account)).toBe(`/production/${stage}`);
    for (const view of ["management", "film", "printing", "cutting", "hall", "warehouse"] as const) {
      expect(canOpenProductionView(account, view)).toBe(view === stage);
    }
    expect(canOpenProductionView(account, "roll")).toBe(true);
  });
  it.each(["film", "printing", "cutting"] as const)("keeps the minimal %s operator grant functional", stage => {
    const account = user(`operate_${stage}`);
    expect(tabs(account)).toEqual([stage]);
    expect(initialProductionPath(account)).toBe(`/production/${stage}`);
  });
  it("shows all explicitly granted stages for multi-stage operators", () => {
    const account = user("view_production", "operate_printing", "operate_cutting");
    expect(tabs(account)).toEqual(["printing", "cutting"]);
    expect(initialProductionPath(account)).toBe("/production/printing");
    expect(canOpenProductionView(account, "film")).toBe(false);
  });
  it("keeps administrator tabs unchanged, including during an admin role preview", () => {
    const account = user("admin", "operate_film");
    expect(tabs(account)).toEqual(["management", "film", "printing", "cutting", "hall", "warehouse"]);
    expect(initialProductionPath(account)).toBe("/production");
  });
  it("keeps production management grants unchanged even with an operational grant", () => {
    const account = user("manage_production", "operate_film");
    expect(tabs(account)).toEqual(["management", "film", "printing", "cutting"]);
    expect(initialProductionPath(account)).toBe("/production");
    expect(canOpenProductionView(account, "hall")).toBe(false);
  });
  it("preserves general read, receiving and inventory navigation for non-operators", () => {
    expect(tabs(user("view_production"))).toEqual(["management", "film", "printing", "cutting"]);
    expect(tabs(user("receive_production"))).toEqual(["hall", "warehouse"]);
    expect(tabs(user("view_finished_inventory"))).toEqual(["warehouse"]);
  });
  it.each([[], ["*"], ["view_film_dashboard"], ["view_printing_dashboard"], ["view_cutting_dashboard"]].map(permissions => ({ permissions })))(
    "does not invent production grants from $permissions", ({ permissions }) => {
      expect(tabs(user(...permissions))).toEqual([]);
      expect(initialProductionPath(user(...permissions))).toBeNull();
      expect(canOpenProductionView(user(...permissions), "roll")).toBe(false);
    },
  );
});
