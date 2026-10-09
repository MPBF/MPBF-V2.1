import fs from "node:fs";
import path from "node:path";
import express from "express";
import session from "express-session";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import router from "../server/routes";
import { enforcePasswordChange, populateUser, requirePermission } from "../server/auth";
import { db } from "../server/db";
import { users } from "../shared/schema";

// Real session, authentication resolution, password route and API gate; no live DB.
jest.mock("../server/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("bcrypt", () => ({
  __esModule: true,
  default: { compare: jest.fn(async () => true), hash: jest.fn(async () => "fixture-hash") },
}));

describe("server-enforced mandatory password change", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  let user: Record<string, unknown>;
  let permissions: string[];
  let businessCalls = 0;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "test-only-session", resave: false, saveUninitialized: false }));
    app.use("/api", populateUser);
    app.use("/api", enforcePasswordChange);
    app.get("/api/test-business", requirePermission("manage_orders"), (_req, res) => {
      businessCalls += 1;
      res.json({ success: true });
    });
    app.use("/api", router);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())));
  beforeEach(() => {
    jest.clearAllMocks();
    permissions = ["admin", "manage_orders"];
    businessCalls = 0;
    user = {
      id: 7, username: "fixture", password: "fixture-hash", status: "active",
      display_name: "Test employee", display_name_ar: null, role_id: 10, section_id: null,
      preferred_language: "ar", must_change_password: true,
    };
    jest.mocked(db.select).mockImplementation(() => {
      const query = {
        leftJoin: () => query,
        where: () => query,
        limit: async () => [{ user: { ...user }, role: { permissions: [...permissions] } }],
      };
      return { from: () => query } as never;
    });
    jest.mocked(db.update).mockImplementation(table => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          expect(table).toBe(users);
          Object.assign(user, values);
          return {
            then: (resolve: () => unknown) => Promise.resolve().then(resolve),
            returning: async () => [{ preferred_language: user.preferred_language }],
          };
        },
      }),
    }) as never);
  });

  const request = (route: string, cookie = "", method = "GET", body?: unknown) =>
    fetch(`${origin}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined || ["GET", "HEAD"].includes(method) ? {} : { body: JSON.stringify(body) }),
    });
  async function login() {
    const response = await request("/login", "", "POST", { username: "fixture", password: "fixture-password" });
    expect(response.status).toBe(200);
    expect((await response.json()).user.must_change_password).toBe(user.must_change_password);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    return cookie!;
  }
  async function expectBlocked(response: Response) {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
  }

  it("is wired after fresh user resolution and before every API router", () => {
    const index = fs.readFileSync(path.join(process.cwd(), "server/index.ts"), "utf8");
    const resolve = index.indexOf('app.use("/api", populateUser)');
    const gate = index.indexOf('app.use("/api", enforcePasswordChange)');
    const routes = index.indexOf('app.use("/api", api)');
    expect(resolve).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(resolve);
    expect(routes).toBeGreaterThan(gate);
  });

  it.each([
    ["GET", "/users"], ["POST", "/users"], ["PUT", "/users/7"], ["DELETE", "/users/7"],
    ["GET", "/orders"], ["POST", "/orders/with-items"],
    ["GET", "/production/queue"], ["POST", "/production/orders/1/start"],
    ["GET", "/hr/attendance"], ["GET", "/self/attendance"], ["POST", "/self/attendance"],
    ["POST", "/self/messages"], ["POST", "/self/requests"],
    ["GET", "/test-business"], ["GET", "/me/extra"], ["POST", "/me"], ["GET", "/change-password"],
  ])("blocks %s %s even for an administrator before changing the password", async (method, route) => {
    const cookie = await login();
    jest.mocked(db.select).mockClear();
    await expectBlocked(await request(route, cookie, method, { must_change_password: false }));
    expect(db.select).toHaveBeenCalledTimes(1); // User lookup only; no business handler.
    expect(db.update).not.toHaveBeenCalled();
    expect(businessCalls).toBe(0);
  });

  it("does not let wildcard permissions bypass the restriction", async () => {
    permissions = ["*"];
    await expectBlocked(await request("/test-business", await login()));
    expect(businessCalls).toBe(0);
  });
  it("keeps the session check, branding and language selector available", async () => {
    const cookie = await login();
    const me = await request("/me/?refresh=1", cookie);
    expect(me.status).toBe(200);
    expect((await me.json()).user.must_change_password).toBe(true);
    expect((await request("/me", cookie, "HEAD")).status).toBe(200);
    expect((await request("/public-branding", cookie)).status).toBe(200);
    const language = await request("/me/language", cookie, "PUT", { preferred_language: "en" });
    expect(language.status).toBe(200);
    expect(await language.json()).toEqual({ preferred_language: "en" });
    expect((await (await request("/me", cookie)).json()).user)
      .toMatchObject({ preferred_language: "en", must_change_password: true });
    await expectBlocked(await request("/test-business", cookie));
  });
  it("keeps logout available and preserves unauthenticated 401 responses", async () => {
    expect((await request("/me")).status).toBe(401);
    const cookie = await login();
    expect((await request("/logout", cookie, "POST")).status).toBe(200);
    expect((await request("/me", cookie)).status).toBe(401);
    expect((await request("/test-business", cookie)).status).toBe(401);
  });
  it("keeps the restriction after a rejected password", async () => {
    const cookie = await login();
    expect((await request("/change-password", cookie, "POST", { password: "short" })).status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
    await expectBlocked(await request("/test-business", cookie));
  });
  it("keeps the restriction if saving the password fails", async () => {
    const cookie = await login();
    jest.mocked(db.update).mockImplementationOnce(() => ({
      set: () => ({ where: async () => { throw new Error("Fixture database failure"); } }),
    }) as never);
    expect((await request("/change-password", cookie, "POST", { password: "fixture-new-password" })).status).toBe(500);
    expect(user.must_change_password).toBe(true);
    await expectBlocked(await request("/test-business", cookie));
  });
  it("restores permitted access in the same session only after a saved password change", async () => {
    const cookie = await login();
    await expectBlocked(await request("/test-business", cookie));
    expect((await request("/change-password", cookie, "POST", { password: "fixture-new-password" })).status).toBe(200);
    expect(user).toMatchObject({ password: "fixture-hash", must_change_password: false });
    expect((await request("/me", cookie)).status).toBe(200);
    expect((await request("/test-business", cookie)).status).toBe(200);
    expect(businessCalls).toBe(1);
  });
  it("does not affect ordinary accounts or weaken permission checks", async () => {
    user.must_change_password = false;
    const cookie = await login();
    expect((await request("/test-business", cookie)).status).toBe(200);
    permissions = [];
    expect((await request("/test-business", cookie)).status).toBe(403);
    expect(businessCalls).toBe(1);
  });
  it("enforces a newly required password change against an already active session", async () => {
    user.must_change_password = false;
    const cookie = await login();
    expect((await request("/test-business", cookie)).status).toBe(200);
    user.must_change_password = true;
    await expectBlocked(await request("/test-business", cookie));
    expect(businessCalls).toBe(1);
  });
});
