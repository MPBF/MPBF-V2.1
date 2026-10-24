// Real SQL, synthetic disposable PostgreSQL only. No application configuration.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const { Pool } = require("pg");

(async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "workflow-db-"));
  const data = path.join(temp, "data");
  let pool, started = false, checks = 0;
  const check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
  };
  try {
    await build({ entryPoints: ["server/order-workflow.ts"], bundle: true, platform: "node",
      format: "cjs", outfile: path.join(temp, "workflow.cjs"), logLevel: "silent" });
    const { orderWorkflow } = require(path.join(temp, "workflow.cjs"));
    execFileSync("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", path.join(temp, "postgres.log"), "-o",
      `-k ${temp} -p 16544 -c listen_addresses='' -c fsync=off`, "-w", "start"], { stdio: "pipe" });
    started = true;
    pool = new Pool({ host: temp, port: 16544, database: "postgres", user: os.userInfo().username });
    await pool.query(`
      CREATE TABLE customers(id text PRIMARY KEY,name text,name_ar text);
      CREATE TABLE orders(id integer PRIMARY KEY,customer_id text,order_number text,created_at timestamp,delivery_date date,status text);
      CREATE TABLE production_orders(id integer PRIMARY KEY,order_id integer,production_order_number text,
        quantity_kg numeric(14,2),final_quantity_kg numeric(14,2),status text,customer_product_id integer);
      CREATE TABLE items(id text PRIMARY KEY,name text,name_ar text);
      CREATE TABLE customer_products(id integer PRIMARY KEY,item_id text);
      CREATE TABLE users(id integer PRIMARY KEY,display_name text,display_name_ar text,full_name text,username text,password text);
      CREATE TABLE machines(id text PRIMARY KEY,name text,name_ar text);
      CREATE TABLE factory_execution(production_order_id integer PRIMARY KEY,is_roll_product boolean,stage text,product jsonb);
      CREATE TABLE factory_rolls(id integer PRIMARY KEY,production_order_id integer,roll_number text,stage text,
        weight_kg numeric(14,2),net_weight_kg numeric(14,2),waste_kg numeric(14,2),
        created_by integer,printed_by integer,cut_by integer,created_at timestamptz,printed_at timestamptz,
        cut_completed_at timestamptz,film_machine_id text,printing_machine_id text,cutting_machine_id text);
      INSERT INTO customers VALUES ('A','Customer A','عميل أ'),('B','Other','آخر');
      INSERT INTO orders VALUES (1,'A','O1','2026-10-18','2026-10-31','in_production'),
        (2,'B','PRIVATE','2026-10-18',NULL,'completed'),(3,'A','EMPTY','2026-10-18',NULL,'waiting');
      INSERT INTO items VALUES('I','Live Item','صنف حالي');
      INSERT INTO customer_products VALUES(100,'I');
      INSERT INTO users VALUES(1,'Film','فيلم','موظف','film','MUST_NOT_LEAK'),
        (2,'Print','طباعة','موظف','print','MUST_NOT_LEAK'),(3,'Cut','قص','موظف','cut','MUST_NOT_LEAK');
      INSERT INTO machines VALUES('F','Film Machine','ماكينة فيلم'),('P','Printing Machine','ماكينة طباعة'),('C','Cutter','قص');
      INSERT INTO production_orders VALUES
        (11,1,'JO-BAG',100,120,'in_production',100),(12,1,'JO-ROLL',50,60,'completed',100),
        (13,1,'JO-UNSTARTED',30,33,'waiting',100),(21,2,'PRIVATE',999,999,'completed',100);
      INSERT INTO factory_execution VALUES
        (11,false,'cutting','{"name":"Frozen","name_ar":"صنف محفوظ"}'),
        (12,true,'completed','{"name":"Roll","name_ar":"رول"}'),
        (21,true,'completed','{}');
      INSERT INTO factory_rolls VALUES
        (1,11,'R1','done',40.25,35.20,5.05,1,2,3,'2026-10-18 08:00Z','2026-10-18 09:00Z','2026-10-18 10:00Z','F','P','C'),
        (2,11,'R2','film',20,NULL,0,1,NULL,NULL,'2026-10-18 08:10Z',NULL,NULL,'F',NULL,NULL),
        (3,11,'R3','printing',10,NULL,0,1,2,NULL,'2026-10-18 08:20Z','2026-10-18 09:20Z',NULL,'F','P',NULL),
        (4,12,'R4','done',72.15,NULL,0,NULL,2,NULL,'2026-10-18 08:30Z','2026-10-18 09:30Z',NULL,'F','P',NULL),
        (5,21,'PRIVATE','done',999,NULL,0,1,NULL,NULL,now(),NULL,NULL,'F',NULL,NULL);
    `);
    const all = await orderWorkflow(pool, 1, { limit: 30, offset: 0 });
    const [bag, roll, unstarted] = all.production_orders;
    check("request and planned target remain separate", [bag.requested_kg, bag.planned_kg], ["100.00", "120.00"]);
    check("bag final net only", bag.produced_kg, "35.20");
    check("roll-product final gross and excess preserved", roll.produced_kg, "72.15");
    check("unstarted zero, uses live item", [unstarted.produced_kg, unstarted.product_name], ["0", "Live Item"]);
    check("started uses frozen item", bag.product_name, "Frozen");
    check("complete and pending counts", [bag.roll_count, bag.completed_rolls], [3, 1]);
    check("waste exact decimal text", bag.waste_kg, "5.05");
    check("film contributions include unfinished input", bag.contributions.find(c => c.stage === "film").quantity_kg, "70.25");
    check("printing contributions include only recorded printing", bag.contributions.find(c => c.stage === "printing").quantity_kg, "50.25");
    check("cutting contribution is net", bag.contributions.find(c => c.stage === "cutting").quantity_kg, "35.20");
    check("unknown actor preserved", roll.contributions.find(c => c.stage === "film").actor, null);
    check("actor projection never leaks password", JSON.stringify(all).includes("MUST_NOT_LEAK"), false);
    check("other order isolated", JSON.stringify(all).includes("PRIVATE"), false);
    check("roll metadata complete", [all.rolls[3].film.actor.id, all.rolls[3].printing.machine_name, all.rolls[3].cutting.actor.id], [1, "Printing Machine", 3]);
    check("pending operation stays unrecorded", all.rolls[2].printing.at, null);
    const page = await orderWorkflow(pool, 1, { limit: 1, offset: 0, production_order_id: 11, stage: "film", search: "r2" });
    check("combined scoped filters", page.rolls.map(r => r.id), [2]);
    check("filters never change summary", page.production_orders, all.production_orders);
    const first = await orderWorkflow(pool, 1, { limit: 2, offset: 0 });
    const second = await orderWorkflow(pool, 1, { limit: 2, offset: first.next_offset });
    check("paging deterministic without duplicates", [...first.rolls, ...second.rolls].map(r => r.id), [4, 3, 2, 1]);
    check("last page", [second.has_more, second.next_offset], [false, null]);
    check("cross-order production filter empty", (await orderWorkflow(pool, 1, { limit: 30, offset: 0, production_order_id: 21 })).rolls, []);
    check("search metacharacters literal", (await orderWorkflow(pool, 1, { limit: 30, offset: 0, search: "%" })).rolls, []);
    check("empty order", (await orderWorkflow(pool, 3, { limit: 30, offset: 0 })).production_orders, []);
    await assert.rejects(orderWorkflow(pool, 999, { limit: 30, offset: 0 }), { status: 404 }); checks++;
    await pool.query("UPDATE factory_rolls SET weight_kg=45.25,net_weight_kg=40.20 WHERE id=1");
    const edited = await orderWorkflow(pool, 1, { limit: 30, offset: 0 });
    check("contributions reflect current corrected rolls, not stale event weights",
      [edited.production_orders[0].produced_kg, edited.production_orders[0].contributions.find(c => c.stage === "cutting").quantity_kg],
      ["40.20", "40.20"]);
    console.log(`Workflow SQL passed ${checks} checks.`);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
