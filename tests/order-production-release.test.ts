import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { z } from "zod";
import router from "../server/routes";
import { pool } from "../server/db";
import { releaseOrderToProduction } from "../server/order-production-release";
import { canReleaseOrderToProduction } from "../shared/order-production-release";

jest.mock("../server/db", () => ({ db: {}, pool: { connect: jest.fn() } }));
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

let order: any, lines: any[], backup: any;
const query = jest.fn(async (statement: string, _values?: unknown[]) => {
  if (statement === "BEGIN") backup = structuredClone(order);
  if (statement === "ROLLBACK") order = backup;
  if (statement.startsWith("SELECT id,status")) return { rows: order ? [structuredClone(order)] : [] };
  if (statement.includes("FROM production_orders")) return { rows: structuredClone(lines) };
  if (statement.startsWith("UPDATE orders")) {
    order = { ...order, previous_status: order.status, status: "for_production" };
    return { rows: [structuredClone(order)] };
  }
  return { rows: [] };
});
const release = jest.fn();
beforeEach(() => {
  order = { id: 7, status: "waiting", previous_status: null, notes: "untouched" };
  lines = [{ id: 11, status: "pending", execution_id: null, quantity_kg: "10.00", final_quantity_kg: "11.00" }];
  query.mockClear(); release.mockClear();
  (pool.connect as jest.Mock).mockResolvedValue({ query, release } as never);
});

describe("safe release of customer orders", () => {
  it.each(["waiting", "on_hold", "paused"] as const)("releases %s without modifying production records", async status => {
    order.status = status;
    const beforeLines = structuredClone(lines);
    const result = await releaseOrderToProduction(7, status);
    expect(result.order.status).toBe("for_production");
    expect(result.order.previous_status).toBe(status);
    expect(order.notes).toBe("untouched");
    expect(lines).toEqual(beforeLines);
    expect(query.mock.calls.filter(([sql]) => /^UPDATE|^INSERT|^DELETE/.test(sql)).map(([sql]) => sql))
      .toEqual(["UPDATE orders SET previous_status=status,status='for_production' WHERE id=$1 RETURNING id,status,previous_status"]);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "completed", "delivered", "archived"])("does not reopen %s", async status => {
    order.status = status;
    await expect(releaseOrderToProduction(7, "waiting")).rejects.toMatchObject({ status: 409 });
    expect(order.status).toBe(status);
  });
  it.each(["for_production", "in_production"])("retry does not regress %s", async status => {
    order.status = status; order.previous_status = "on_hold";
    await releaseOrderToProduction(7, "waiting");
    expect(order.status).toBe(status); expect(order.previous_status).toBe("on_hold");
    expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("rejects a concurrent status change", async () => {
    order.status = "paused";
    await expect(releaseOrderToProduction(7, "waiting")).rejects.toMatchObject({ status: 409 });
    expect(order.status).toBe("paused");
  });
  it.each([{ lines: [] }, { lines: [{ status: "completed" }] }, { lines: [{ status: "active", execution_id: null }] }])("requires executable, non-historical lines: %j", async invalid => {
    lines = invalid.lines;
    await expect(releaseOrderToProduction(7, "waiting")).rejects.toMatchObject({ status: 409 });
    expect(order.status).toBe("waiting");
  });
  it("can resume a paused order with real active execution", async () => {
    order.status = "paused"; lines = [{ status: "active", execution_id: 11 }];
    await expect(releaseOrderToProduction(7, "paused")).resolves.toMatchObject({ order: { status: "for_production" } });
  });
  it("returns 404 and releases the connection for an absent order", async () => {
    order = null;
    await expect(releaseOrderToProduction(7, "waiting")).rejects.toMatchObject({ status: 404 });
    expect(release).toHaveBeenCalled();
  });
  it("client eligibility excludes finished and already released states", () => {
    expect(canReleaseOrderToProduction("waiting")).toBe(true);
    for (const value of [null, "cancelled", "archived", "completed", "for_production", "in_production"]) {
      expect(canReleaseOrderToProduction(value)).toBe(false);
    }
  });
});

describe("release endpoint permissions and payload", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.status ?? (error instanceof z.ZodError ? 400 : 500)).json({ message: error.message });
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const post = (permission: string, body: unknown = { expected_status: "waiting" }) =>
    fetch(`${url}/api/orders/7/release-production`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-test-permission": permission }, body: JSON.stringify(body) });
  it.each(["admin", "manage_orders"])("allows %s", async permission => {
    expect((await post(permission)).status).toBe(200);
  });
  it.each(["view_orders", "manage_production", "operate_film", ""])("denies %s before touching data", async permission => {
    expect((await post(permission)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it.each([{}, { expected_status: "completed" }, { expected_status: "waiting", status: "in_production" }])("rejects invalid or overriding payload %j", async body => {
    expect((await post("admin", body)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});