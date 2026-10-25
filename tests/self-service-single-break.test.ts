import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import express, { type NextFunction, type Request, type Response } from "express";
import { db } from "../server/db";
import router from "../server/self-service";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { id: 14 } }); next();
  },
  requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const app = express();
app.use(express.json(), router);
app.use((error: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 500).json({ message: error.message, code: error.code });
});
let server: ReturnType<typeof app.listen>;
let base: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

function setup(priorBreak: boolean, lastAction = "break_end") {
  const writes: unknown[] = [];
  const now = Date.now();
  let queryIndex = 0;
  let locked = false;
  const answers = [
    [{ id: 71, user_id: 14, shift_id: "AM", shift_date: "2026-06-28",
      window_start_at: new Date(now - 3600000), window_end_at: new Date(now + 3600000) }],
    [], // No geofence definition in this isolated fixture.
    [{ id: 12, action: lastAction }],
    priorBreak ? [{ id: 12 }] : [],
  ];
  const tx = {
    execute: async () => { locked = true; },
    select: () => {
      const answer = answers[queryIndex++];
      const builder = {
        from: () => builder, where: () => builder, orderBy: () => builder, leftJoin: () => builder,
        limit: async () => { expect(locked).toBe(true); return answer; },
        then: (resolve: (value: unknown) => void) => { expect(locked).toBe(true); resolve(answer); },
      };
      return builder;
    },
    insert: () => ({ values: async (value: unknown) => { writes.push(value); } }),
  };
  jest.mocked(db.transaction).mockImplementation(async (fn) => await fn(tx as never) as never);
  return writes;
}

describe("daily single-break attendance rule", () => {
  test("rejects a second break under the same employee transaction lock", async () => {
    const writes = setup(true);
    const response = await fetch(`${base}/attendance`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "break_start", latitude: 24, longitude: 46, accuracy: 5 }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DAILY_BREAK_ALREADY_TAKEN" });
    expect(writes).toHaveLength(0);
  });
  test("permits the first break", async () => {
    const writes = setup(false, "check_in");
    const response = await fetch(`${base}/attendance`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "break_start", latitude: 24, longitude: 46, accuracy: 5 }) });
    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
  });
  test("still permits returning from the one break", async () => {
    const writes = setup(true, "break_start");
    const response = await fetch(`${base}/attendance`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "break_end", latitude: 24, longitude: 46, accuracy: 5 }) });
    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
  });
});
