import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { deleteOrderProduction, lockOrderProductionDeletion } from "../server/order-production-delete";

if (process.env.ISOLATED_ORDER_DELETE !== "1") throw new Error("Run only against the disposable local test database.");
const pool = new Pool({host:"127.0.0.1",port:55442,user:"runner",database:"postgres"});
const db = drizzle(pool);
const dialect = new PgDialect();
try {
  await pool.query(`
    CREATE TABLE orders(id integer PRIMARY KEY);
    CREATE TABLE production_orders(id integer PRIMARY KEY,order_id integer REFERENCES orders(id) ON DELETE CASCADE);
    CREATE TABLE factory_execution(production_order_id integer PRIMARY KEY REFERENCES production_orders(id) ON DELETE RESTRICT);
    CREATE TABLE factory_rolls(id integer PRIMARY KEY,production_order_id integer REFERENCES factory_execution(production_order_id) ON DELETE RESTRICT);
    CREATE TABLE factory_queues(id integer PRIMARY KEY,production_order_id integer REFERENCES production_orders(id) ON DELETE CASCADE);
    CREATE TABLE factory_receipts(id integer PRIMARY KEY);
    CREATE TABLE factory_receipt_items(id integer PRIMARY KEY,receipt_id integer REFERENCES factory_receipts(id) ON DELETE RESTRICT,
      production_order_id integer REFERENCES factory_execution(production_order_id) ON DELETE RESTRICT, UNIQUE(id,receipt_id));
    CREATE TABLE factory_movements(id integer PRIMARY KEY,receipt_id integer,receipt_item_id integer,
      FOREIGN KEY(receipt_item_id,receipt_id) REFERENCES factory_receipt_items(id,receipt_id) ON DELETE RESTRICT);
    CREATE TABLE factory_inventory(id integer PRIMARY KEY,production_order_id integer REFERENCES factory_execution(production_order_id) ON DELETE RESTRICT);
  `);
  const seed = async () => pool.query(`
    TRUNCATE orders,factory_receipts CASCADE;
    INSERT INTO orders VALUES(1),(2),(7);
    INSERT INTO production_orders VALUES(11,1),(12,1),(21,2);
    INSERT INTO factory_execution VALUES(11),(12),(21);
    INSERT INTO factory_rolls VALUES(1,11),(2,12),(3,21);
    INSERT INTO factory_queues VALUES(1,11),(2,12),(3,21);
    INSERT INTO factory_inventory VALUES(1,11),(2,12),(3,21);
    INSERT INTO factory_receipts VALUES(10),(20);
    INSERT INTO factory_receipt_items VALUES(101,10,11),(102,10,21),(201,20,12);
    INSERT INTO factory_movements VALUES(1,10,101),(2,10,102),(3,20,201);
  `);
  const counts = async () => {
    const tables = ["orders","production_orders","factory_execution","factory_rolls","factory_queues",
      "factory_receipts","factory_receipt_items","factory_movements","factory_inventory"];
    return Promise.all(tables.map(async table => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count)));
  };
  await seed();
  const original = await counts();
  await assert.rejects(db.transaction(async tx => {
    await lockOrderProductionDeletion(tx);
    await tx.execute(sql`SELECT id FROM orders WHERE id=1 FOR UPDATE`);
    await deleteOrderProduction({execute:async query => {
      if (dialect.sqlToQuery(query).sql.includes("DELETE FROM factory_rolls")) throw new Error("Simulated failure");
      return tx.execute(query);
    }},1);
  }), /Simulated failure/);
  assert.deepEqual(await counts(),original,"failed cleanup rolls back receipts, movements and inventory");
  await db.transaction(async tx => {
    await lockOrderProductionDeletion(tx);
    await tx.execute(sql`SELECT id FROM orders WHERE id=1 FOR UPDATE`);
    await deleteOrderProduction(tx,1);
    await tx.execute(sql`DELETE FROM orders WHERE id=1`);
  });
  assert.deepEqual(await counts(),[2,1,1,1,1,1,1,1,1]);
  assert.deepEqual((await pool.query("SELECT * FROM factory_receipt_items")).rows,[{id:102,receipt_id:10,production_order_id:21}]);
  assert.equal((await pool.query("SELECT id FROM factory_receipts")).rows[0].id,10,"mixed receipt survives");
  await db.transaction(async tx => {
    await lockOrderProductionDeletion(tx);
    await tx.execute(sql`SELECT id FROM orders WHERE id=7 FOR UPDATE`);
    await deleteOrderProduction(tx,7);
    await tx.execute(sql`DELETE FROM orders WHERE id=7`);
  });
  assert.deepEqual(await counts(),[1,1,1,1,1,1,1,1,1],"empty order deletion preserves all unrelated production");
  console.log("PASS atomic order cascade, rollback, shared receipts, unrelated orders and empty orders (isolated PostgreSQL).");
} finally {
  await pool.end();
}
