import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express, { type NextFunction, type Request, type Response } from "express";

import { db } from "../server/db";
import router from "../server/hr";
import { attendance_events, attendance_sessions } from "../shared/schema";

jest.mock("../server/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: () => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { id: 7 } });
    next();
  },
}));

const session = {
  id: 31,
  userId: 12,
  assignmentId: 5,
  checkInAt: new Date("2025-09-25T05:00:00.000Z"),
  checkOutAt: null,
  shiftStartAt: new Date("2025-09-25T05:00:00.000Z"),
};
const latestBreakStart = {
  id: 99,
  action: "break_start",
  occurredAt: new Date("2025-09-25T09:00:00.000Z"),
};

function transactionForTest(nextCheckInAt: Date) {
  const writes: Array<{ type: string; table?: unknown; values?: Record<string, unknown> }> = [];
  const lockedUsers: number[] = [];
  let selects = 0;
  const tx = {
    execute: async () => { lockedUsers.push(session.userId); },
    select: () => {
      const queryNumber = selects++;
      let table: unknown;
      const builder: {
        from(value: unknown): typeof builder;
        where(): typeof builder;
        orderBy(): typeof builder;
        limit(): Promise<unknown[]>;
      } = {
        from(value: unknown) { table = value; return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        limit: async () => {
          if (table === attendance_sessions && (queryNumber === 0 || queryNumber === 1)) return [session];
          if (table === attendance_events) return [latestBreakStart];
          if (table === attendance_sessions) return [{ checkInAt: nextCheckInAt }];
          return [];
        },
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ type: "insert", table, values });
        const result = {
          then(resolve: (value: undefined) => void) { resolve(undefined); },
          returning: async () => [{ id: writes.length + 100, ...values }],
        };
        return result;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { writes.push({ type: "update", table, values }); },
      }),
    }),
  };
  return { tx, writes, lockedUsers };
}

describe("HR attendance checkout correction transaction", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/hr", router);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : String(error);
      return res.status(status).json({ message });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => { jest.clearAllMocks(); });

  const correct = () => fetch(`${url}/api/hr/attendance-sessions/${session.id}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      break_end_at: "2025-09-25T11:00:00.000Z",
      occurred_at: "2025-09-25T12:00:00.000Z",
    }),
  });

  test("rejects an overlapping next shift without inserting either attendance event", async () => {
    const { tx, writes, lockedUsers } = transactionForTest(new Date("2025-09-25T11:30:00.000Z"));
    jest.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never) as never);

    const response = await correct();

    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain("يتداخل مع وردية لاحقة");
    expect(lockedUsers).toEqual([session.userId]);
    expect(writes).toEqual([]);
  });

  test("inserts return, checkout, and session close together inside one locked transaction", async () => {
    const { tx, writes, lockedUsers } = transactionForTest(new Date("2025-09-25T12:30:00.000Z"));
    jest.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never) as never);

    const response = await correct();

    expect(response.status).toBe(201);
    expect(lockedUsers).toEqual([session.userId]);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatchObject({
      type: "insert",
      table: attendance_events,
      values: { action: "break_end", occurred_at: new Date("2025-09-25T11:00:00.000Z") },
    });
    expect(writes[1]).toMatchObject({
      type: "insert",
      table: attendance_events,
      values: { action: "check_out", occurred_at: new Date("2025-09-25T12:00:00.000Z") },
    });
    expect(writes[2]).toMatchObject({
      type: "update",
      table: attendance_sessions,
      values: { check_out_at: new Date("2025-09-25T12:00:00.000Z") },
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});