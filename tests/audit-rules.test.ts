import { describe, expect, it } from "@jest/globals";
import {
  canGrantPermissions,
  isAdministrator,
  isProtectedProductionOrder,
  plannedFinalQuantity,
} from "../server/audit-rules";

describe("audited grant and production safety rules", () => {
  it("allows only an actor's own effective grants to be delegated", () => {
    const effective = ["manage_users", "view_orders"];
    expect(canGrantPermissions(effective, ["manage_users"])).toBe(true);
    expect(canGrantPermissions(effective, ["manage_users", "manage_orders"])).toBe(false);
    expect(canGrantPermissions(effective, ["admin"])).toBe(false);
    expect(canGrantPermissions(effective, ["*"])).toBe(false);
    expect(canGrantPermissions(["manage_roles", "admin"], ["*"])).toBe(true);
    expect(canGrantPermissions(["*"], ["admin"])).toBe(false);
    expect(canGrantPermissions(["*"], ["*"])).toBe(false);
    expect(canGrantPermissions(["*"], ["manage_roles", "manage_users", "view_orders"])).toBe(true);
    expect(canGrantPermissions(["admin"], ["admin", "*"])).toBe(true);
    expect(isAdministrator(["*"])).toBe(false);
    expect(isAdministrator(["admin"])).toBe(true);
  });

  it("derives a positive planned quantity from quantity and a bounded overrun", () => {
    expect(plannedFinalQuantity("100", "0")).toBe("100.00");
    expect(plannedFinalQuantity("100", "5")).toBe("105.00");
    expect(plannedFinalQuantity("10.25", "50")).toBe("15.38");
  });

  it("protects started, completed, historically started, and batched production orders", () => {
    expect(isProtectedProductionOrder("pending", null)).toBe(false);
    expect(isProtectedProductionOrder("active", null)).toBe(true);
    expect(isProtectedProductionOrder("completed", null)).toBe(true);
    expect(isProtectedProductionOrder("archived", null, "active")).toBe(true);
    expect(isProtectedProductionOrder("pending", null, "cancelled")).toBe(true);
    expect(isProtectedProductionOrder("pending", "BATCH-1")).toBe(true);
  });
});