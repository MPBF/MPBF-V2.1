import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { orders, production_orders } from "../shared/schema";
import { orderProductionTotals } from "../shared/order-details";
import { db } from "../server/db";
import { getOrderDetails } from "../server/order-details";
import router from "../server/routes";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) => {
    if (!permissions.includes(req.headers["x-test-permission"])) return res.status(403).end();
    req.user = { id: 42, permissions: [req.headers["x-test-permission"]] };
    next();
  },
  requirePermission: () => (_req: any, res: any) => res.status(403).end(),
  resolveUser: jest.fn(), hashPassword: jest.fn(),
}));

describe("order view and print details", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  let found: boolean;
  let lines: any[];
  let projections: Record<string, any>[];
  let header: any;

  beforeAll(async () => {
    const app = express();
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    jest.clearAllMocks();
    found = true;
    projections = [];
    header = {
      order: { id: 7, order_number: "123", customer_id: "CID010", created_by: 42, notes: "تعليمات الطلب" },
      customer: { id: "CID010", name: "Test", name_ar: "عميل تجريبي" },
      creator: { id: 42, display_name_ar: "منشئ تجريبي" },
      sales_representative: { id: 8, display_name_ar: "مندوب تجريبي" },
    };
    lines = [{
      production_order: { id: 9, order_id: 7, production_order_number: "123-01", quantity_kg: "300.00", final_quantity_kg: "330.00", status: "pending", batch_number: null },
      product: { id: 11, customer_id: "CID010", size_caption: "28+7+7X41", thickness: "10", universal_thickness: "25", notes: "تعليمات المنتج" },
      category: { id: "CAT01", name_ar: "أكياس" }, item: { id: "ITM01", name_ar: "بنانة" },
      color: { id: "PT01", name_ar: "أبيض", color_hex: "#ffffff" },
    }, {
      production_order: { id: 10, order_id: 7, production_order_number: "123-02", quantity_kg: "20.50", final_quantity_kg: "21.53", status: "completed" },
      product: null, category: null, item: null, color: null,
    }];
    const tx: any = {
      select: (projection: Record<string, any>) => {
        projections.push(projection);
        let table: unknown;
        const result = () => table === orders ? (found ? [header] : []) : table === production_orders ? lines : [];
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          leftJoin: () => query, where: () => query, orderBy: () => query,
          limit: async () => result(),
          then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
        };
        return query;
      },
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx));
  });
  const request = (permission: string, id = "7") =>
    fetch(`${origin}/api/orders/${id}/details`, { headers: { "x-test-permission": permission } });

  it.each(["view_orders", "manage_orders", "manage_production", "admin"])("allows %s to view and print the same full snapshot", async (permission) => {
    const response = await request(permission);
    expect(response.status).toBe(200);
    const detail: any = await response.json();
    expect(detail.creator.display_name_ar).toBe("منشئ تجريبي");
    expect(detail.production_orders).toHaveLength(2);
    expect(detail.production_orders[0].product.item.name_ar).toBe("بنانة");
    expect(detail.production_orders[0].product.universal_thickness).toBe("25");
    expect(detail.production_orders[1].product).toBeNull();
    expect(detail.totals).toEqual({
      requested_kg: "320.50", planned_kg: "351.53", production_order_count: 2,
      by_status: { pending: 1, completed: 1 },
    });
    expect(detail.actual_production.available).toBe(false);
    expect(detail.totals).not.toHaveProperty("produced_kg");
    expect(jest.mocked(db.transaction)).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "repeatable read", accessMode: "read only",
    });
  });
  it.each(["view_production", "manage_customers", "manage_users", ""])("does not grant order access to %s", async (permission) => {
    expect((await request(permission)).status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("never selects order share tokens, user passwords or HR/contact fields", async () => {
    await getOrderDetails(7);
    expect(projections[0].order).not.toHaveProperty("share_token");
    for (const person of [projections[0].creator, projections[0].sales_representative]) {
      expect(Object.keys(person).sort()).toEqual(["id", "display_name", "display_name_ar", "full_name", "username"].sort());
      for (const privateKey of ["password", "email", "phone", "national_id", "role_id"]) expect(person).not.toHaveProperty(privateKey);
    }
  });
  it("handles no lines, deleted creator and an unassigned representative without inventing names", async () => {
    lines = [];
    header.creator = null;
    header.sales_representative = null;
    const detail = await getOrderDetails(7);
    expect(detail?.creator).toBeNull();
    expect(detail?.totals).toEqual({ requested_kg: "0.00", planned_kg: "0.00", production_order_count: 0, by_status: {} });
  });
  it("returns a 404 for a missing order", async () => {
    found = false;
    expect((await request("view_orders")).status).toBe(404);
    expect(projections).toHaveLength(1);
  });
  it.each(["invalid", "0", "-1", "1.5"])("rejects invalid order ID %s before querying", async (id) => {
    expect((await request("view_orders", id)).status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("adds decimal quantities exactly, without deriving actual output from status", () => {
    expect(orderProductionTotals([
      { quantity_kg: "0.1", final_quantity_kg: "0.11", status: "completed" },
      { quantity_kg: "0.2", final_quantity_kg: "0.22", status: "active" },
    ])).toEqual({ requested_kg: "0.30", planned_kg: "0.33", production_order_count: 2, by_status: { completed: 1, active: 1 } });
    expect(() => orderProductionTotals([{ quantity_kg: "invalid", final_quantity_kg: "0.22", status: "pending" }])).toThrow();
  });
});