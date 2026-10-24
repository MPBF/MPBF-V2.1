import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { pool } from "../server/db";
import router from "../server/routes";
import { orderWorkflow } from "../server/order-workflow";
import { canViewOrderWorkflow } from "../shared/order-workflow";

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

describe("permission-scoped order workflow", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  const query = jest.fn<any>();
  const release = jest.fn();
  const summary = { order: { id: 1, order_number: "O1" }, production_orders: [] };
  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { permissions: [req.headers["x-test-permission"]] } as any;
      next();
    });
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
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes("WITH lines") ? [summary] : [] }));
  });
  const request = (suffix = "", permission = "admin", id = "1") => fetch(
    `${url}/api/orders/${id}/workflow${suffix}`, { headers: { "x-test-permission": permission } });
  it.each(["admin", "manage_production"])("allows %s", async permission => {
    expect(canViewOrderWorkflow({ permissions: [permission] })).toBe(true);
    const response = await request("", permission);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...summary, rolls: [], has_more: false, next_offset: null });
    expect(query.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(query.mock.calls[3][0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each(["view_orders", "manage_orders", "manage_customers", "view_production", "operate_film", "operate_printing", "operate_cutting", "*", ""])(
    "rejects %s before DB access and matches UI policy", async permission => {
      expect(canViewOrderWorkflow({ permissions: [permission] })).toBe(false);
      expect((await request("", permission)).status).toBe(403);
      expect(pool.connect).not.toHaveBeenCalled();
    });
  it.each(["?limit=0", "?limit=101", "?offset=-1", "?stage=cutting", "?production_order_id=0",
    "?production_order_id=1.5", "?limit=NaN", "?search=" + "x".repeat(101)])(
    "validates query %s", async suffix => {
      expect((await request(suffix)).status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });
  it.each(["0", "-1", "1.5", "abc"])("validates order ID %s", async id => {
    expect((await request("", "admin", id)).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("passes bound filters and returns accurate pagination", async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("WITH lines") ? [summary] : sql.includes("SELECT r.id") ? [{ id: 3 }, { id: 2 }] : [],
    }));
    const response = await request("?limit=1&offset=4&production_order_id=31&stage=done&search=ROLL%25");
    expect(await response.json()).toEqual({ ...summary, rolls: [{ id: 3 }], has_more: true, next_offset: 5 });
    expect(query.mock.calls[2][1]).toEqual([1, 31, "done", "ROLL%", 2, 4]);
  });
  it("404 rolls back and releases", async () => {
    query.mockResolvedValue({ rows: [] });
    expect((await request()).status).toBe(404);
    expect(query.mock.calls[2][0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("preserves original errors even when rollback fails", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("BEGIN")) return { rows: [] };
      throw new Error(sql === "ROLLBACK" ? "rollback error" : "read error");
    });
    await expect(orderWorkflow(pool, 1, { limit: 30, offset: 0 })).rejects.toThrow("read error");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
