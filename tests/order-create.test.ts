import express from "express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { categories, customers, customer_products, orders, production_orders } from "../shared/schema";
import { deliveryDateFromDays, orderDateInRiyadh } from "../server/order-delivery";
import router from "../server/routes";
import { db } from "../server/db";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn(), execute: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) => {
    if (!permissions.includes(req.headers["x-test-permission"])) return res.status(403).end();
    req.user = { id: 42 };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(),
  hashPassword: jest.fn(),
}));

describe("creating an order with delivery days", () => {
  it("provides an uncached, read-only order-number preview to order creators", async () => {
    jest.mocked(db.execute).mockResolvedValueOnce({ rows: [{ max_number: null }] } as any)
      .mockResolvedValueOnce({ rows: [{ used: false }] } as any);
    const result = await fetch(`${url}/api/orders/next-number`, {
      headers: { "x-test-permission": "manage_orders" },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ order_number: "O0001" });
    expect(jest.mocked(db.execute).mock.calls).toHaveLength(2);
    const denied = await fetch(`${url}/api/orders/next-number`, {
      headers: { "x-test-permission": "view_customers" },
    });
    expect(denied.status).toBe(403);
    jest.mocked(db.execute).mockReset();
  });
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it.each([0, 5, 10, 20])("assigns order identifiers and snapshots category rate %s%%", async (percentage) => {
    const tx = {
      execute: async () => ({ rows: [{ max_number: "19" }] }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            const query = {
              limit: async () => table === customers ? [{ id: "C1" }] :
                table === customer_products ? [{ id: 3, category_id: "CAT1" }] :
                  table === categories ? [{ id: "CAT1", overrun_percentage: percentage }] : [],
            };
            return { ...query, for: () => query };
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => [{ id: table === orders ? 7 : 11, ...values }],
        }),
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    const response = await fetch(`${url}/api/orders/with-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": "manage_orders" },
      body: JSON.stringify({ customer_id: "C1", delivery_days: 20, items: [
        { customer_product_id: 3, quantity_kg: "10.00" },
        { customer_product_id: 3, quantity_kg: "20.00" },
      ] }),
    });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.order.order_number).toBe("O0020");
    expect(result.order.delivery_days).toBe(20);
    expect(result.order.delivery_date).toBe(deliveryDateFromDays(orderDateInRiyadh(new Date(result.order.created_at)), 20));
    expect(result.production_orders[0].production_order_number).toBe("O0020-JO01");
    expect(result.production_orders[1].production_order_number).toBe("O0020-JO02");
    expect(result.production_orders[0]).toMatchObject({
      quantity_kg: "10.00", overrun_percentage: String(percentage),
      final_quantity_kg: (10 * (1 + percentage / 100)).toFixed(2),
    });
  });

  function directTransaction(parentNumber: string, existingNumbers: string[] = []) {
    const writes: { table: unknown; values: Record<string, unknown> }[] = [];
    const tx = {
      execute: async () => ({ rows: [{ max_number: "25" }] }),
      select: () => ({
        from: (table: unknown) => {
          const rows = table === orders ? [{ id: 7, customer_id: "C1", order_number: parentNumber }] :
            table === production_orders ? existingNumbers.map(production_order_number => ({ production_order_number })) : [];
          const query: any = {
            where: () => query, for: () => query, limit: async () => rows,
            then: (resolve: (rows: any[]) => unknown) => Promise.resolve(rows).then(resolve),
          };
          return query;
        },
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          writes.push({ table, values });
          return { returning: async () => [{ id: 99, ...values }] };
        },
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    return writes;
  }

  it("uses the shared allocator for direct customer-order creation", async () => {
    directTransaction("unused");
    const response = await fetch(`${url}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": "manage_orders" },
      body: JSON.stringify({ customer_id: "C1", order_number: "CLIENT-NUMBER" }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).order_number).toBe("O0026");
  });

  it.each([undefined, "CLIENT-NUMBER"])("generates direct children of new-format orders, ignoring supplied number %s", async (supplied) => {
    directTransaction("O00025", ["O00025-JO01", "O00025-JO03"]);
    const response = await fetch(`${url}/api/production-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": "manage_production" },
      body: JSON.stringify({ order_id: 7, quantity_kg: "10.00", production_order_number: supplied }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).production_order_number).toBe("O00025-JO04");
  });

  it("keeps explicitly supplied legacy direct-production identifiers unchanged", async () => {
    directTransaction("000025");
    const response = await fetch(`${url}/api/production-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": "manage_production" },
      body: JSON.stringify({ order_id: 7, quantity_kg: "10.00", production_order_number: "LEGACY-25-07" }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).production_order_number).toBe("LEGACY-25-07");
  });
});