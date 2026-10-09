import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { db } from "../server/db";
import router from "../server/routes";
import { roles, system_settings } from "../shared/schema";
import { availableProductionViews } from "../client/src/lib/production-navigation";
import { productionRoleBindingSchema } from "../shared/production-role";
import { resolveProductionRoleBinding } from "../server/production-role";

jest.mock("../server/db", () => ({ db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), transaction: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("drizzle-orm", () => ({
  ...jest.requireActual<Record<string, unknown>>("drizzle-orm"),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

describe("persistent production role bindings through real role routes", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  let roleRows: Map<number, any>;
  let settingRows: Map<string, any>;
  let locks: unknown[];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 7, permissions: String(req.headers["x-grants"] ?? "admin").split(",") } as any;
      next();
    });
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  beforeEach(() => {
    jest.clearAllMocks();
    roleRows = new Map([
      [891, { id: 891, name: "Extruder Operator", name_ar: "مشغل فيلم", permissions: ["view_production", "view_film_dashboard"] }],
      [502, { id: 502, name: "Sales Representative", name_ar: "مندوب مبيعات", permissions: ["view_production", "view_film_dashboard"] }],
    ]);
    settingRows = new Map();
    locks = [];
    jest.mocked(db.select).mockImplementation((() => {
      let table: unknown;
      let filter: { column: unknown; value: unknown } | undefined;
      const rows = () => {
        if (table === roles) return filter ? (roleRows.has(Number(filter.value)) ? [{ ...roleRows.get(Number(filter.value)) }] : []) : [...roleRows.values()];
        return [...settingRows.values()].filter(row => !filter || (filter.column === system_settings.id ? row.id === filter.value : row.setting_key === filter.value));
      };
      const query = {
        from: (value: unknown) => { table = value; return query; },
        where: (value: any) => { filter = value; return query; },
        for: () => { locks.push(table); return query; },
        limit: async () => rows(),
        orderBy: async () => rows(),
      };
      return query;
    }) as never);
    jest.mocked(db.insert).mockImplementation((table: any) => ({
      values: (body: any) => ({
        returning: async () => {
          const role = { ...body, id: 999 };
          roleRows.set(role.id, role);
          return [role];
        },
        onConflictDoNothing: async () => {
          if (!settingRows.has(body.setting_key)) settingRows.set(body.setting_key, { ...body, id: settingRows.size + 1 });
        },
        onConflictDoUpdate: async ({ set }: any) => {
          settingRows.set(body.setting_key, { ...body, ...set, id: settingRows.get(body.setting_key)?.id ?? settingRows.size + 1 });
        },
      }),
    }) as never);
    jest.mocked(db.update).mockImplementation(() => ({
      set: (fields: any) => ({ where: ({ value }: any) => ({ returning: async () => {
        const role = { ...roleRows.get(value), ...fields };
        roleRows.set(value, role);
        return [role];
      } }) }),
    }) as never);
    jest.mocked(db.transaction).mockImplementation(async (callback: any) => {
      const oldRoles = new Map(roleRows), oldSettings = new Map(settingRows);
      try { return await callback(db); } catch (error) {
        roleRows = oldRoles; settingRows = oldSettings; throw error;
      }
    });
  });
  const request = (path: string, method = "GET", body?: unknown, grants = "admin") =>
    fetch(`${origin}/api${path}`, { method, headers: { "Content-Type": "application/json", "x-grants": grants },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const views = (role: any) => availableProductionViews({ id: 7, permissions: role.permissions, production_role_binding: role.production_role_binding }).map(view => view.view);

  it("initializes before the first rename even if no user ever opened the board or role list", async () => {
    const originalGrants = [...roleRows.get(891).permissions];
    const response = await request("/roles/891", "PUT", { name: "Night team", name_ar: "فريق الليل" });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.production_role_binding).toEqual({ mode: "operator", stages: ["film"] });
    expect(saved.permissions).toEqual(originalGrants);
    expect(views(saved)).toEqual(["film"]);
    expect(locks[0]).toBe(roles);
    const next = await (await request("/roles/891", "PUT", { name: "Printing Operator", name_ar: "مشغل القص" })).json();
    expect(views(next)).toEqual(["film"]);
    expect(await resolveProductionRoleBinding(891)).toEqual(saved.production_role_binding);
  });
  it("lists persisted bindings and keeps Sales general after an operator-like rename", async () => {
    const response = await request("/roles");
    expect(response.status).toBe(200);
    const listed = await response.json();
    expect(views(listed.find((role: any) => role.id === 891))).toEqual(["film"]);
    const sales = await (await request("/roles/502", "PUT", { name: "Film Operator", name_ar: "مشغل فيلم" })).json();
    expect(views(sales)).toEqual(["management", "film", "printing", "cutting"]);
    expect(sales.permissions).toEqual(["view_production", "view_film_dashboard"]);
  });
  it("persists explicit multi-stage bindings without adding any grants and reflects revocation", async () => {
    const created = await request("/roles", "POST", { name: "Combined", permissions: ["view_production", "view_film_dashboard", "view_cutting_dashboard"],
      production_role_binding: { mode: "operator", stages: ["film", "cutting"] } });
    expect(created.status).toBe(201);
    expect(views(await created.json())).toEqual(["film", "cutting"]);
    const revoked = await (await request("/roles/999", "PUT", { permissions: ["view_production", "view_cutting_dashboard"] })).json();
    expect(views(revoked)).toEqual(["cutting"]);
    expect(revoked.production_role_binding.stages).toEqual(["film", "cutting"]);
    const empty = await (await request("/roles/999", "PUT", { production_role_binding: { mode: "operator", stages: [] } })).json();
    expect(views(empty)).toEqual([]);
  });
  it.each([
    { mode: "operator", stages: ["hall"] },
    { mode: "operator", stages: ["film", "film"] },
    { mode: "general", stages: ["film"] },
    { mode: "admin", stages: [] },
    { mode: "operator", stages: ["film"], permissions: ["admin"] },
  ])("rejects invalid binding %j without changing grants or settings", async binding => {
    expect(productionRoleBindingSchema.safeParse(binding).success).toBe(false);
    expect((await request("/roles/891", "PUT", { production_role_binding: binding })).status).toBe(400);
    expect(settingRows.size).toBe(0);
    expect(roleRows.get(891).permissions).toEqual(["view_production", "view_film_dashboard"]);
  });
  it("cannot bypass role-write permission or reset the binding through generic settings", async () => {
    expect((await request("/roles/891", "PUT", { production_role_binding: { mode: "general", stages: [] } }, "view_roles")).status).toBe(403);
    await request("/roles");
    const key = "production_role_binding:891";
    const setting = settingRows.get(key);
    expect((await request("/system-settings", "POST", { setting_key: key, setting_value: "{}" })).status).toBe(403);
    expect((await request(`/system-settings/${setting.id}`, "PUT", { setting_value: "{}" })).status).toBe(403);
    expect((await request(`/system-settings/${setting.id}`, "DELETE")).status).toBe(403);
    expect(await resolveProductionRoleBinding(891)).toEqual({ mode: "operator", stages: ["film"] });
  });
  it("rolls back initialization when a rename cannot commit", async () => {
    jest.mocked(db.update).mockImplementationOnce(() => { throw new Error("fixture commit failure"); });
    expect((await request("/roles/891", "PUT", { name: "New" })).status).toBe(500);
    expect(roleRows.get(891).name).toBe("Extruder Operator");
    expect(settingRows.size).toBe(0);
  });
});
