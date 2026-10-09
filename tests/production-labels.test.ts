import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createProductionRouter } from "../server/production/routes";
import { type ConnectionPool } from "../server/production/core";
import { productionPermissions } from "../shared/production";
import jsQR from "jsqr";
// pngjs is CommonJS and does not ship TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require("pngjs");

jest.mock("../server/db", () => ({ pool: {} }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => req.user
    ? next() : res.status(401).json({ message: "Login required" }),
}));

// Only fixture reads. No real DB connections, rolls, or receipts are created.
describe("private factory roll label endpoint", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  const release = jest.fn();
  const query = jest.fn<(sql: string, values?: any[]) => Promise<{ rows: any[] }>>();
  const connect = jest.fn<ConnectionPool["connect"]>();
  const records = [
    { id: 1, roll_number: "R-1", production_order_number: "PO-1", weight_kg: "57.25", batch_number: "B-1", stage: "done" },
    { id: 2, roll_number: "R-2", production_order_number: "PO-2", weight_kg: "19.50", batch_number: null, stage: "done" },
  ];
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const header = req.get("x-test-permissions");
      if (header !== undefined) req.user = { id: 1, permissions: header.split(",").filter(Boolean) } as any;
      next();
    });
    app.use("/api/production", createProductionRouter({ connect }));
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ message: "Unexpected error" }));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => {
    query.mockReset(); connect.mockReset(); release.mockClear();
    connect.mockResolvedValue({ query, release });
    query.mockImplementation(async (sql, values) => {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.startsWith("WITH selected")) {
        expect(sql).toContain("ORDER BY r.id DESC LIMIT");
        expect(sql).not.toContain("r.stage=");
        const before = sql.includes("r.id<") ? values![0] : Infinity;
        const search = values?.find(value => typeof value === "string") as string | undefined;
        const literal = search?.slice(1, -1).replace(/\\([\\%_])/g, "$1").toLowerCase();
        return { rows: records.filter(record => record.id < before && (!literal ||
          `${record.roll_number} ${record.production_order_number}`.toLowerCase().includes(literal)))
          .sort((a, b) => b.id - a.id).slice(0, values!.at(-1)) };
      }
      expect(sql).toMatch(/^SELECT /);
      const ids = Array.isArray(values?.[0]) ? values![0] : [values?.[0]];
      return { rows: records.filter(record => ids.includes(record.id)) };
    });
  });
  const labels = (roll_ids: unknown, permissions?: string) => fetch(`${origin}/api/production/labels`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(permissions === undefined ? {} : { "x-test-permissions": permissions }) },
    body: JSON.stringify({ roll_ids }),
  });
  it("requires login before any lookup", async () => {
    expect((await labels([1])).status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
  it("does not treat a role, wildcard or unrelated permission as roll access", async () => {
    for (const value of ["", "*", "view_orders"]) expect((await labels([1], value)).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(productionPermissions)("matches roll detail permissions for %s", async value => {
    expect((await labels([1], value)).status).toBe(200);
  });
  it("fetches current selected records once and preserves selected order", async () => {
    const response = await labels([2, 1], "admin");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.labels.map((label: any) => label.roll)).toEqual([records[1], records[0]]);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("SELECT "))).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
    for (const label of data.labels) {
      expect(label.qr.image).toMatch(/^data:image\/png;base64,/);
      const png = PNG.sync.read(Buffer.from(label.qr.image.split(",")[1], "base64"));
      expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(label.qr.url);
      const url = new URL(label.qr.url);
      expect(url.pathname).toBe(`/production/rolls/${label.roll.id}`);
      expect(url.search).toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
  });
  it("requires login and label permissions to discover rolls", async () => {
    expect((await fetch(`${origin}/api/production/labels`)).status).toBe(401);
    for (const value of ["", "*", "view_orders"]) {
      expect((await fetch(`${origin}/api/production/labels`, { headers: { "x-test-permissions": value } })).status).toBe(403);
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([...productionPermissions, "admin"])("allows bounded completed-roll discovery for %s", async permissions => {
    const response = await fetch(`${origin}/api/production/labels?limit=1`, { headers: { "x-test-permissions": permissions } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ records: [records[1]], next: 2 });
    expect(query.mock.calls.find(([sql]) => sql.startsWith("WITH selected"))?.[1]).toEqual([2]);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("paginates and searches completed rolls without changing general history permissions", async () => {
    const headers = { "x-test-permissions": "view_finished_inventory" };
    const response = await fetch(`${origin}/api/production/labels?before=2&limit=1&search=R-1`, { headers });
    expect(await response.json()).toEqual({ records: [records[0]], next: null });
    expect(query.mock.calls.find(([sql]) => sql.startsWith("WITH selected"))?.[1]).toEqual([2, "%R-1%", 2]);
    expect((await fetch(`${origin}/api/production/history/rolls`, { headers })).status).toBe(403);
  });
  it.each(["limit=101", "limit=0", "before=0", "before=1.5", "status=done", `search=${"x".repeat(121)}`])(
    "rejects invalid discovery filters %s before storage", async filters => {
      expect((await fetch(`${origin}/api/production/labels?${filters}`, { headers: { "x-test-permissions": "admin" } })).status).toBe(400);
      expect(connect).not.toHaveBeenCalled();
    },
  );
  it("fails the entire selection if any roll has disappeared", async () => {
    const response = await labels([1, 99], "operate_film");
    expect(response.status).toBe(404);
    expect((await response.json()).labels).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it.each([[], [1, 1], [0], [-1], [1.5], ["1"], [2147483648], Array.from({ length: 101 }, (_, i) => i + 1)].map(input => ({ input })))(
    "rejects invalid selection %# before touching storage", async ({ input }) => {
      expect((await labels(input, "admin")).status).toBe(400);
      expect(connect).not.toHaveBeenCalled();
    },
  );
  it("keeps individual QR and scanned detail behind the same guards", async () => {
    for (const suffix of ["/rolls/1", "/rolls/1/qr"]) {
      expect((await fetch(`${origin}/api/production${suffix}`)).status).toBe(401);
      expect((await fetch(`${origin}/api/production${suffix}`, { headers: { "x-test-permissions": "view_orders" } })).status).toBe(403);
    }
    expect(connect).not.toHaveBeenCalled();
    const response = await fetch(`${origin}/api/production/rolls/1/qr`, { headers: { "x-test-permissions": "operate_film" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).url).toBe(`${origin}/production/rolls/1`);
  });
});