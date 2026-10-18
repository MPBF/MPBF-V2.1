// Executes the actual history SQL against disposable, synthetic PostgreSQL data.
// Does not load application configuration or connect to an application database.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const { Pool } = require("pg");

(async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "customer-history-db-"));
  const data = path.join(temp, "data");
  let pool, started = false, checks = 0;
  const check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
  };
  try {
    await build({ entryPoints: ["server/customer-order-history.ts"], bundle: true, platform: "node",
      format: "cjs", outfile: path.join(temp, "history.cjs"), logLevel: "silent" });
    const { customerOrderHistory } = require(path.join(temp, "history.cjs"));
    execFileSync("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", path.join(temp, "postgres.log"), "-o",
      `-k ${temp} -p 16543 -c listen_addresses='' -c fsync=off`, "-w", "start"], { stdio: "pipe" });
    started = true;
    pool = new Pool({ host: temp, port: 16543, database: "postgres", user: os.userInfo().username });
    await pool.query(`
      CREATE TABLE customers(id text PRIMARY KEY);
      CREATE TABLE orders(id integer PRIMARY KEY,customer_id text,order_number text,created_at timestamp);
      CREATE TABLE production_orders(id integer PRIMARY KEY,order_id integer,production_order_number text,
        quantity_kg numeric(10,2),final_quantity_kg numeric(10,2));
      CREATE TABLE factory_execution(production_order_id integer PRIMARY KEY,is_roll_product boolean,is_printed boolean);
      CREATE TABLE factory_rolls(id integer PRIMARY KEY,production_order_id integer,stage text,
        weight_kg numeric(14,2),net_weight_kg numeric(14,2));
      INSERT INTO customers VALUES ('A'),('B'),('EMPTY');
      INSERT INTO orders VALUES
        (1,'A','O-OLD','2026-10-01'),(2,'A','O-NEW','2026-10-18'),
        (3,'A','O-NEWER','2026-10-18'),(4,'B','OTHER-CUSTOMER','2026-10-19');
      INSERT INTO production_orders VALUES
        (11,1,'JO-CUT',100,120),(12,1,'JO-FILM',70,80),(13,1,'JO-PRINT',50,60),
        (14,1,'JO-PRINT-PENDING',60,70),(15,1,'JO-UNSTARTED',30,40),
        (16,1,'JO-DECIMAL',0.30,0.40),(17,1,'JO-NOT-CUT',50,60),
        (18,1,'JO-NOT-CUT-PRINTED',50,60),(19,1,'JO-OVER',100,120),
        (41,4,'JO-PRIVATE',999,999);
      INSERT INTO factory_execution VALUES
        (11,false,true),(12,true,false),(13,true,true),(14,true,true),
        (16,false,false),(17,false,false),(18,false,true),(19,false,false),(41,true,false);
      INSERT INTO factory_rolls VALUES
        (1,11,'done',40.25,35.20),(2,11,'done',10,8.10),
        (3,11,'printing',25,NULL),(4,11,'film',30,NULL),
        (5,12,'done',72.15,NULL),(6,13,'done',51.75,NULL),
        (7,13,'film',20,NULL),(8,14,'film',40,NULL),
        (9,16,'done',0.15,0.10),(10,16,'done',0.25,0.20),
        (11,17,'film',50,NULL),(12,18,'printing',50,NULL),
        (13,19,'done',150.25,135.10),(14,41,'done',999,NULL);
    `);
    const all = await customerOrderHistory(pool, "A", 20, 0);
    check("newest orders first with deterministic same-date ordering", all.orders.map(o => o.id), [3, 2, 1]);
    check("no production lines is an empty group, not a missing order", all.orders[0].production_orders, []);
    const quantities = Object.fromEntries(all.orders[2].production_orders.map(p => [p.production_order_number, p]));
    check("cut product counts net completed output only, including partial completion", quantities["JO-CUT"].produced_kg, "43.30");
    check("film-only roll counts final film output", quantities["JO-FILM"].produced_kg, "72.15");
    check("printed roll counts completed printing, never unfinished film", quantities["JO-PRINT"].produced_kg, "51.75");
    for (const name of ["JO-PRINT-PENDING", "JO-UNSTARTED", "JO-NOT-CUT", "JO-NOT-CUT-PRINTED"]) {
      check(`${name} has no final-stage output`, quantities[name].produced_kg, "0");
    }
    check("decimal output stays exact text at nested JSON boundary", quantities["JO-DECIMAL"].produced_kg, "0.30");
    check("requested quantity is original quantity, not the overrun target", quantities["JO-OVER"].requested_kg, "100.00");
    check("actual overproduction is not capped at requested or planned quantity", quantities["JO-OVER"].produced_kg, "135.10");
    check("customer isolation", JSON.stringify(all).includes("PRIVATE"), false);
    check("all-page has no extra page", [all.has_more, all.next_offset], [false, null]);
    const page1 = await customerOrderHistory(pool, "A", 1, 0);
    const page2 = await customerOrderHistory(pool, "A", 1, page1.next_offset);
    const page3 = await customerOrderHistory(pool, "A", 1, page2.next_offset);
    check("pagination neither skips orders nor splits production lines",
      [page1.orders[0].id, page2.orders[0].id, page3.orders[0].id, page3.orders[0].production_orders.length],
      [3, 2, 1, 9]);
    check("last page ends accurately", [page3.has_more, page3.next_offset], [false, null]);
    check("empty customer", await customerOrderHistory(pool, "EMPTY", 20, 0),
      { orders: [], has_more: false, next_offset: null });
    await assert.rejects(customerOrderHistory(pool, "MISSING", 20, 0), { status: 404 }); checks++;
    check("SQL parameter binding prevents customer-ID injection",
      (await customerOrderHistory(pool, "A", 20, 0)).orders.length, 3);
    await assert.rejects(customerOrderHistory(pool, "A' OR true--", 20, 0), { status: 404 }); checks++;
    // Warehouse receipts intentionally do not participate in manufactured output.
    await pool.query("CREATE TABLE factory_receipt_items(production_order_id integer,quantity_kg numeric); INSERT INTO factory_receipt_items VALUES(11,43.30),(12,72.15)");
    check("receiving stock never reduces the amount actually produced", await customerOrderHistory(pool, "A", 20, 0), all);
    console.log(`Customer history SQL passed ${checks} checks against disposable PostgreSQL.`);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
