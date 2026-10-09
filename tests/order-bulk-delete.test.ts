import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../server/db";
import router from "../server/routes";

jest.mock("../server/db", () => ({
  db: { transaction: jest.fn(), select: jest.fn() }, pool: { connect: jest.fn() },
}));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: any, res: any, next: any) =>
    permissions.includes(req.headers["x-test-permission"]) ? next() : res.status(403).json({ message: "Forbidden" }),
  requirePermission: (permission: string) => (req: any, res: any, next: any) =>
    permission === req.headers["x-test-permission"] ? next() : res.status(403).json({ message: "Forbidden" }),
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  resolveUser: jest.fn(), hashPassword: jest.fn(),
}));

type State = { orders: { id: number; status: string }[]; production: number[] };
let state: State;
let statements: string[];
let failOnSecond: boolean;
const dialect = new PgDialect();

beforeEach(() => {
  state = { orders: [{ id: 1, status: "waiting" }, { id: 2, status: "completed" }], production: [1, 2] };
  statements = [];
  failOnSecond = false;
  (db.transaction as jest.Mock).mockReset();
  (db.transaction as jest.Mock).mockImplementation(async (callback: any) => {
    const draft = structuredClone(state);
    const tx = {
      execute: async (query: any) => {
        const compiled = dialect.sqlToQuery(query);
        statements.push(compiled.sql);
        if (failOnSecond && compiled.sql.includes("DELETE FROM factory_execution") && compiled.params.includes(2)) {
          throw new Error("simulated linked-record deletion failure");
        }
        if (compiled.sql.startsWith("DELETE FROM production_orders")) {
          draft.production = draft.production.filter((id) => id !== compiled.params[0]);
        }
        return [];
      },
      select: () => ({
        from: () => ({
          where: (condition: any) => ({
            orderBy: () => ({
              for: async () => {
                statements.push("LOCK PARENTS");
                const ids = dialect.sqlToQuery(condition).params;
                return draft.orders.filter((order) => ids.includes(order.id)).sort((a, b) => a.id - b.id);
              },
            }),
          }),
        }),
      }),
      delete: () => ({
        where: async (condition: any) => {
          const id = dialect.sqlToQuery(condition).params[0];
          statements.push(`DELETE PARENT ${id}`);
          draft.orders = draft.orders.filter((order) => order.id !== id);
        },
      }),
    };
    const result = await callback(tx);
    state = draft;
    return result;
  });
});

describe("atomic order bulk deletion", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const selected = () => [{ id: 2, expected_status: "completed" }, { id: 1, expected_status: "waiting" }];
  const request = (items: unknown, permission = "admin", extra = {}) =>
    fetch(`${url}/api/orders/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": permission },
      body: JSON.stringify({ items, ...extra }),
    });

  it("deletes all selected orders and production in one transaction, sorted by ID", async () => {
    const response = await request(selected());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ids: [1, 2] });
    expect(state).toEqual({ orders: [], production: [] });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(statements.slice(0, 3).every((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements[3]).toBe("LOCK PARENTS");
    expect(statements.filter((sql) => sql.startsWith("DELETE PARENT"))).toEqual(["DELETE PARENT 1", "DELETE PARENT 2"]);
    expect(statements.some((sql) => sql.includes("ri.production_order_id NOT IN"))).toBe(true);
  });
  it("retains all parents and production when deletion fails after the first order", async () => {
    failOnSecond = true;
    const original = structuredClone(state);
    const response = await request(selected());
    expect(response.status).toBe(500);
    expect(statements).toContain("DELETE PARENT 1");
    expect(state).toEqual(original);
  });
  it("does not mutate any order if one selected order is missing", async () => {
    const response = await request([...selected(), { id: 3, expected_status: "waiting" }]);
    expect(response.status).toBe(404);
    expect(state.production).toEqual([1, 2]);
    expect(statements.some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });
  it("rejects a concurrent status change without any deletion", async () => {
    state.orders[0].status = "in_production";
    const response = await request(selected());
    expect(response.status).toBe(409);
    expect((await response.json()).message_en).toContain("no orders were deleted");
    expect(state.production).toEqual([1, 2]);
    expect(statements.some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });
  it("leaves unselected orders untouched", async () => {
    const response = await request([{ id: 1, expected_status: "waiting" }]);
    expect(response.status).toBe(200);
    expect(state).toEqual({ orders: [{ id: 2, status: "completed" }], production: [2] });
  });
  it.each(["manage_orders", "view_orders", "manage_production", "*", ""])("denies non-admin permission %s before accessing storage", async (permission) => {
    const response = await request(selected(), permission);
    expect(response.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it.each([
    { items: [] },
    { items: [{ id: 1, expected_status: "waiting" }, { id: 1, expected_status: "waiting" }] },
    { items: [{ id: -1, expected_status: "waiting" }] },
    { items: [{ id: "1", expected_status: "waiting" }] },
    { items: [{ id: 1, expected_status: "invalid" }] },
    { items: Array.from({ length: 101 }, (_, index) => ({ id: index + 1, expected_status: "waiting" })) },
  ])("rejects malformed selection %# before accessing storage", async ({ items }) => {
    const response = await request(items);
    expect(response.status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("rejects extra fields rather than trusting a client permission override", async () => {
    expect((await request(selected(), "admin", { force: true })).status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
