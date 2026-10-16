import { afterAll, beforeAll, beforeEach, describe, expect, jest, it } from "@jest/globals";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "../server/db";
import router from "../server/self-service";

jest.mock("../server/db", () => ({ db: { select: jest.fn(), insert: jest.fn(), transaction: jest.fn() } }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header("x-test-user")) return res.status(401).json({ message: "Unauthorized" });
    Object.assign(req, { user: { id: 7, permissions: req.header("x-test-admin") ? ["admin"] : [] } });
    next();
  },
  requirePermission: (permission: string) => (req: Request, res: Response, next: NextFunction) =>
    req.user?.permissions.includes(permission) ? next() : res.status(403).json({ message: "Forbidden" }),
}));

function query(rows: unknown[]) {
  const conditions: SQL[] = [];
  const locks: string[] = [];
  const chain = {
    from: () => chain, innerJoin: () => chain, leftJoin: () => chain,
    where: (condition: SQL) => { if (condition) conditions.push(condition); return chain; },
    orderBy: () => chain, limit: () => chain,
    for: (lock: string) => { locks.push(lock); return chain; },
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return { chain, conditions, locks };
}

describe("leave dates and attendance API boundaries", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, origin: string;
  const headers = { "Content-Type": "application/json", "x-test-user": "7" };
  const adminHeaders = { ...headers, "x-test-admin": "1" };
  const dates = { leave_start_date: "2026-10-02", leave_end_date: "2026-10-04" };
  const dialect = new PgDialect();
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/self", router);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error instanceof ZodError ? 400 : (error as { status?: number }).status ?? 500)
        .json({ message: error instanceof Error ? error.message : String(error) });
    });
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/self`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => { jest.resetAllMocks(); });
  const patch = (body: object, asAdmin = true) => fetch(`${origin}/admin/requests/31`, {
    method: "PATCH", headers: asAdmin ? adminHeaders : headers, body: JSON.stringify(body),
  });
  const setupReview = (type = "leave") => {
    const existing = { id: 31, user_id: 12, type, status: "approved", response: "Original", responded_at: new Date("2026-09-30T12:00:00Z"), leave_start_date: null, leave_end_date: null };
    const selected = query([existing]);
    const set = jest.fn<(values: Record<string, unknown>) => unknown>();
    const tx = {
      select: () => selected.chain,
      update: () => ({
        set: (values: Record<string, unknown>) => {
          set(values);
          return { where: () => ({ returning: async () => [{ ...existing, ...values }] }) };
        },
      }),
    };
    jest.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never));
    return { existing, selected, set };
  };

  it("requires sign-in for personal history and admin permission for every review/date correction", async () => {
    expect((await fetch(`${origin}/attendance`)).status).toBe(401);
    expect((await fetch(`${origin}/admin/requests?missing_leave_dates=1`, { headers })).status).toBe(403);
    expect((await patch(dates, false)).status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("saves dates-only corrections without altering approval, response or approval timestamp", async () => {
    const { existing, selected, set } = setupReview();
    const response = await patch(dates);
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(dates);
    expect(selected.locks).toEqual(["update"]);
    expect(dialect.sqlToQuery(selected.conditions[0]).params).toEqual([31]);
    const body = await response.json();
    expect(body.status).toBe("approved");
    expect(body.response).toBe(existing.response);
    expect(body.responded_at).toBe(existing.responded_at.toISOString());
  });
  it("does not approve an undated old leave by guessing from created_at", async () => {
    const { set } = setupReview();
    expect((await patch({ status: "approved" })).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it("can complete dates and approve in the same locked review", async () => {
    const { set } = setupReview();
    expect((await patch({ ...dates, status: "approved", response: "Confirmed" })).status).toBe(200);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ ...dates, status: "approved", response: "Confirmed" }));
  });
  it("can reject an old undated leave without fabricating dates", async () => {
    const { set } = setupReview();
    expect((await patch({ status: "rejected" })).status).toBe(200);
    expect(set.mock.calls[0][0]).not.toHaveProperty("leave_start_date");
  });
  it("rejects leave dates on other request types and reversed/partial date updates", async () => {
    const { set } = setupReview("permission");
    expect((await patch(dates)).status).toBe(400);
    expect((await patch({ leave_start_date: dates.leave_start_date })).status).toBe(400);
    expect((await patch({ ...dates, leave_end_date: "2026-09-01" })).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing request without a write", async () => {
    const { chain } = query([]);
    const update = jest.fn();
    jest.mocked(db.transaction).mockImplementation(async callback => callback({ select: () => chain, update } as never));
    expect((await patch(dates)).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
  it("binds new leave ownership to the signed-in user, not a client-supplied identifier", async () => {
    const values = jest.fn<(input: Record<string, unknown>) => unknown>();
    jest.mocked(db.insert).mockReturnValue({
      values: (input: Record<string, unknown>) => { values(input); return { returning: async () => [input] }; },
    } as never);
    const input = { type: "leave", title: "Annual", details: "Annual leave", ...dates };
    const response = await fetch(`${origin}/requests`, { method: "POST", headers, body: JSON.stringify(input) });
    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith({ ...input, user_id: 7 });
    expect((await fetch(`${origin}/requests`, { method: "POST", headers, body: JSON.stringify({ ...input, user_id: 99 }) })).status).toBe(400);
    expect(values).toHaveBeenCalledTimes(1);
  });
  it("filters the admin missing-date queue to approved leave only", async () => {
    const selected = query([]);
    jest.mocked(db.select).mockReturnValue(selected.chain as never);
    expect((await fetch(`${origin}/admin/requests?missing_leave_dates=1`, { headers: adminHeaders })).status).toBe(200);
    const compiled = dialect.sqlToQuery(selected.conditions[0]);
    expect(compiled.params).toEqual(["leave", "approved"]);
    expect(compiled.sql).toContain("leave_start_date");
    expect(compiled.sql).toContain("is null");
  });
  it("keeps every monthly lookup scoped to its owner and performs no writes to generate statuses", async () => {
    const selects = [
      query([]), query([]), query([]), query([]), query([]),
      query([{ included: true, systemUser: false, serviceStartDate: null, createdAt: null }]),
    ];
    let index = 0;
    jest.mocked(db.select).mockImplementation(() => selects[index++].chain as never);
    const response = await fetch(`${origin}/attendance`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dayStatuses).toEqual([]);
    expect(body.absenceAssessmentBlocked).toBe(false);
    expect(index).toBe(6);
    for (const selected of selects) expect(dialect.sqlToQuery(selected.conditions[0]).params).toContain(7);
    expect(dialect.sqlToQuery(selects[4].conditions[0]).params).toContain("approved");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
