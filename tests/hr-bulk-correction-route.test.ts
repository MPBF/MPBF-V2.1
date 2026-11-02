import { afterAll, beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import express, { type NextFunction, type Request, type Response } from "express";
import { db } from "../server/db";
import router from "../server/hr";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) => {
    expect(permissions).toEqual(["manage_hr", "manage_attendance", "admin"]);
    if (!req.headers["x-test-permission"]) return res.sendStatus(401);
    if (!permissions.includes(String(req.headers["x-test-permission"]))) return res.sendStatus(403);
    Object.assign(req, { user: { id: 7 } }); next();
  },
}));
let server: ReturnType<ReturnType<typeof express>["listen"]>, url: string;
const correction = {
  user_id: 8, session_id: null, shift_date: "2026-06-29",
  expected_events: [{ id: 21, updated_at: "2026-06-30T00:00:00.000Z" }],
  events: [
    { id: 21, action: "check_in", occurred_at: "2026-06-29T05:00:00.000Z" },
    { action: "check_out", occurred_at: "2026-06-29T14:00:00.000Z" },
  ],
};
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/hr", router);
  app.use((error: Error & { status?: number; name: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.name === "ZodError" ? 400 : error.status || 500).json({ message: error.message });
  });
  server = app.listen(0); await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/hr/attendance-corrections/bulk`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(db.transaction).mockResolvedValue({ success: true, corrected: 1 } as never); });
const send = (permission?: string, corrections: unknown[] = [correction]) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json", ...(permission ? { "x-test-permission": permission } : {}) },
  body: JSON.stringify({ corrections }),
});
test("blocks unauthenticated and unrelated roles before any database write", async () => {
  expect((await send()).status).toBe(401);
  expect((await send("view_hr")).status).toBe(403);
  expect(db.transaction).not.toHaveBeenCalled();
});
test.each(["manage_hr", "manage_attendance", "admin"])("permits existing HR correction authority: %s", async (permission) => {
  const response = await send(permission);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, corrected: 1 });
  expect(db.transaction).toHaveBeenCalledTimes(1);
});
test("rejects empty or repeated targets before a transaction", async () => {
  expect((await send("manage_hr", [])).status).toBe(400);
  expect((await send("manage_hr", [correction, correction])).status).toBe(400);
  expect(db.transaction).not.toHaveBeenCalled();
});
test("accepts an explicitly saved empty calendar day under HR authority", async () => {
  const empty = { ...correction, expected_events: [], events: correction.events.map(({ action, occurred_at }) => ({ action, occurred_at })) };
  expect((await send("manage_attendance", [empty])).status).toBe(200);
  expect(db.transaction).toHaveBeenCalledTimes(1);
});
