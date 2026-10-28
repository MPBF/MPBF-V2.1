import { describe, expect, it, jest } from "@jest/globals";
import { warehouseKeeperPermissions, warehouseWorkPermissions, isWarehouseOnlyAccount, canOpenWarehouseAccountPath } from "../shared/warehouse-access";
import { availableWarehouseViews } from "../client/src/lib/warehouse-navigation";
import { availableProductionViews } from "../client/src/lib/production-navigation";
import { availablePlanningViews } from "../client/src/lib/planning-navigation";
import { canRecordMixing, canViewRawInventory } from "../shared/raw-mixing";
import { ProductionReadService } from "../server/production/read";
import type { ConnectionPool } from "../server/production/core";

const oldGrants = [
  "view_home", "view_user_dashboard", "view_production", "view_warehouse",
  "manage_inventory", "view_inventory", "manage_warehouse", "view_reports",
  "view_warehouse_vouchers", "manage_production_hall", "view_warehouse_reports",
  "manage_warehouse_vouchers",
];
const permissions = warehouseKeeperPermissions(oldGrants);
const account = { id: 8, permissions };

describe("warehouse keeper's two-page boundary", () => {
  it("retains legacy warehouse work and adds current permissions without general production/report access", () => {
    expect(oldGrants).toContain("view_production");
    expect(permissions).not.toContain("view_production");
    expect(permissions).not.toContain("view_reports");
    for (const grant of [...warehouseWorkPermissions, "manage_inventory", "manage_warehouse_vouchers"]) {
      expect(permissions).toContain(grant);
    }
    expect(warehouseKeeperPermissions(permissions)).toEqual(permissions);
    expect(isWarehouseOnlyAccount(account)).toBe(true);
    expect(availableWarehouseViews(account).map(view => view.view)).toEqual(["hall", "warehouse", "deliveries", "raw"]);
    expect(availableProductionViews(account)).toEqual([]);
    expect(availablePlanningViews(account)).toEqual([]);
    expect(canRecordMixing(account)).toBe(false);
    expect(canViewRawInventory(account)).toBe(true);
  });
  it.each(["admin", "*", "manage_production", "operate_film", "manage_customers", "manage_hr"])(
    "does not narrow other roles with an explicit %s grant", grant => {
      expect(isWarehouseOnlyAccount({ permissions: [...permissions, grant] })).toBe(false);
    },
  );
  it("does not treat unrelated or missing roles as warehouse keepers", () => {
    expect(isWarehouseOnlyAccount({})).toBe(false);
    expect(isWarehouseOnlyAccount({ permissions: ["view_user_dashboard"] })).toBe(false);
  });
  it.each([
    "/", "/my-dashboard", "/warehouse", "/warehouse/hall", "/warehouse/finished-inventory",
    "/warehouse/raw-materials", "/warehouse/rolls/3", "/production/hall",
    "/production/warehouse", "/production/rolls/3",
  ])("preserves allowed route or warehouse bookmark %s", path => {
    expect(canOpenWarehouseAccountPath(path)).toBe(true);
  });
  it.each([
    "/orders", "/orders/3/print", "/customers", "/customers/4", "/products", "/admin", "/hr",
    "/planning", "/planning/monitoring", "/production", "/production/film",
    "/production/printing", "/production/cutting", "/production/mixing",
    "/production/monitoring", "/warehouse-other", "/unknown",
  ])("blocks direct unrelated page %s before mounting it", path => {
    expect(canOpenWarehouseAccountPath(path)).toBe(false);
  });
  it.each(["film", "printing", "cutting"] as const)(
    "backend refuses %s state before any database access", async scope => {
      const connect = jest.fn();
      const read = new ProductionReadService({ connect } as unknown as ConnectionPool);
      await expect(read.state(account, scope)).rejects.toMatchObject({ status: 403 });
      expect(connect).not.toHaveBeenCalled();
    },
  );
  it.each(["orders", "rolls"] as const)(
    "backend refuses general production history %s", async kind => {
      const connect = jest.fn();
      const read = new ProductionReadService({ connect } as unknown as ConnectionPool);
      await expect(read.history(account, kind, {})).rejects.toMatchObject({ status: 403 });
      expect(connect).not.toHaveBeenCalled();
    },
  );
});
