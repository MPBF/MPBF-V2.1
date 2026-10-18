import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createProductionRouter } from "../server/production/routes";
import { mixRevisionHistory } from "../server/production/mix-revision-history";
import type { Connection, ConnectionPool } from "../server/production/core";

jest.mock("../server/db", () => ({ pool: {} }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => req.user ? next() : res.status(401).json({ message: "Login required" }),
}));

const beforeData = {
  machine_id: "F1", screw: "A", notes: "original", total_kg: "20.25",
  items: [{ material_id: 1, quantity_kg: "20.25" }],
};
const revision = (mix_id = 1, version = 1, action = "edit") => ({
  mix_id, revision: version, action, created_by: 7, created_at: "2026-10-18T08:00:00Z",
  actor_name: "Manager", actor_name_ar: "المدير", before_data: beforeData,
  after_data: { ...beforeData, notes: "corrected", items: action === "delete" ? [] : [{ material_id: 2, quantity_kg: "12.50" }] },
  stock_adjustments: [
    { material_id: 1, name: "HDPE", name_ar: "خام", code: "HD", quantity_kg: "20.25", balance_after_kg: "100.50" },
    ...(action === "delete" ? [] : [{ material_id: 2, name: "LLDPE", name_ar: "خام", code: "LL", quantity_kg: "-12.50", balance_after_kg: "-2.50" }]),
  ],
});

describe("read-only mix revision history", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, origin: string;
  const connect = jest.fn<ConnectionPool["connect"]>();
  const query = jest.fn<Connection["query"]>();
  const release = jest.fn<Connection["release"]>();
  let stored: ReturnType<typeof revision>[];
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const grants = req.get("x-permissions");
      if (grants !== undefined) req.user = { id: 7, permissions: grants.split(",") } as any;
      next();
    });
    app.use("/api/production", createProductionRouter({ connect }));
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ message: "Storage error" }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  beforeEach(() => {
    stored = [revision()];
    connect.mockReset(); query.mockReset(); release.mockReset();
    connect.mockResolvedValue({ query, release });
    query.mockImplementation(async sql => {
      if (sql.includes("FROM factory_mix_revisions r")) return { rows: stored };
      if (sql.includes("FROM factory_raw_materials m")) return { rows: [
        { material_id: 1, name: "HDPE", name_ar: "بولي إيثيلين", code: "HD" },
        { material_id: 2, name: "LLDPE", name_ar: "خام آخر", code: "LL" },
      ] };
      if (sql.includes("FROM machines")) return { rows: [{ id: "F1", name: "Film 1", name_ar: "فيلم ١" }] };
      return { rows: [] };
    });
  });
  const get = (permission: string | null = "admin", suffix = "") =>
    fetch(`${origin}/api/production/mixing/revisions${suffix}`, {
      headers: permission === null ? {} : { "x-permissions": permission },
    });

  it.each(["operate_film", "view_mixing", "manage_production", "view_raw_inventory", "manage_raw_materials", "*", ""])(
    "rejects %s before storage and even with malformed filters", async permission => {
      const response = await get(permission, "?before=invalid");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("صلاحية"), message_en: expect.stringContaining("permission"),
      });
      expect(connect).not.toHaveBeenCalled();
      await expect(mixRevisionHistory({ connect }, { id: 7, permissions: [permission] }))
        .rejects.toMatchObject({ status: 403 });
      expect(connect).not.toHaveBeenCalled();
    });
  it("requires authentication", async () => {
    expect((await get(null)).status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["admin", "manage_mixing"])("returns snapshots, executor and signed stock deltas to %s", async permission => {
    const response = await get(permission);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.next_before).toBeNull();
    expect(data.records[0]).toMatchObject({
      mix_id: 1, revision: 1, created_by: 7, actor_name: "Manager", actor_name_ar: "المدير",
      created_at: "2026-10-18T08:00:00Z",
      before_data: { total_kg: "20.25", items: [{ material_id: 1, name: "HDPE", quantity_kg: "20.25" }] },
      after_data: { items: [{ material_id: 2, name: "LLDPE", quantity_kg: "12.50" }] },
      stock_adjustments: [
        { quantity_kg: "20.25", balance_after_kg: "100.50" },
        { quantity_kg: "-12.50", balance_after_kg: "-2.50" },
      ],
    });
    expect(query.mock.calls[0][0]).toContain("READ ONLY");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(query.mock.calls.every(([sql]) => !/\b(INSERT|UPDATE|DELETE|pg_advisory)\b/i.test(sql))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("keeps cancelled mixes and does not reconstruct balances from current stock", async () => {
    stored = [revision(24, 2, "delete")];
    const data = await (await get("manage_mixing", "?mix_id=24")).json();
    expect(data.records[0]).toMatchObject({
      mix_id: 24, action: "delete", before_data: { items: [{ quantity_kg: "20.25" }] },
      after_data: { items: [] }, stock_adjustments: [{ quantity_kg: "20.25", balance_after_kg: "100.50" }],
    });
    const [sql, params] = query.mock.calls.find(([sql]) => sql.includes("FROM factory_mix_revisions r"))!;
    expect(params).toEqual([24, null, null]);
    expect(sql).not.toContain("deleted_at IS NULL");
    expect(sql).toContain("a.mix_id=r.mix_id AND a.revision=r.revision");
    expect(sql).toContain("a.balance_after_kg::text");
  });
  it("retains notes-only revisions with no stock changes", async () => {
    stored = [{ ...revision(), stock_adjustments: [], after_data: { ...beforeData, notes: "new note" } }];
    const data = await (await get()).json();
    expect(data.records[0].stock_adjustments).toEqual([]);
    expect(data.records[0].after_data.notes).toBe("new note");
  });
  it("uses the indexed mix/revision pair cursor without offsets", async () => {
    stored = Array.from({ length: 26 }, (_, i) => revision(30 - i, 2));
    const data = await (await get("admin", "?before=50:2&mix_id=30")).json();
    expect(data.records).toHaveLength(25);
    expect(data.next_before).toBe("6:2");
    const [sql, params] = query.mock.calls.find(([sql]) => sql.includes("FROM factory_mix_revisions r"))!;
    expect(params).toEqual([30, 50, 2]);
    expect(sql).toContain("(r.mix_id,r.revision)<($2,$3::int)");
    expect(sql).toContain("ORDER BY r.mix_id DESC,r.revision DESC LIMIT 26");
  });
  it.each(["?mix_id=0", "?mix_id=abc", "?before=0:1", "?before=1:-1", "?before=2147483648:1",
    "?before=1:1.5", "?before=invalid", "?limit=1000", "?after=1"])("rejects invalid filters %s", async suffix => {
    expect((await get("admin", suffix)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it("supports empty audit ledgers", async () => {
    stored = [];
    expect(await (await get()).json()).toEqual({ records: [], next_before: null });
  });
  it("rolls back and releases the read connection on storage errors", async () => {
    query.mockRejectedValueOnce(new Error("Read failure"));
    expect((await get()).status).toBe(500);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
