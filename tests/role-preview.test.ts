import express from "express";
import session from "express-session";
import { beforeAll, beforeEach, afterAll, describe, expect, it, jest } from "@jest/globals";
import { db } from "../server/db";
import { roles, users } from "../shared/schema";
import { populateUser, enforcePasswordChange, requirePermission, withRolePreview } from "../server/auth";
import rolePreviewRouter from "../server/role-preview";

jest.mock("../server/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("drizzle-orm", () => ({
  ...jest.requireActual<Record<string, unknown>>("drizzle-orm"),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

describe("session-scoped administrator role testing", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  let roleRecords: Map<number, { id: number; name: string; name_ar: string | null; permissions: string[] }>;
  let account: { id: number; username: string; status: string; role_id: number; must_change_password: boolean; section_id: string; preferred_language: "ar" };
  let mutations: { id: number; role_id: number | null; operation: string }[];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "fixture-only-session", resave: false, saveUninitialized: false }));
    app.post("/fixture-login", (req, res, next) => {
      req.session.regenerate(error => {
        if (error) return next(error);
        req.session.userId = account.id;
        req.session.save(saveError => saveError ? next(saveError) : res.json({ success: true }));
      });
    });
    app.post("/fixture-logout", (req, res, next) =>
      req.session.destroy(error => error ? next(error) : res.json({ success: true })));
    app.use("/api", populateUser, enforcePasswordChange);
    app.get("/api/me", (req, res) => req.user ? res.json({ user: req.user }) : res.sendStatus(401));
    app.use("/api/me/role-preview", rolePreviewRouter);
    for (const [route, permission] of [["admin", "admin"], ["orders", "manage_orders"], ["film", "operate_film"]]) {
      app.all(`/api/${route}`, requirePermission(permission), (req, res) => {
        if (req.method === "POST") mutations.push({ id: req.user!.id, role_id: req.user!.role_id, operation: route });
        res.json({ id: req.user!.id, role_id: req.user!.role_id });
      });
    }
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  beforeEach(() => {
    jest.clearAllMocks();
    mutations = [];
    account = { id: 7, username: "fixture-admin", status: "active", role_id: 10, must_change_password: false,
      section_id: "SECTION-ORIGINAL", preferred_language: "ar" };
    roleRecords = new Map([
      [10, { id: 10, name: "Administrator", name_ar: "مدير النظام", permissions: ["admin", "manage_orders"] }],
      [20, { id: 20, name: "Film operator", name_ar: "مشغل فيلم", permissions: ["operate_film"] }],
      [30, { id: 30, name: "Orders", name_ar: "الطلبات", permissions: ["manage_orders"] }],
      [40, { id: 40, name: "No permissions", name_ar: null, permissions: [] }],
      [50, { id: 50, name: "Wildcard", name_ar: null, permissions: ["*"] }],
      [60, { id: 60, name: "Management", name_ar: "الإدارة", permissions: ["manage_users", "manage_roles"] }],
    ]);
    jest.mocked(db.select).mockImplementation((selection?: unknown) => ({
      from: (table: unknown) => {
        let id: number | undefined;
        const query = {
          leftJoin: () => query,
          where: (predicate: { value: number }) => { id = predicate.value; return query; },
          limit: async () => table === users
            ? [{ user: { ...account }, role: roleRecords.get(account.role_id) }]
            : table === roles && id !== undefined && roleRecords.has(id) ? [{ ...roleRecords.get(id)! }] : [],
          orderBy: async () => [...roleRecords.values()].map(role => selection
            ? { id: role.id, name: role.name, name_ar: role.name_ar } : { ...role }),
        };
        return query;
      },
    }) as never);
  });
  const request = (route: string, cookie = "", method = "GET", body?: unknown) =>
    fetch(`${origin}${route.startsWith("/fixture-") ? route : `/api${route}`}`, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async () => {
    const response = await request("/fixture-login", "", "POST");
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const me = async (cookie: string) => (await (await request("/me", cookie)).json()).user;
  const choose = (cookie: string, id: number) => request("/me/role-preview", cookie, "POST", { role_id: id });

  it("offers role switching only to a genuine database-backed admin, without writing the account", async () => {
    const cookie = await login();
    expect(await me(cookie)).toMatchObject({ id: 7, role_id: 10, role_preview: { active: false, role_available: true } });
    const response = await request("/me/role-preview/roles", cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data.roles).toHaveLength(6);
    expect(Object.keys(data.roles[0]).sort()).toEqual(["id", "name", "name_ar"]);
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each([20, 30, 40, 50, 60])("blocks nonadmin role %s from list, switch, and restore", async roleId => {
    account.role_id = roleId;
    const cookie = await login();
    expect((await me(cookie)).role_preview).toBeUndefined();
    expect((await request("/me/role-preview/roles", cookie)).status).toBe(403);
    expect((await choose(cookie, 10)).status).toBe(403);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(403);
  });
  it.each([["/me/role-preview/roles", "GET"], ["/me/role-preview", "POST"], ["/me/role-preview", "DELETE"]])(
    "requires a signed-in session for %s %s", async (route, method) => {
      expect((await request(route, "", method, method === "POST" ? { role_id: 20 } : undefined)).status).toBe(401);
    });
  it("applies only selected grants to every business route and executes real writes as the original account", async () => {
    const cookie = await login();
    const response = await choose(cookie, 20);
    expect(response.status).toBe(200);
    const user = (await response.json()).user;
    expect(user).toMatchObject({ id: 7, username: "fixture-admin", section_id: "SECTION-ORIGINAL", role_id: 20,
      permissions: ["operate_film"], role_preview: { active: true, original_role: { id: 10 } } });
    expect(await me(cookie)).toEqual(user);
    expect((await request("/admin", cookie)).status).toBe(403);
    expect((await request("/orders", cookie, "POST")).status).toBe(403);
    expect((await request("/film", cookie, "POST")).status).toBe(200);
    expect(mutations).toEqual([{ id: 7, role_id: 20, operation: "film" }]);
    expect(account.role_id).toBe(10);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("keeps list, subsequent switches, and restoration available while testing a role with no permissions", async () => {
    const cookie = await login();
    expect((await choose(cookie, 40)).status).toBe(200);
    expect((await me(cookie)).permissions).toEqual([]);
    expect((await request("/admin", cookie)).status).toBe(403);
    expect((await request("/me/role-preview/roles", cookie)).status).toBe(200);
    expect((await choose(cookie, 20)).status).toBe(200);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(200);
    expect(await me(cookie)).toMatchObject({ role_id: 10, role_preview: { active: false }, permissions: ["admin", "manage_orders"] });
    expect((await request("/admin", cookie)).status).toBe(200);
  });
  it("can select the original role to clear preview and tolerates repeated restoration", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    expect((await choose(cookie, 10)).status).toBe(200);
    expect((await me(cookie)).role_preview.active).toBe(false);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(200);
  });
  it("does not let a wildcard test role bypass explicit admin checks", async () => {
    const cookie = await login();
    await choose(cookie, 50);
    expect((await request("/orders", cookie, "POST")).status).toBe(200);
    expect((await request("/admin", cookie, "POST")).status).toBe(403);
  });
  it.each([{}, { role_id: "20" }, { role_id: -1 }, { role_id: 0 }, { role_id: 1.5 },
    { role_id: 2147483648 }, { role_id: 20, permissions: ["admin"] }, { role_id: 20, user_id: 8 }])(
    "rejects invalid or client-forced role payload %j without changing effective permissions", async payload => {
      const cookie = await login();
      expect((await request("/me/role-preview", cookie, "POST", payload)).status).toBe(400);
      expect((await me(cookie)).role_id).toBe(10);
    });
  it("rejects a nonexistent role while preserving the current preview", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    expect((await choose(cookie, 999)).status).toBe(404);
    expect((await me(cookie)).role_id).toBe(20);
  });
  it("reflects live role-permission edits rather than trusting a saved grant snapshot", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    roleRecords.get(20)!.permissions = ["manage_orders"];
    expect((await request("/film", cookie, "POST")).status).toBe(403);
    expect((await request("/orders", cookie, "POST")).status).toBe(200);
    expect((await me(cookie)).permissions).toEqual(["manage_orders"]);
  });
  it("fails closed when the preview role is deleted, but keeps the original admin's return available", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    roleRecords.delete(20);
    expect(await me(cookie)).toMatchObject({ role_id: 20, permissions: [], role_preview: { active: true, role_available: false } });
    expect((await request("/film", cookie, "POST")).status).toBe(403);
    expect((await request("/admin", cookie, "POST")).status).toBe(403);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(200);
  });
  it("immediately removes switching authority when the original account loses its admin grant", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    roleRecords.get(10)!.permissions = ["manage_orders"];
    const user = await me(cookie);
    expect(user.role_id).toBe(10);
    expect(user.permissions).toEqual(["manage_orders"]);
    expect(user.role_preview).toBeUndefined();
    expect((await request("/me/role-preview/roles", cookie)).status).toBe(403);
    expect((await choose(cookie, 10)).status).toBe(403);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(403);
    expect((await request("/admin", cookie)).status).toBe(403);
  });
  it("retains the mandatory-password account boundary for every preview endpoint", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    account.must_change_password = true;
    expect((await me(cookie)).must_change_password).toBe(true);
    for (const [route, method] of [["/me/role-preview/roles", "GET"], ["/me/role-preview", "POST"], ["/me/role-preview", "DELETE"]]) {
      const response = await request(route, cookie, method, method === "POST" ? { role_id: 10 } : undefined);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });
  it("does not override a deactivated account's access restriction", async () => {
    const cookie = await login();
    await choose(cookie, 20);
    account.status = "inactive";
    expect((await request("/me", cookie)).status).toBe(401);
    expect((await request("/me/role-preview", cookie, "DELETE")).status).toBe(401);
  });
  it("keeps the preview session-local and clears it on logout and new sign-in", async () => {
    const first = await login(), other = await login();
    await choose(first, 20);
    expect((await me(first)).role_id).toBe(20);
    expect((await me(other)).role_id).toBe(10);
    await request("/fixture-logout", first, "POST");
    expect((await request("/me", first)).status).toBe(401);
    expect((await me(await login())).role_preview.active).toBe(false);
  });
  it("recognizes actual admin authority independently of the numeric role id", async () => {
    const otherAdmin = { ...roleRecords.get(10)!, id: 77 };
    roleRecords.set(77, otherAdmin);
    account.role_id = 77;
    const cookie = await login();
    expect((await choose(cookie, 20)).status).toBe(200);
    expect((await me(cookie)).role_preview.original_role.id).toBe(77);
  });
  it("does not project new authority onto a nonadmin user", () => {
    const user = { id: 7, username: "regular", display_name: null, display_name_ar: null, role_id: 20,
      role_name: "Film", role_name_ar: null, section_id: null, preferred_language: null, permissions: ["operate_film"], must_change_password: false };
    expect(withRolePreview(user, 10, roleRecords.get(10)!)).toBe(user);
  });
});
