import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import router from "../server/routes";
import { db } from "../server/db";

jest.mock("../server/db", () => ({ db: { select: jest.fn() } }));
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

describe("items category filter", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let query: any;
  const dialect = new PgDialect();
  const get = (suffix = "", permission = "manage_items") => fetch(`${url}/api/items${suffix}`, {
    headers: { "x-test-permission": permission },
  });
  beforeAll(async () => {
    const app = express();
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => {
    jest.mocked(db.select).mockReset();
    query = {
      from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn<(offset: number) => Promise<unknown[]>>().mockResolvedValue([]),
    };
    jest.mocked(db.select).mockReturnValue(query);
  });
  it("keeps the default and empty category unfiltered", async () => {
    for (const suffix of ["", "?category_id="]) {
      expect((await get(suffix)).status).toBe(200);
      expect(query.where.mock.calls.at(-1)[0]).toBeUndefined();
    }
  });
  it("filters by exact category before applying pagination", async () => {
    expect((await get("?category_id=CAT01&limit=50&offset=50")).status).toBe(200);
    const compiled = dialect.sqlToQuery(query.where.mock.calls[0][0]);
    expect(compiled.sql).toContain('"items"."category_id" =');
    expect(compiled.params).toEqual(["CAT01"]);
    expect(query.limit).toHaveBeenCalledWith(50);
    expect(query.offset).toHaveBeenCalledWith(50);
  });
  it("combines category equality AND the existing search", async () => {
    expect((await get("?category_id=CAT02&search=bag")).status).toBe(200);
    const compiled = dialect.sqlToQuery(query.where.mock.calls[0][0]);
    expect(compiled.sql).toContain(" and ");
    expect(compiled.sql).toContain(" or ");
    expect(compiled.params[0]).toBe("CAT02");
    expect(compiled.params.slice(1).every(value => value === "%bag%")).toBe(true);
  });
  it.each(["?category_id=CAT01&category_id=CAT02", `?category_id=${"X".repeat(21)}`])(
    "rejects invalid category input: %s", async suffix => {
      expect((await get(suffix)).status).toBe(400);
      expect(db.select).not.toHaveBeenCalled();
    },
  );
  it("preserves the existing permission guard", async () => {
    expect((await get("?category_id=CAT01", "manage_users")).status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });
  it.each(["manage_items", "admin", "view_orders"])(
    "loads category options using the item read permission: %s", async permission => {
      expect((await get("/category-options?limit=2&offset=2", permission)).status).toBe(200);
      expect(Object.keys(jest.mocked(db.select).mock.calls[0][0] as object)).toEqual(["id", "name", "name_ar"]);
      expect(query.limit).toHaveBeenCalledWith(2);
      expect(query.offset).toHaveBeenCalledWith(2);
      expect(query.leftJoin).not.toHaveBeenCalled();
    },
  );
  it("does not grant item managers access to the category management endpoint", async () => {
    const response = await fetch(`${url}/api/categories`, {
      headers: { "x-test-permission": "manage_items" },
    });
    expect(response.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });
  it("rejects category-option reads without item permissions", async () => {
    expect((await get("/category-options", "manage_users")).status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });
});
