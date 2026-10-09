import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { db } from "../server/db";
import router from "../server/routes";

jest.mock("../server/db", () => ({ db: { update: jest.fn() } }));
jest.mock("../server/hr", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/self-service", () => ({ __esModule: true, default: express.Router() }));
jest.mock("../server/auth", () => ({
  authenticate: jest.fn(),
  hashPassword: jest.fn(),
  resolveUser: jest.fn(),
  requireAuth: (req: any, res: any, next: any) => req.user
    ? next()
    : res.status(401).json({ message: "تسجيل الدخول مطلوب" }),
  requireAnyPermission: () => (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

describe("current user language preference", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;
  let updateSet: jest.Mock;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      if (req.headers["x-user-id"]) req.user = { id: Number(req.headers["x-user-id"]) };
      next();
    });
    app.use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error.name === "ZodError" ? 400 : error.status ?? 500).json({ message: error.message }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const returning = jest.fn().mockResolvedValue([{ preferred_language: "en" }] as never);
    const where = jest.fn().mockReturnValue({ returning });
    updateSet = jest.fn().mockReturnValue({ where });
    jest.mocked(db.update).mockReturnValue({ set: updateSet } as never);
  });

  const save = (payload: unknown, userId?: number) => fetch(`${origin}/api/me/language`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-user-id": String(userId) } : {}),
    },
    body: JSON.stringify(payload),
  });

  it("persists a supported language for the authenticated user", async () => {
    const response = await save({ preferred_language: "en" }, 42);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferred_language: "en" });
    expect(updateSet).toHaveBeenCalledWith({ preferred_language: "en" });
  });

  it("allows clearing the preference to inherit the company default", async () => {
    const returning = jest.fn().mockResolvedValue([{ preferred_language: null }] as never);
    const where = jest.fn().mockReturnValue({ returning });
    updateSet.mockReturnValue({ where });
    const response = await save({ preferred_language: null }, 42);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferred_language: null });
    expect(updateSet).toHaveBeenCalledWith({ preferred_language: null });
  });

  it("rejects unsupported languages and unauthenticated updates", async () => {
    expect((await save({ preferred_language: "fr" }, 42)).status).toBe(400);
    expect((await save({ preferred_language: "en" })).status).toBe(401);
    expect(db.update).not.toHaveBeenCalled();
  });
});