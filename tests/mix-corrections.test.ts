import express from "express";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createProductionRouter } from "../server/production/routes";
import { canManageMixing, formatMixNumber } from "../shared/raw-mixing";
import type { ConnectionPool } from "../server/production/core";

jest.mock("../server/db", () => ({ pool: {} }));
jest.mock("../server/auth", () => ({
  requireAuth: (req: any,res: any,next: any) => req.user ? next() : res.status(401).json({message:"Login required"}),
}));
describe("mix corrections boundary", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, origin: string;
  const connect = jest.fn<ConnectionPool["connect"]>();
  const valid = () => ({ request_id: randomUUID(), expected_revision: 0, notes: "correction" });
  beforeAll(async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      const permission = req.headers["x-permission"];
      if (typeof permission === "string") req.user = { id: 1, permissions: [permission] } as any;
      next();
    });
    app.use("/api/production", createProductionRouter({ connect }));
    app.use((_error: any, _req: any, res: any, _next: any) => res.status(500).json({ message: "Fixture DB" }));
    server = app.listen(0); await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => { connect.mockReset(); connect.mockRejectedValue(new Error("Fixture DB")); });
  const send = (body: unknown, permission = "admin", method = "PATCH", id = "1") => fetch(
    `${origin}/api/production/mixing/${id}`, { method, headers: {
      "Content-Type": "application/json", ...(permission ? { "x-permission": permission } : {}),
    }, body: JSON.stringify(body) });
  it.each([[1,"Mix-0001"],[24,"Mix-0024"],[9999,"Mix-9999"],[10000,"Mix-10000"],[123456,"Mix-123456"],[0,"—"]])(
    "formats fixed, ungrouped identity %s", (id, expected) => expect(formatMixNumber(Number(id))).toBe(expected));
  it.each(["operate_film","view_mixing","manage_production","view_raw_inventory","*"])(
    "denies %s before DB access", async permission => {
      expect(canManageMixing({ id: 1, permissions: [permission] })).toBe(false);
      expect((await send(valid(), permission)).status).toBe(403);
      expect((await send({ request_id: randomUUID(), expected_revision: 0 }, permission, "DELETE")).status).toBe(403);
      expect(connect).not.toHaveBeenCalled();
    });
  it.each(["admin","manage_mixing"])("allows manager %s to storage", async permission => {
    expect(canManageMixing({ id: 1, permissions: [permission] })).toBe(true);
    expect((await send(valid(), permission)).status).toBe(500);
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("requires authentication", async () => {
    expect((await send(valid(), "")).status).toBe(401); expect(connect).not.toHaveBeenCalled();
  });
  it.each([{ expected_revision: -1 },{ expected_revision: 1.2 },{ expected_revision: "0" },{ request_id: "bad" },
    { contents: { machine_id: "F1", items: [] } },
    { contents: { machine_id: "F1", items: [{ material_id: 1, quantity_kg: "0" }] } },
    { contents: { machine_id: "F1", items: [{ material_id: 1, quantity_kg: "1" },{ material_id: 1, quantity_kg: "2" }] } },
    { notes: "bad\u0000text" },{ deleted_at: "2026-10-18" }])("rejects invalid payload %j", async patch => {
      expect((await send({ ...valid(), ...patch })).status).toBe(400); expect(connect).not.toHaveBeenCalled();
    });
  it.each(["0","-1","1.2","abc"])("validates mix ID %s", async id => {
    expect((await send(valid(), "admin", "PATCH", id)).status).toBe(400); expect(connect).not.toHaveBeenCalled();
  });
});
