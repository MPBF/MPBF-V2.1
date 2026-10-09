import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { allocateOrderNumber, productionOrderNumber } from "../server/order-number";
import { ProductionExecutionService } from "../server/production/execution";

if (process.env.ISOLATED_ORDER_NUMBER !== "1") throw new Error("Disposable local database only.");
const pool = new Pool({ host: "127.0.0.1", port: 55443, user: "runner", database: "postgres", max: 12 });
const db = drizzle(pool);
try {
  await pool.query(`
    CREATE TABLE users(id integer PRIMARY KEY);
    INSERT INTO users VALUES(1);
    CREATE TABLE orders(id serial PRIMARY KEY,order_number varchar(45) UNIQUE NOT NULL,
      status text DEFAULT 'in_production',customer_id text DEFAULT 'C1');
    CREATE TABLE production_orders(id serial PRIMARY KEY,order_id integer REFERENCES orders(id),
      production_order_number varchar(50) UNIQUE,customer_product_id integer,quantity_kg numeric(14,2),
      final_quantity_kg numeric(14,2),status text DEFAULT 'active',previous_status text,batch_number text);
    CREATE TABLE machines(id varchar(20) PRIMARY KEY,type text,status text);
    INSERT INTO machines VALUES('F1','extruder','active');
    CREATE TABLE factory_execution(production_order_id integer PRIMARY KEY REFERENCES production_orders(id),
      product jsonb,is_printed boolean DEFAULT false,is_roll_product boolean DEFAULT false,
      film_closed_at timestamptz,completed_at timestamptz,stage text DEFAULT 'film',batch_number text);
    CREATE TABLE factory_receipt_items(production_order_id integer,quantity_kg numeric(14,2));
    CREATE TABLE factory_operations(actor_id integer,request_id uuid,operation text,fingerprint text,
      result jsonb,PRIMARY KEY(actor_id,request_id));
    INSERT INTO orders(order_number) VALUES('000154'),('O00001'),('O00002'),('O10000'),('O10001');
  `);
  await pool.query(readFileSync("migrations/0013_order_number_allocations.sql", "utf8"));
  const factoryDDL = readFileSync("migrations/0011_factory_roll_production.sql", "utf8");
  await pool.query(factoryDDL.slice(factoryDDL.indexOf("CREATE TABLE IF NOT EXISTS factory_rolls"),
    factoryDDL.indexOf("CREATE TABLE IF NOT EXISTS factory_queues")));
  const historical = (await pool.query("SELECT * FROM orders ORDER BY id")).rows;
  const create = () => db.transaction(async tx => {
    const number = await allocateOrderNumber(tx);
    return (await tx.execute<{ id: number; order_number: string }>(
      sql`INSERT INTO orders(order_number) VALUES(${number}) RETURNING id,order_number`)).rows[0];
  });
  const parent = await create();
  assert.equal(parent.order_number, "O0001", "historical maxima must not advance the new series");
  await assert.rejects(db.transaction(async tx => {
    assert.equal(await allocateOrderNumber(tx), "O0002");
    throw new Error("injected rollback");
  }), /injected rollback/);
  assert.equal((await create()).order_number, "O0002", "failed creation rolls back the reservation");
  const concurrent = await Promise.all(Array.from({ length: 24 }, create));
  assert.deepEqual(concurrent.map(order => order.order_number).sort(),
    Array.from({ length: 24 }, (_, i) => `O${String(i + 3).padStart(4, "0")}`));
  const removed = await create();
  await pool.query("DELETE FROM orders WHERE id=$1", [removed.id]);
  assert.equal((await create()).order_number, "O0028", "deletion must not reuse an identifier");

  const po = async (orderId: number, number: string) => {
    const record = (await pool.query(`INSERT INTO production_orders(order_id,production_order_number,
      quantity_kg,final_quantity_kg) VALUES($1,$2,1000,1000) RETURNING id`, [orderId, number])).rows[0];
    await pool.query("INSERT INTO factory_execution(production_order_id,product) VALUES($1,$2::jsonb)",
      [record.id, JSON.stringify({ id: 1, item_id: "ITM1", name: "Bag" })]);
    return record.id as number;
  };
  const first = await po(parent.id, productionOrderNumber(parent.order_number, 1));
  const second = await po(parent.id, productionOrderNumber(parent.order_number, 2));
  const legacy = await po(2, "O00001-JO01");
  const service = new ProductionExecutionService(pool);
  const actor = { id: 1, permissions: ["operate_film"] };
  const input = () => ({ request_id: randomUUID(), machine_id: "F1", weight_kg: "1.00" });
  const rolls = await Promise.all(Array.from({ length: 20 }, () => service.film(actor, first, input())));
  assert.deepEqual(rolls.map(roll => roll.roll_number).sort(),
    Array.from({ length: 20 }, (_, i) => `O0001-JO01-R${String(i + 1).padStart(2, "0")}`));
  assert.equal((await service.film(actor, second, input())).roll_number, "O0001-JO02-R01");
  assert.equal((await service.film(actor, legacy, input())).roll_number, "O00001-JO01-R001",
    "new rolls for historical orders keep their old numbering");
  const replayInput = input();
  const original = await service.film(actor, first, replayInput);
  assert.equal((await service.film(actor, first, replayInput)).roll_number, original.roll_number);
  assert.equal((await pool.query("SELECT count(*)::int count FROM factory_rolls WHERE production_order_id=$1", [first])).rows[0].count, 21);
  assert.deepEqual((await pool.query("SELECT * FROM orders WHERE id<=5 ORDER BY id")).rows, historical,
    "historical orders stay unchanged");
  await pool.query("INSERT INTO orders(order_number) VALUES('O0029')");
  assert.equal((await create()).order_number, "O0030", "skip an existing exact identifier");
  await pool.query("INSERT INTO order_number_allocations VALUES(9999,'O9999')");
  assert.equal((await create()).order_number, "O10002", "skip old identifiers at width expansion");
  console.log("PASS restart-safe new series, rollback, concurrency, collision skipping, deletion reservations, real film roll creation, per-parent sequences, legacy preservation and idempotency.");
} finally {
  await pool.end();
}
