import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import type { Server } from "node:http";
import { createPublicOrderPrintRouter, publicOrderPrintKey, publicOrderPrintPath,
  publicPrintProjection, validPublicOrderPrintKey } from "../server/public-order-print";

const secret = "synthetic-test-secret-not-a-workspace-credential";
const source = {
  order: { id: 7, order_number: "ORD7", status: "for_production", previous_status: "waiting", notes: "Printed notes",
    share_token: "private-unused", created_by: 12, created_at: "2026-10-05", delivery_date: "2026-10-10", delivery_days: 5 },
  customer: { name: "Customer", name_ar: "عميل", phone: "0500000000", plate_drawer_code: "C1", code: "PRINTED-CODE",
    tax_number: "PRIVATE-TAX", address: "PRIVATE-ADDRESS", user_id: 99 },
  creator: { id: 12, display_name: "Creator", display_name_ar: "منشئ", full_name: null, username: "creator",
    password_hash: "PRIVATE-HASH", phone: "PRIVATE-PERSON-CONTACT" },
  sales_representative: null,
  production_orders: [{ id: 9, quantity_kg: "100.00", final_quantity_kg: "110.00", batch_number: "PRIVATE-BATCH",
    product: { width: "28", raw_material: "HDPE", notes: "Printed product notes", customer_id: "PRIVATE-CUSTOMER-ID",
      bag_weight_grams: "PRIVATE-UNPRINTED", item: { name: "Bag", name_ar: "كيس", id: "PRIVATE-ITEM-ID" },
      color: { id: "PT02", name: "Transparent", name_ar: "شفاف", color_hex: "#fff", brand: "PRIVATE-SUPPLIER" } } }],
  totals: { requested_kg: "100.00", planned_kg: "110.00", by_status: { pending: 1 } },
  actual_production: { available: false, message: "Planned quantities only" },
};

describe("public print capabilities and projection", () => {
  it("is stable, per-order, purpose-bound and unpredictable without the secret", () => {
    const key = publicOrderPrintKey(7, secret);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(publicOrderPrintKey(7, secret)).toBe(key);
    expect(publicOrderPrintKey(8, secret)).not.toBe(key);
    expect(publicOrderPrintKey(7, "another-test-secret")).not.toBe(key);
    expect(validPublicOrderPrintKey(7, key, secret)).toBe(true);
    expect(validPublicOrderPrintKey(8, key, secret)).toBe(false);
    expect(validPublicOrderPrintKey(7, `${key[0] === "A" ? "B" : "A"}${key.slice(1)}`, secret)).toBe(false);
    expect(publicOrderPrintPath(7, secret)).toBe(`/shared/orders/7/print?key=${key}`);
  });
  it.each([null, undefined, "", "bad", [], ["key"], { key: "anything" }, "أ".repeat(43)])(
    "rejects malformed signatures %p", key => expect(validPublicOrderPrintKey(7, key, secret)).toBe(false),
  );
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])("rejects invalid IDs %p", id => {
    expect(validPublicOrderPrintKey(id, "A".repeat(43), secret)).toBe(false);
    expect(() => publicOrderPrintKey(id, secret)).toThrow();
  });
  it("fails closed for a missing configured secret", () => {
    expect(() => publicOrderPrintKey(7, "")).toThrow("SESSION_SECRET");
  });
  it("publishes only printed fields including explicitly approved phone and names", () => {
    const projected = publicPrintProjection(source, publicOrderPrintPath(7, secret));
    const text = JSON.stringify(projected);
    expect(text).not.toContain("PRIVATE-");
    expect(text).not.toContain("share_token");
    expect(projected.customer?.phone).toBe("0500000000");
    expect(projected.customer?.code).toBe("PRINTED-CODE");
    expect(projected.order?.previous_status).toBe("waiting");
    expect(projected.creator?.display_name).toBe("Creator");
    expect(projected.production_orders[0].product).toMatchObject({ notes: "Printed product notes" });
    expect(projected.totals?.planned_kg).toBe("110.00");
    expect(projected.actual_production).toMatchObject({ message: "Planned quantities only" });
    expect(source.order.share_token).toBe("private-unused");
  });
});

describe("anonymous public print HTTP access", () => {
  let server: Server;
  let origin: string;
  const load = jest.fn(async (id: number) => id === 7 ? source : null);
  beforeAll(async () => {
    const app = express();
    app.use(createPublicOrderPrintRouter(load, secret));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => new Promise<void>(resolve => server.close(() => resolve())));
  it("opens full printable data without a login or cookie", async () => {
    const response = await fetch(origin + `/public/orders/7/print?key=${publicOrderPrintKey(7, secret)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).customer.phone).toBe("0500000000");
  });
  it("does not query any order for absent, invalid or cross-order signatures", async () => {
    load.mockClear();
    for (const path of ["/public/orders/7/print", "/public/orders/7/print?key=bad",
      `/public/orders/8/print?key=${publicOrderPrintKey(7, secret)}`,
      `/public/orders/07/print?key=${publicOrderPrintKey(7, secret)}`]) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "الطلب غير موجود", message_en: "Order not found." });
    }
    expect(load).not.toHaveBeenCalled();
  });
  it("returns the same 404 when a validly signed order no longer exists", async () => {
    const response = await fetch(origin + `/public/orders/8/print?key=${publicOrderPrintKey(8, secret)}`);
    expect(response.status).toBe(404);
  });
  it("does not support public writes", async () => {
    const response = await fetch(origin + `/public/orders/7/print?key=${publicOrderPrintKey(7, secret)}`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});
