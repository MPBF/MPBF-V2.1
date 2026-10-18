import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { pool } from "../server/db";
import router from "../server/routes";
import { customerOrderHistory } from "../server/customer-order-history";

jest.mock("../server/db", () => ({ db: { select: jest.fn() }, pool: { connect: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) =>
    permissions.includes(req.headers["x-test-permission"]) ? next() : res.status(403).json({ message: "Forbidden" }),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(), hashPassword: jest.fn(),
}));

describe("customer-scoped order history", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  const query = jest.fn<any>();
  const release = jest.fn();
  beforeAll(async () => {
    const app = express();
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.status || (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => {
    jest.clearAllMocks();
    (pool.connect as jest.Mock<any>).mockResolvedValue({ query, release });
    query.mockResolvedValue({ rows: [{ customer_exists: true, orders: [] }] });
  });
  const request = (suffix = "", permission = "manage_customers") => fetch(
    `${url}/api/customers/C-1/order-history${suffix}`,
    { headers: { "x-test-permission": permission } },
  );

  it.each(["manage_customers", "manage_orders", "view_orders", "admin"])(
    "allows customer-profile readers with %s, without requiring production permissions", async permission => {
      const response = await request("", permission);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ orders: [], has_more: false, next_offset: null });
      expect(query.mock.calls[0][1]).toEqual(["C-1", 21, 0]);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["operate_film", "operate_printing", "view_finished_inventory", ""])(
    "does not disclose customer history to unrelated permission %s", async permission => {
      expect((await request("", permission)).status).toBe(403);
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );
  it.each(["?limit=0", "?limit=101", "?limit=1.5", "?offset=-1", "?offset=NaN", "?offset=1.2"])(
    "rejects invalid pagination %s before accessing data", async suffix => {
      expect((await request(suffix)).status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );
  it("pages whole orders, retaining all production lines and decimal text", async () => {
    const order = { id: 3, order_number: "O3", created_at: "2026-10-18", production_orders: [
      { id: 31, production_order_number: "JO3-1", requested_kg: "100.10", produced_kg: "120.01" },
      { id: 32, production_order_number: "JO3-2", requested_kg: "50.00", produced_kg: "0" },
    ] };
    query.mockResolvedValue({ rows: [{ customer_exists: true, orders: [order, { ...order, id: 2 }] }] });
    const response = await request("?limit=1&offset=2");
    expect(await response.json()).toEqual({ orders: [order], has_more: true, next_offset: 3 });
    expect(query.mock.calls[0][1]).toEqual(["C-1", 2, 2]);
  });
  it("returns 404 rather than treating an unknown customer as an empty history", async () => {
    query.mockResolvedValue({ rows: [{ customer_exists: false, orders: [] }] });
    expect((await request()).status).toBe(404);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("releases the connection and surfaces database errors", async () => {
    query.mockRejectedValue(new Error("query failed"));
    await expect(customerOrderHistory(pool, "C-1", 20, 0)).rejects.toThrow("query failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
