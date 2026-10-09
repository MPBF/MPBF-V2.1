// Run only against a disposable local PostgreSQL server, never business data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { nextOrderNumber, ORDER_NUMBER_MAX_SQL, productionOrderNumber, productionOrderSequence } from "../server/order-number";

const pool = new pg.Pool({
  host: "127.0.0.1", port: 55441, user: "runner", database: "postgres",
  max: 12, statement_timeout: 10000, connectionTimeoutMillis: 5000,
});
const schema = `order_number_test_${randomUUID().replaceAll("-", "")}`;
const seed = ["000019", "O00025", "O0000024", "IMPORT-999999", "Oinvalid", "25-custom", "000000"];

async function createOrder(rollback = false) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(29832, 1)");
    const maximum = await client.query(ORDER_NUMBER_MAX_SQL);
    const number = nextOrderNumber(maximum.rows[0]?.max_number ?? null);
    const row = await client.query("INSERT INTO orders(order_number) VALUES($1) RETURNING id", [number]);
    await client.query("INSERT INTO production_orders(order_id,production_order_number) VALUES($1,$2)",
      [row.rows[0].id, productionOrderNumber(number, 1)]);
    await client.query(rollback ? "ROLLBACK" : "COMMIT");
    return { id: row.rows[0].id, number };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function createChild(parent: { id: string; number: string }) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("BEGIN");
    await client.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [parent.id]);
    const siblings = await client.query("SELECT production_order_number FROM production_orders WHERE order_id=$1", [parent.id]);
    const sequence = siblings.rows.reduce((max: number, row: { production_order_number: string }) =>
      Math.max(max, productionOrderSequence(parent.number, row.production_order_number)), 0) + 1;
    const number = productionOrderNumber(parent.number, sequence);
    await client.query("INSERT INTO production_orders(order_id,production_order_number) VALUES($1,$2)", [parent.id, number]);
    await client.query("COMMIT");
    return number;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function main() {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    await pool.query(`CREATE TABLE "${schema}".orders(id bigserial PRIMARY KEY,order_number varchar(50) UNIQUE NOT NULL);
      CREATE TABLE "${schema}".production_orders(id bigserial PRIMARY KEY,order_id bigint REFERENCES "${schema}".orders(id),
      production_order_number varchar(50) UNIQUE NOT NULL)`);
    for (const number of seed) await pool.query(`INSERT INTO "${schema}".orders(order_number) VALUES($1)`, [number]);
    const parent = await createOrder();
    assert.equal(parent.number, "O00026");
    const orders = await Promise.all(Array.from({ length: 20 }, () => createOrder()));
    assert.deepEqual(orders.map(row => row.number).sort(), Array.from({ length: 20 }, (_, index) => `O${String(index + 27).padStart(5, "0")}`));
    const undone = await createOrder(true);
    assert.equal(undone.number, "O00047");
    assert.equal((await createOrder()).number, undone.number, "rolled-back number is not consumed");
    const children = await Promise.all(Array.from({ length: 10 }, () => createChild(parent)));
    assert.deepEqual(children.sort(), Array.from({ length: 10 }, (_, index) => `O00026-JO${String(index + 2).padStart(2, "0")}`));
    const original = await pool.query(`SELECT order_number FROM "${schema}".orders WHERE id <= $1 ORDER BY id`, [seed.length]);
    assert.deepEqual(original.rows.map(row => row.order_number), seed, "legacy and pre-existing numbers stay unchanged");
    console.log("PASS mixed series, 20 concurrent orders, 10 concurrent child orders, rollback reuse and unchanged existing identifiers");
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
