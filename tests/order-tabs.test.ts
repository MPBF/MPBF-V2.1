import { describe, expect, it } from "@jest/globals";
import { availableOrderTabs, selectedOrderTab } from "../client/src/lib/order-tabs";

describe("orders page tabs", () => {
  it("shows both tabs to administrators and defaults to orders", () => {
    expect(availableOrderTabs(["admin"])).toEqual(["orders", "production"]);
    expect(availableOrderTabs(["*"])).toEqual(["orders", "production"]);
    expect(selectedOrderTab(null, ["admin"])).toBe("orders");
    expect(selectedOrderTab("production", ["admin"])).toBe("production");
  });

  it("keeps production-only users able to reach their permitted tab", () => {
    for (const permission of ["view_production", "manage_production"]) {
      expect(availableOrderTabs([permission])).toEqual(["production"]);
      expect(selectedOrderTab(null, [permission])).toBe("production");
      expect(selectedOrderTab("orders", [permission])).toBe("production");
    }
  });

  it("does not expose production data to orders-only users", () => {
    for (const permission of ["view_orders", "manage_orders"]) {
      expect(availableOrderTabs([permission])).toEqual(["orders"]);
      expect(selectedOrderTab("production", [permission])).toBe("orders");
    }
  });

  it("rejects users with no relevant permission and falls back for unknown tabs", () => {
    expect(availableOrderTabs(["manage_users"])).toEqual([]);
    expect(selectedOrderTab("production", [])).toBeNull();
    expect(selectedOrderTab("unknown", ["admin"])).toBe("orders");
  });
});