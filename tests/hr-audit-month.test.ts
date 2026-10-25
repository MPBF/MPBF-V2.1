import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express, { type NextFunction, type Request, type Response } from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../server/db";
import router from "../server/hr";
import { shift_definitions } from "../shared/schema";

jest.mock("../server/db", () => ({ db: { select: jest.fn() } }));
jest.mock("../server/auth", () => ({
  requireAnyPermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

describe("HR audit month read contract", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let url: string;
  let condition: unknown;
  let selected: Record<string, unknown>;
  let joined: unknown[];
  const dialect = new PgDialect();
  const rows = [{ id: 4, session_id: 3, shift_date: "2026-10-31", occurred_at: "2026-11-01T00:00:00Z", shift_name_ar: "ليلية", shift_name_en: "Night" }];

  beforeAll(async () => {
    const app = express();
    app.use("/api/hr", router);
    app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.status || 500).json({ message: error.message });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/hr/attendance-events`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    joined = [];
    jest.mocked(db.select).mockImplementation(((fields: Record<string, unknown>) => {
      selected = fields;
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        leftJoin: (table: unknown) => { joined.push(table); return builder; },
        where: (value: unknown) => { condition = value; return builder; },
        orderBy: async () => rows,
      };
      return builder;
    }) as unknown as typeof db.select);
  });

  const compiled = () => dialect.sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]);

  test("reads the whole Riyadh month while retaining overnight sessions and shift names", async () => {
    const response = await fetch(`${url}?month=2026-10`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rows);
    const { sql, params } = compiled();
    expect(params).toEqual(expect.arrayContaining([
      "2026-09-30T21:00:00.000Z", "2026-10-31T21:00:00.000Z",
      "2026-10-01", "2026-11-01",
    ]));
    expect(sql).toContain('"attendance_events"."session_id" is null');
    expect(sql).toContain('"attendance_sessions"."shift_date" >=');
    expect(sql).toContain('"attendance_sessions"."shift_date" <');
    expect(joined).toContain(shift_definitions);
    expect(selected).toHaveProperty("shift_name_ar");
    expect(selected).toHaveProperty("shift_name_en");
  });

  test("retains employee and section filters", async () => {
    const response = await fetch(`${url}?month=2026-12&user_id=12&section_id=film`);
    expect(response.status).toBe(200);
    expect(compiled().params).toEqual(expect.arrayContaining(["2026-12-01", "2027-01-01", 12, "film"]));
  });

  test("keeps daily callers compatible", async () => {
    expect((await fetch(`${url}?day=2026-10-15`)).status).toBe(200);
    expect(compiled().params).toEqual(expect.arrayContaining(["2026-10-15", "2026-10-14T21:00:00.000Z", "2026-10-15T21:00:00.000Z"]));
  });

  test("rejects invalid months", async () => {
    expect((await fetch(`${url}?month=2026-13`)).status).toBe(400);
    expect((await fetch(`${url}?month=2026-10invalid`)).status).toBe(400);
  });
});
