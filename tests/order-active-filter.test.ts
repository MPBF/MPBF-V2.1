import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../server/db";
import router from "../server/routes";
import { orderFolderCounts } from "../server/order-workspace";
import { ORDER_ACTIVE_STATUSES, ORDER_DISPLAY_FOLDERS } from "../shared/order-workspace";
import { ORDER_FILTER_KEYS } from "../client/src/lib/order-workspace";

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

describe("active order filter", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let where: ReturnType<PgDialect["sqlToQuery"]> | undefined;
  let phases: string[];
  let requestedOffset: number;
  const dialect = new PgDialect();
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    where = undefined;
    phases = [];
    requestedOffset = -1;
    const builder: any = {
      from: () => builder,
      leftJoin: () => builder,
      where: (query: any) => {
        phases.push("where");
        where = query ? dialect.sqlToQuery(query) : undefined;
        return builder;
      },
      orderBy: () => builder,
      limit: () => { phases.push("limit"); return builder; },
      offset: (value: number) => { phases.push("offset"); requestedOffset = value; return Promise.resolve([]); },
    };
    (db.select as jest.Mock).mockReset().mockReturnValue(builder);
  });
  const request = (query = "", permission = "view_orders") =>
    fetch(`${url}/api/orders${query}`, { headers: { "x-test-permission": permission } });

  it("places Active first without converting it to a writable display folder", () => {
    expect(ORDER_FILTER_KEYS).toEqual(["active", "all", "new", "production", "archive"]);
    expect(ORDER_ACTIVE_STATUSES).toEqual(["waiting", "in_production"]);
    expect(ORDER_DISPLAY_FOLDERS).not.toContain("active");
    expect(ORDER_DISPLAY_FOLDERS).toContain("urgent");
  });
  it.each(["view_orders", "manage_orders", "admin"])("filters statuses on the server for %s", async (permission) => {
    const response = await request("?display_folder=active", permission);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(where?.sql).toContain('"orders"."status" in');
    expect(where?.sql).not.toContain('"order_display_folder_assignments"."folder" =');
    expect(where?.params).toEqual(["waiting", "in_production"]);
  });
  it("combines search with Active before applying pagination", async () => {
    expect((await request("?display_folder=active&search=customer&offset=50&limit=25")).status).toBe(200);
    expect(where?.sql).toContain("ilike");
    expect(where?.params).toContain("%customer%");
    expect(where?.params.slice(-2)).toEqual(["waiting", "in_production"]);
    expect(phases).toEqual(["where", "limit", "offset"]);
    expect(requestedOffset).toBe(50);
  });
  it("keeps All unfiltered and preserves legacy manual folder queries", async () => {
    expect((await request()).status).toBe(200);
    expect(where).toBeUndefined();
    expect((await request("?display_folder=urgent")).status).toBe(200);
    expect(where?.params).toEqual(["urgent"]);
    expect(where?.sql).not.toContain('"orders"."status"');
  });
  it("rejects unknown filters and unauthorized readers", async () => {
    expect((await request("?display_folder=bogus")).status).toBe(400);
    expect((await request("?display_folder=active", "manage_users")).status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });
  it("counts active orders across every manual folder without double-counting All", async () => {
    const query = jest.fn<any>().mockResolvedValue({ rows: [
      { folder: "new", count: 4, active_count: 1 },
      { folder: "production", count: 2, active_count: 1 },
      { folder: "urgent", count: 3, active_count: 2 },
      { folder: "archive", count: 1, active_count: 1 },
    ] });
    const release = jest.fn();
    const source = { connect: async () => ({ query, release }) };
    expect(await orderFolderCounts(source as any)).toEqual({
      counts: { active: 5, new: 4, production: 2, urgent: 3, archive: 1 }, total: 10,
    });
    expect(query.mock.calls[0][0]).toContain("FILTER (WHERE o.status=ANY($1::text[]))");
    expect(query.mock.calls[0][1]).toEqual([["waiting", "in_production"]]);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("reports zero for an empty database", async () => {
    const source = { connect: async () => ({ query: async () => ({ rows: [] }), release: jest.fn() }) };
    expect(await orderFolderCounts(source as any)).toEqual({
      counts: { active: 0, new: 0, production: 0, urgent: 0, archive: 0 }, total: 0,
    });
  });
});
