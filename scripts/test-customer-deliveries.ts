// Synthetic PostgreSQL only: never connect to the application's database.
import assert from "node:assert/strict";
import pg from "pg";
import { FinishedDeliveryService } from "../server/production/delivery";

const client = new pg.Client({ host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres" });
await client.connect();
try {
  await client.query(`
    CREATE TEMP TABLE orders(id integer PRIMARY KEY,order_number text);
    CREATE TEMP TABLE production_orders(id integer PRIMARY KEY,order_id integer);
    CREATE TEMP TABLE factory_deliveries(id integer PRIMARY KEY,voucher_number text,
      created_at timestamptz,customer_id text,customer_name text,customer_name_ar text);
    CREATE TEMP TABLE factory_delivery_items(id serial PRIMARY KEY,delivery_id integer,
      production_order_id integer,production_order_number text,item_id text,product jsonb,quantity_kg numeric(14,2));
    INSERT INTO orders VALUES(1,'O-123'),(2,'O-456'),(3,'O-NOT-DELIVERED');
    INSERT INTO production_orders VALUES(10,1),(20,2),(30,3);
    INSERT INTO factory_deliveries
      SELECT n,'FP-Del'||n,'2026-10-01'::timestamptz+n*interval '1 minute',
        'C-1','English customer','عميل عربي' FROM generate_series(1,105) n;
    INSERT INTO factory_delivery_items(delivery_id,production_order_id,production_order_number,item_id,product,quantity_kg)
      SELECT n,10,'PO-10','ITM001','{"name":"Bag","name_ar":"كيس"}',0.01 FROM generate_series(1,105) n;
    -- Same PO in multiple locations/lines on a single voucher must be combined once.
    INSERT INTO factory_delivery_items(delivery_id,production_order_id,production_order_number,item_id,product,quantity_kg)
      VALUES(1,10,'PO-10','ITM001','{"name":"Bag"}',2.34),
        (1,20,'PO-20','ITM002','{"name":"Charcoal bag"}',5.67);
  `);
  const service = new FinishedDeliveryService({
    connect: async () => ({ query: client.query.bind(client), release() {} }),
  });
  const reader = { id: 7, permissions: ["view_finished_inventory"] };
  const all = await service.customerDeliveries(reader);
  assert.equal(all.records.length, 2);
  assert.equal(all.next, null);
  const group = all.records.find(row => row.production_order_id === 10)!;
  assert.equal(group.delivered_kg, "3.39");
  assert.equal(group.order_number, "O-123");
  assert.equal(group.deliveries.length, 105);
  assert.equal(group.deliveries.find(v => v.id === 1)!.quantity_kg, "2.35");
  assert.equal(group.deliveries[0].voucher_number, "FP-Del105");
  assert.equal(all.records[0].delivered_kg, "5.67");
  assert.ok(all.records.every(row => typeof row.delivered_kg === "string"));
  assert.ok(group.deliveries.every(v => typeof v.quantity_kg === "string"));
  // Voucher search matches the group, not just matching lines (all-time total retained).
  for (const search of ["FP-Del105", "O-123", "PO-10", "ITM001", "كيس"]) {
    const result = await service.customerDeliveries(reader, { search });
    assert.equal(result.records.length, 1, search);
    assert.equal(result.records[0].delivered_kg, "3.39", search);
    assert.equal(result.records[0].deliveries.length, 105, search);
  }
  const first = await service.customerDeliveries(reader, { limit: 1 });
  assert.equal(first.next, 20);
  const second = await service.customerDeliveries(reader, { limit: 1, before: first.next! });
  assert.equal(second.records[0].production_order_id, 10);
  assert.equal(second.next, null);
  assert.equal((await service.customerDeliveries(reader, { search: "missing" })).records.length, 0);
  assert.equal((await service.customerDeliveries(reader, { search: "%" })).records.length, 0);
  assert.equal((await service.customerDeliveries(reader, { search: "' OR true --" })).records.length, 0);
  for (const permissions of [[], ["receive_production"], ["view_raw_inventory"], ["operate_film"]]) {
    await assert.rejects(() => service.customerDeliveries({ id: 8, permissions }), error =>
      (error as { status: number }).status === 403);
  }
  assert.equal((await service.customerDeliveries({ id: 8, permissions: ["manage_finished_warehouse"] })).records.length, 2);
  assert.equal((await service.customerDeliveries({ id: 8, permissions: ["admin"] })).records.length, 2);
  console.log("PASS grouped deliveries: all-time decimals, partial/multi-line vouchers, search, cursor, permissions; no stock writes.");
} finally {
  await client.end();
}
