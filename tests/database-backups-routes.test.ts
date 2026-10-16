import express from "express";
import { jest, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { createDatabaseBackupRouter } from "../server/database-backups/routes";
import type { DatabaseBackupService } from "../server/database-backups/service";

jest.mock("../server/db", () => ({ pool: {}, db: {} }));
const methods = {
  create: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(Buffer.from("MPBFBK01-encrypted")),
  preview: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" }),
  safety: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ archive: Buffer.from("MPBFBK01-safety"), checksum: "a".repeat(64) }),
  apply: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ requiresLogin: true }),
};
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.get("x-test-permissions");
    if (header) req.user = { id: 1, permissions: JSON.parse(header), original_admin: true } as any;
    next();
  });
  app.use("/api/database-backups", createDatabaseBackupRouter(methods as unknown as DatabaseBackupService));
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/database-backups`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { jest.clearAllMocks(); });
const phrase = "synthetic-backup-passphrase";
const headers = (permissions: string[]) => ({ "Content-Type": "application/json", "x-test-permissions": JSON.stringify(permissions) });
const create = (permissions?: string[], extra: Record<string, string> = {}) => fetch(`${base}/create`, {
  method: "POST", headers: { ...(permissions ? headers(permissions) : { "Content-Type": "application/json" }), ...extra },
  body: JSON.stringify({ passphrase: phrase }),
});
test("anonymous callers cannot obtain backups", async () => {
  expect((await create()).status).toBe(401); expect(methods.create).not.toHaveBeenCalled();
});
test.each([[], ["*"], ["manage_users"], ["view_production"]].map(p => [p]))("only explicit effective admin can access backups: %j", async (permissions) => {
  expect((await create(permissions)).status).toBe(403); expect(methods.create).not.toHaveBeenCalled();
});
test("admin receives only the encrypted attachment with no-store", async () => {
  const response = await create(["admin"]);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain(".mpbfbak");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe("MPBFBK01-encrypted");
  expect(methods.create).toHaveBeenCalledWith(1, phrase);
});
test("cross-origin and cross-site posts are rejected", async () => {
  expect((await create(["admin"], { origin: "https://evil.example" })).status).toBe(403);
  expect((await create(["admin"], { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect(methods.create).not.toHaveBeenCalled();
});
test("weak passwords and extra body fields fail closed", async () => {
  for (const body of [{ passphrase: "short" }, { passphrase: phrase, sql: "DROP TABLE users" }]) {
    expect((await fetch(`${base}/create`, { method: "POST", headers: headers(["admin"]), body: JSON.stringify(body) })).status).toBe(400);
  }
  expect(methods.create).not.toHaveBeenCalled();
});
test("file and passphrase are accepted without an arbitrary SQL/schema input", async () => {
  const form = new FormData();
  form.set("file", new Blob(["MPBFBK01"]), "backup.mpbfbak"); form.set("passphrase", phrase);
  const response = await fetch(`${base}/preview`, { method: "POST", headers: { "x-test-permissions": '["admin"]' }, body: form });
  expect(response.status).toBe(200); expect(methods.preview).toHaveBeenCalled();
});
test("safety returns encrypted bytes and a matching download checksum", async () => {
  const response = await fetch(`${base}/safety`, { method: "POST", headers: headers(["admin"]),
    body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", passphrase: phrase }) });
  expect(response.status).toBe(200); expect(response.headers.get("x-backup-safety-checksum")).toBe("a".repeat(64));
});
test.each([false, undefined])("restore cannot bypass explicit replacement approval: %s", async confirmRestore => {
  const response = await fetch(`${base}/apply`, { method: "POST", headers: headers(["admin"]),
    body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", passphrase: phrase,
      safetyChecksum: "a".repeat(64), confirmRestore, confirmSafetySaved: true }) });
  expect(response.status).toBe(400); expect(methods.apply).not.toHaveBeenCalled();
});
test("internal errors never leak database values or SQL", async () => {
  methods.create.mockRejectedValueOnce(new Error("SQL password=private-value"));
  const response = await create(["admin"]);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private-value");
});
