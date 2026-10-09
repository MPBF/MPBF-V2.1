import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import router from "../server/routes";
import { db } from "../server/db";
import { requireAnyPermission, requirePermission } from "../server/auth";
import { roles, users } from "../shared/schema";

// Exercise the real auth middleware and route guards, without a live database.
jest.mock("../server/db", () => ({
  db: { delete: jest.fn(), transaction: jest.fn(), select: jest.fn(), insert: jest.fn() },
}));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));

describe("explicit administration permission", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.headers["x-test-permissions"] !== undefined) {
        req.user = {
          id: 7, role_id: Number(req.headers["x-test-role"] ?? 1),
          permissions: String(req.headers["x-test-permissions"]).split(",").filter(Boolean),
        } as any;
      }
      next();
    });
    app.get("/explicit-admin", requirePermission("admin"), (_req, res) => res.sendStatus(204));
    app.get("/ordinary", requirePermission("manage_orders"), (_req, res) => res.sendStatus(204));
    app.get("/mixed", requireAnyPermission("manage_orders", "admin"), (_req, res) => res.sendStatus(204));
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.status ?? 500).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  beforeEach(() => { jest.clearAllMocks(); });
  const request = (path: string, grants?: string, method = "GET", role = 1, body?: unknown) =>
    fetch(`${url}${path}`, { method, headers: {
      ...(grants === undefined ? {} : { "x-test-permissions": grants, "x-test-role": String(role) }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it.each(["*", "manage_orders", "manage_users", ""])("rejects %j for an admin-only guard", async grants => {
    expect((await request("/explicit-admin", grants)).status).toBe(403);
  });
  it("returns 401 for unauthenticated users", async () => {
    expect((await request("/explicit-admin")).status).toBe(401);
  });
  it.each(["admin", "*,admin"])("accepts explicit admin %j regardless of role number", async grants => {
    expect((await request("/explicit-admin", grants, "GET", 1)).status).toBe(204);
    expect((await request("/explicit-admin", grants, "GET", 10)).status).toBe(204);
  });
  it.each(["*", "manage_orders"])("preserves ordinary and mixed grants %j", async grants => {
    expect((await request("/ordinary", grants)).status).toBe(204);
    expect((await request("/mixed", grants)).status).toBe(204);
  });
  it("does not treat admin as an implicit ordinary grant", async () => {
    expect((await request("/ordinary", "admin")).status).toBe(403);
    expect((await request("/mixed", "admin")).status).toBe(204);
  });
  it.each([
    "users/7", "roles/10", "sections/SEC01", "customers/C1", "categories/CAT1",
    "items/ITM1", "master-batch-colors/MB1", "customer-products/1", "machines/MAC01",
    "orders/7", "production-orders/11", "maintenance-component-catalog/1", "system-settings/1",
  ])("denies wildcard-only deletion of %s before any database access", async path => {
    expect((await request(`/api/${path}`, "*", "DELETE", 10)).status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
  it("denies the admin-only dashboard to wildcard roles", async () => {
    expect((await request("/api/dashboard", "*")).status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });
  it.each(["admin", "*,admin"])("permits a real role deletion with %j", async grants => {
    const returning = jest.fn(async () => [{ id: 10 }]);
    jest.mocked(db.delete).mockReturnValue({ where: () => ({ returning }) } as any);
    expect((await request("/api/roles/10", grants, "DELETE")).status).toBe(200);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it.each(["admin", "*"])("blocks the create-role → assign-user → admin-action escalation through %j", async elevated => {
    const roleRows: any[] = [];
    const userRows: any[] = [];
    const insert = (table: unknown) => ({
      values: (values: any) => ({
        returning: async () => {
          const row = { ...values, id: 99 };
          (table === roles ? roleRows : userRows).push(row);
          return [row];
        },
      }),
    });
    const tx = {
      select: () => {
        const query: any = {
          from: () => query, where: () => query, for: () => query,
          limit: async () => roleRows,
        };
        return query;
      },
      insert,
    };
    jest.mocked(db.insert).mockImplementation(insert as any);
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    const rolePayload = { name: "Escalation regression fixture", permissions: [elevated] };
    expect((await request("/api/roles", "*", "POST", 1, rolePayload)).status).toBe(403);
    expect(roleRows).toEqual([]);
    // A pre-existing privileged role must not provide an alternative path.
    expect((await request("/api/roles", "admin", "POST", 1, rolePayload)).status).toBe(201);
    expect(roleRows).toHaveLength(1);
    const account = { username: "test-escalation", password: "test-password-123", role_id: 99 };
    expect((await request("/api/users", "*", "POST", 1, account)).status).toBe(403);
    expect(userRows).toEqual([]);
    expect((await request("/api/roles/10", "*", "DELETE")).status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();
    // Explicit administrators retain the ability to assign these roles.
    expect((await request("/api/users", "admin", "POST", 1, account)).status).toBe(201);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].role_id).toBe(99);
  });

  it.each(["admin", "*"])("blocks wildcard edits of roles and users carrying %j", async elevated => {
    const update = jest.fn();
    const tx = {
      select: () => {
        let table: unknown;
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          where: () => query, for: () => query,
          limit: async () => table === users ? [{ id: 7, role_id: 99 }] : [{ permissions: [elevated] }],
        };
        return query;
      },
      update,
    };
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    expect((await request("/api/roles/99", "*", "PUT", 1, { permissions: [] })).status).toBe(403);
    expect((await request("/api/users/7", "*", "PUT", 1, { password: "test-new-password" })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves wildcard delegation and assignment of ordinary permissions", async () => {
    const insert = jest.fn((_table: unknown) => ({
      values: (values: any) => ({ returning: async () => [{ ...values, id: 99 }] }),
    }));
    const tx = {
      select: () => {
        const query: any = {
          from: () => query, where: () => query, for: () => query,
          limit: async () => [{ permissions: ["view_orders", "manage_orders"] }],
        };
        return query;
      },
      insert,
    };
    jest.mocked(db.insert).mockImplementation(insert as any);
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => callback(tx) as any);
    expect((await request("/api/roles", "*", "POST", 1,
      { name: "Ordinary regression fixture", permissions: ["view_orders", "manage_orders"] })).status).toBe(201);
    expect((await request("/api/users", "*", "POST", 1,
      { username: "test-ordinary", password: "test-password-123", role_id: 99 })).status).toBe(201);
  });
});
