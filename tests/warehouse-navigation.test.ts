import { describe, expect, it } from "@jest/globals";
import { availableWarehouseViews, canOpenWarehouseView, initialWarehousePath } from "../client/src/lib/warehouse-navigation";
import { availableProductionViews, canOpenProductionView, initialProductionPath } from "../client/src/lib/production-navigation";
import type { ProductionUser } from "../shared/production";
const user = (...permissions: string[]): ProductionUser => ({ id: 7, permissions });
const tabs = (account: ProductionUser) => availableWarehouseViews(account).map(tab => tab.view);

describe("separate warehouse navigation with existing access boundaries", () => {
  it("gives administrators production/mixing and finished/raw warehouse tabs", () => {
    expect(availableProductionViews(user("admin")).map(tab => tab.view)).toEqual(["film", "printing", "cutting", "mixing"]);
    expect(tabs(user("admin"))).toEqual(["hall", "warehouse", "deliveries", "raw"]);
    expect(initialWarehousePath(user("admin"))).toBe("/warehouse/hall");
  });
  it.each([
    ["view_production_hall", ["hall"], "/warehouse/hall"],
    ["receive_production", ["hall", "warehouse"], "/warehouse/hall"],
    ["view_finished_inventory", ["warehouse", "deliveries"], "/warehouse/finished-inventory"],
    ["manage_finished_warehouse", ["warehouse", "deliveries"], "/warehouse/finished-inventory"],
  ] as const)("keeps the exact %s module permission", (permission, expected, path) => {
    const account = user(permission);
    expect(tabs(account)).toEqual(expected);
    expect(initialWarehousePath(account)).toBe(path);
    expect(initialProductionPath(account)).toBeNull();
    expect(canOpenProductionView(account, "hall")).toBe(false);
    expect(canOpenProductionView(account, "warehouse")).toBe(false);
    expect(canOpenProductionView(account, "roll")).toBe(true); // Existing private QR access.
    expect(canOpenWarehouseView(account, "roll")).toBe(true);
    expect(canOpenWarehouseView(account, "hall")).toBe(expected.some(view => view === "hall"));
    expect(canOpenWarehouseView(account, "warehouse")).toBe(expected.some(view => view === "warehouse"));
    expect(canOpenWarehouseView(account, "deliveries")).toBe(expected.some(view => view === "deliveries"));
  });
  it.each(["operate_film", "operate_printing", "operate_cutting", "manage_production", "view_production"])(
    "does not grant warehouse access through %s", permission => {
      const account = user(permission);
      expect(tabs(account)).toEqual([]);
      expect(initialWarehousePath(account)).toBeNull();
      expect(canOpenWarehouseView(account, "hall")).toBe(false);
      expect(canOpenWarehouseView(account, "warehouse")).toBe(false);
      expect(canOpenWarehouseView(account, "roll")).toBe(false);
    },
  );
  it("does not suppress explicitly granted warehouse access for stage-bound operators", () => {
    const account = { ...user("view_production", "view_film_dashboard", "operate_film", "receive_production"),
      production_role_binding: { mode: "operator", stages: ["film"] } } as ProductionUser;
    expect(availableProductionViews(account).map(tab => tab.view)).toEqual(["film", "mixing"]);
    expect(tabs(account)).toEqual(["hall", "warehouse"]);
  });
  it("shows neither module to an unrelated role", () => {
    expect(tabs(user("view_home"))).toEqual([]);
    expect(initialProductionPath(user("view_home"))).toBeNull();
    expect(initialWarehousePath(user("view_home"))).toBeNull();
  });
  it("does not grant customer delivery history through raw inventory or receiving alone", () => {
    for (const permission of ["view_raw_inventory", "manage_raw_materials", "receive_production"]) {
      expect(canOpenWarehouseView(user(permission), "deliveries")).toBe(false);
    }
  });
});
