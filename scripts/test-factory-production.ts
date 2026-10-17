// Integration verification in a disposable schema, never business records.
// Uses the app's development connection. No schema changes on the published DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pool as appPool, sessionPool } from "../server/db";
import { Pool as LocalPool } from "pg";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionWarehouseService } from "../server/production/warehouse";
import { ProductionReadService } from "../server/production/read";
import { canStartFilmProductionOrder, type ProductionUser } from "../shared/production";
import type { ConnectionPool } from "../server/production/core";
import express from "express";
import { releaseOrderToProduction } from "../server/order-production-release";
import { applyOrderActions, moveOrderFolders, orderFolderCounts } from "../server/order-workspace";
const uiRequestsPath = process.argv.find(arg=>arg.startsWith("--ui-requests="))?.slice("--ui-requests=".length);
const uiRequests: {route:string;input:{first_position:number;second_position:number}}[] | undefined =
  uiRequestsPath ? JSON.parse(readFileSync(uiRequestsPath,"utf8")) : undefined;
import { createProductionRouter } from "../server/production/routes";
import { verifyProductionHistory } from "./verify-production-history";
import { verifyProductionSearch } from "./verify-production-search";
import { verifyFilmDurations } from "./verify-film-durations";
import { verifyRollActors } from "./verify-roll-actors";
import { verifyFilmOperationSpecs } from "./verify-film-operation-specs";
import { verifyKgReceiving } from "./verify-kg-receiving";

if (process.env.NODE_ENV === "production") throw Error("Integration tests are development-only.");
if (process.argv.includes("--large") && !process.argv.includes("--local")) throw Error("Large fixtures require --local and a disposable database.");
if (process.argv.includes("--search-experiments") && (!process.argv.includes("--local") || !process.argv.includes("--large"))) {
  throw Error("Search experiments require --local --large and a disposable database.");
}
// --local never connects to the application's database.
const pool = process.argv.includes("--local")
  ? new LocalPool({ host: "127.0.0.1", port: 55439, user: "runner", database: "factory_isolated_test" })
  : appPool;
const schema = `factory_test_${randomUUID().replace(/-/g, "")}`;
const isolated: ConnectionPool = { async connect() {
  const tx = await pool.connect();
  await tx.query(`SET search_path TO "${schema}"`);
  return tx;
} };
const service = new ProductionExecutionService(isolated);
const warehouse = new ProductionWarehouseService(isolated);
const read = new ProductionReadService(isolated);
const actor: ProductionUser = { id: 1, permissions: ["admin"] };
const key = () => ({ request_id: randomUUID() });
let passed = 0;
async function test(name: string, action: () => Promise<void>) { await action(); passed++; console.log(`PASS ${name}`); }
async function query(text: string, values: unknown[] = []) {
  const tx = await isolated.connect();
  try { return (await tx.query(text, values)).rows; } finally { tx.release(); }
}
async function plan(id: number, productId: number, target = "100.00") {
  await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1','for_production')", [id, `ORDER-${id}`]);
  await query("INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,$3,$4,$4,'pending')", [id, `PO-${id}`, productId, target]);
  await service.start(actor, id, key());
}
const film = (id: number, weight_kg = "10.00", last = false, inline = false) =>
  service.film(actor, id, { ...key(), machine_id: "F1", weight_kg, is_last_roll: last, inline_printed: inline });
const cut = (id: number, weight = "9.00") => service.cut(actor, id, { ...key(), machine_id: "C1", net_weight_kg: weight });
const print = (id: number) => service.print(actor, id, { ...key(), machine_id: "P1" });
let setup;
try {
  setup = await pool.connect();
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(`SET search_path TO "${schema}"`);
  await setup.query(`
    CREATE TABLE users(id integer PRIMARY KEY,username text,display_name text,display_name_ar text,
      full_name text,password text,email text,phone text);
    CREATE TABLE customers(id varchar(20) PRIMARY KEY,name text,name_ar text,plate_drawer_code text);
    CREATE TABLE items(id varchar(20) PRIMARY KEY,name text,name_ar text);
    CREATE TABLE categories(id serial PRIMARY KEY,name text);
    INSERT INTO categories(name) VALUES('Protected fixture category');
    CREATE TABLE master_batch_colors(id varchar(20) PRIMARY KEY,name text,name_ar text,color_hex text);
    CREATE TABLE customer_products(id integer PRIMARY KEY,customer_id varchar(20),item_id varchar(20),
      width numeric,left_facing numeric,right_facing numeric,thickness numeric DEFAULT 25,universal_thickness numeric,cutting_length_cm integer,
      raw_material text,printing_cylinder text,punching text,notes text,front_print_colors text[],back_print_colors text[],
      is_printed boolean,status text,size_caption text,master_batch_id varchar(20));
    CREATE TABLE machines(id varchar(20) PRIMARY KEY,name text,name_ar text,type text,status text,inline_printer_id varchar(20),
      min_thickness numeric,max_thickness numeric,min_width_cm numeric,max_width_cm numeric,raw_material_type text,
      max_print_colors integer,min_cylinder_inch numeric,max_cylinder_inch numeric,min_length_cm numeric,max_length_cm numeric);
    CREATE TABLE orders(id integer PRIMARY KEY,order_number text,customer_id varchar(20),status text,previous_status text);
    CREATE TABLE production_orders(id integer PRIMARY KEY,order_id integer REFERENCES orders(id) ON DELETE CASCADE,
      production_order_number varchar(50),customer_product_id integer,quantity_kg numeric(14,2),final_quantity_kg numeric(14,2),
      overrun_percentage numeric DEFAULT 0,status text,batch_number varchar(50),previous_status text);
    INSERT INTO users(id) VALUES(1);
    INSERT INTO customers(id,name,name_ar) VALUES('C1','Fixture customer','عميل الاختبار');
    INSERT INTO items VALUES('BAG','Bag','كيس'),('ROLL','Plastic Roll','رول بلاستيك');
    INSERT INTO customer_products(id,customer_id,item_id,width,universal_thickness,cutting_length_cm,raw_material,printing_cylinder,is_printed,status)
      VALUES(1,'C1','BAG',28,25,41,'HDPE','16',true,'active'),(2,'C1','BAG',28,25,41,'HDPE','16',false,'active'),
      (3,'C1','ROLL',28,25,41,'HDPE','16',true,'active'),(4,'C1','ROLL',28,25,41,'HDPE','16',false,'active');
    INSERT INTO machines(id,name,type,status) VALUES('F1','Film','extruder','active'),('P1','Printer','Printer','active'),
      ('C1','Cutter','cutting','active'),('DOWN','Inactive','extruder','down');
    UPDATE machines SET inline_printer_id='P1' WHERE id='F1';
  `);
  await setup.query(readFileSync("migrations/0011_factory_roll_production.sql", "utf8"));
  await setup.query(readFileSync("migrations/0013_order_number_allocations.sql", "utf8"));
  await setup.query(readFileSync("migrations/0016_finished_inventory_units.sql", "utf8"));
  await setup.query(readFileSync("migrations/0014_raw_material_mixing.sql", "utf8"));
  await setup.query(readFileSync("migrations/0017_raw_mixing_screws.sql", "utf8"));
  await setup.query(readFileSync("migrations/0018_production_monitoring.sql", "utf8"));
  await setup.query(readFileSync("migrations/0019_finished_receipts_kg_only.sql", "utf8"));
  await setup.query(readFileSync("migrations/0021_finished_deliveries.sql", "utf8"));
  setup.release(); setup = undefined;
  await test("fixed hall receives with no locations, rolls back provisioning and serializes concurrent creation", async () => {
    assert.equal((await query("SELECT count(*)::int n FROM factory_locations"))[0].n,0);
    await plan(11,4); await film(11,"10",true);
    await plan(12,4); await film(12,"10",true);
    const receiver={id:1,permissions:["receive_production"]};
    const receiptInput=(order:number)=>({...key(),items:[{
      production_order_id:order,quantity_kg:"1",
    }]});
    assert.throws(()=>warehouse.receive({id:1,permissions:["view_production_hall"]},receiptInput(11)),/صلاحية/);
    await query(`CREATE FUNCTION refuse_fixed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixed hall rollback'; END $$;
      CREATE TRIGGER refuse_fixed_receipt BEFORE INSERT ON factory_receipt_items FOR EACH ROW EXECUTE FUNCTION refuse_fixed_receipt()`);
    await assert.rejects(warehouse.receive(receiver,receiptInput(11)),/fixed hall rollback/);
    assert.equal((await query("SELECT count(*)::int n FROM factory_locations"))[0].n,0);
    await query("DROP TRIGGER refuse_fixed_receipt ON factory_receipt_items; DROP FUNCTION refuse_fixed_receipt()");
    const request=receiptInput(11);
    const receipts=await Promise.all([warehouse.receive(receiver,request),warehouse.receive(receiver,receiptInput(12))]);
    const sites=await query("SELECT id,name,name_ar,is_active FROM factory_locations");
    assert.equal(sites.length,1);
    assert.equal(sites[0].name_ar,"صالة المواد التامة");
    assert.ok(receipts.every(receipt=>receipt.items.every(item=>item.location_id===sites[0].id)));
    const replay=await warehouse.receive(receiver,request);
    assert.equal(replay.id,receipts[0].id);
    assert.equal((await query("SELECT count(*)::int n FROM factory_receipts"))[0].n,2);
    await assert.rejects(warehouse.location(actor,{...key(),name:"Changed",name_ar:"تغيير",is_active:false},sites[0].id),/موقع ثابت/);
  });
  const location = await warehouse.location(actor, { ...key(), name: "Location", name_ar: "موقع" }) as { id: number };
  const secondLocation = await warehouse.location(actor, { ...key(), name: "Second", name_ar: "ثاني" }) as { id: number };
  await test("printed bag may print/cut and receive while film is still open; hall returns after more cutting", async () => {
    await plan(1, 1);
    const roll = await film(1);
    await assert.rejects(cut(roll.id), /مؤهل/);
    await print(roll.id); await cut(roll.id);
    await warehouse.receive(actor, { ...key(), items: [{ production_order_id: 1, location_id: location.id, quantity_kg: "9.00" }] });
    let state = await read.state(actor);
    assert.equal(state.orders.find(o => o.id === 1)?.remaining_kg, "0.00");
    assert.equal(state.orders.find(o => o.id === 1)?.status, "active");
    assert.equal(state.orders.find(o => o.id === 1)?.film_closed_at, null);
    const next = await film(1); await print(next.id); await cut(next.id, "8.00");
    state = await read.state(actor);
    assert.equal(state.orders.find(o => o.id === 1)?.remaining_kg, "8.00");
    assert.equal(state.orders.find(o => o.id === 1)?.waste_kg, "3.00");
    await service.closeFilm(actor, 1, key());
    state = await read.state(actor);
    assert.equal(state.orders.find(o => o.id === 1)?.status, "completed");
    assert.equal(state.orders.find(o => o.id === 1)?.order_status, "completed");
    assert.ok(state.orders.find(o => o.id === 1)?.batch_number);
    await assert.rejects(film(1), /قابل للتنفيذ|مغلق/);
  });
  await test("unprinted bags skip print; final roll closes film below planned target; cutting completes", async () => {
    await plan(2, 2);
    const roll = await film(2, "10.00", true);
    await assert.rejects(print(roll.id), /مؤهل/);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 2)?.status, "active");
    await cut(roll.id);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 2)?.ready_kg, "9.00");
    assert.equal((await read.state(actor)).orders.find(o => o.id === 2)?.status, "completed");
  });
  await test("printed roll skips cutting and uses original film weight for readiness", async () => {
    await plan(3, 3);
    const roll = await film(3, "12.00", true);
    await assert.rejects(cut(roll.id), /مؤهل/);
    await print(roll.id);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 3)?.ready_kg, "12.00");
    assert.equal((await read.state(actor)).orders.find(o => o.id === 3)?.status, "completed");
  });
  await test("unprinted roll becomes ready immediately but receipt never closes open film", async () => {
    await plan(4, 4);
    const roll = await film(4);
    assert.equal(roll.stage, "done");
    await warehouse.receive(actor, { ...key(), items: [{ production_order_id: 4, location_id: location.id, quantity_kg: "5" }] });
    assert.equal((await read.state(actor)).orders.find(o => o.id === 4)?.status, "active");
    assert.equal((await read.state(actor)).orders.find(o => o.id === 4)?.remaining_kg, "5.00");
  });
  await test("exact-target roll closes film automatically without dummy rolls", async () => {
    await plan(5, 4, "10.00");
    const roll = await film(5, "10.00");
    assert.equal(roll.is_last_roll, true);
    await assert.rejects(film(5, "0.01"), /قابل للتنفيذ|مغلق/);
    assert.equal((await query("SELECT count(*)::int n FROM factory_rolls WHERE production_order_id=5"))[0].n, 1);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 5)?.status, "completed");
  });
  await test("over-target film preserves actual weight and closes film but awaits cutting", async () => {
    await plan(501, 2, "10.00");
    const first = await film(501, "8.00");
    assert.equal(first.is_last_roll, false);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 501)?.film_closed_at, null);
    const lastRoll = await film(501, "3.00");
    assert.equal(lastRoll.weight_kg, "3.00");
    assert.equal(lastRoll.is_last_roll, true);
    let order = (await read.state(actor)).orders.find(o => o.id === 501)!;
    assert.equal(order.produced_kg, "11.00");
    assert.equal(order.final_quantity_kg, "10.00");
    assert.ok(order.film_closed_at);
    assert.equal(order.status, "active");
    await assert.rejects(film(501, "1.00"), /مغلق/);
    await cut(first.id, "8.00");
    await cut(lastRoll.id, "3.00");
    order = (await read.state(actor)).orders.find(o => o.id === 501)!;
    assert.equal(order.ready_kg, "11.00");
    assert.equal(order.status, "completed");
  });
  await test("first roll may exceed the entire plan and replay never duplicates it", async () => {
    await plan(502, 3, "10.00");
    const input = { ...key(), machine_id: "F1", weight_kg: "12.50", is_last_roll: false };
    const roll = await service.film(actor, 502, input);
    const replay = await service.film(actor, 502, input);
    assert.equal(roll.weight_kg, "12.50");
    assert.equal(roll.is_last_roll, true);
    assert.equal(replay.id, roll.id);
    assert.equal(replay.is_last_roll, true);
    assert.equal((await query("SELECT count(*)::int n FROM factory_rolls WHERE production_order_id=502"))[0].n, 1);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 502)?.status, "active");
    await print(roll.id);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 502)?.ready_kg, "12.50");
    assert.equal((await read.state(actor)).orders.find(o => o.id === 502)?.status, "completed");
  });
  await test("concurrent rolls crossing the plan serialize closure and forbid an extra roll", async () => {
    await plan(503, 4, "10.00");
    await film(503, "9.00");
    const results = await Promise.allSettled([film(503, "2.00"), film(503, "2.00")]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rolls = await query("SELECT weight_kg,is_last_roll FROM factory_rolls WHERE production_order_id=503 ORDER BY sequence");
    assert.deepEqual(rolls.map(roll => roll.weight_kg), ["9.00", "2.00"]);
    assert.deepEqual(rolls.map(roll => roll.is_last_roll), [false, true]);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 503)?.produced_kg, "11.00");
  });
  await test("inline printing uses linked active printer and same timestamp; invalid inline rolls roll back", async () => {
    await plan(6, 1); await plan(7, 3); await plan(8, 2);
    const bag = await film(6, "10.00", false, true), roll = await film(7, "10.00", true, true);
    assert.equal(bag.printing_machine_id, "P1"); assert.equal(bag.stage, "printing"); assert.equal(roll.stage, "done");
    assert.equal(String(bag.created_at), String(bag.printed_at));
    await assert.rejects(film(8, "10", false, true), /يتطلب/);
    await query("UPDATE machines SET status='down' WHERE id='P1'");
    await assert.rejects(film(6, "10", false, true), /نشطة/);
    await query("UPDATE machines SET status='active' WHERE id='P1'");
    assert.equal((await query("SELECT count(*)::int n FROM factory_rolls WHERE production_order_id=8"))[0].n, 0);
  });
  await test("concurrent registration is sequential, retries are idempotent, changed key payload rejected", async () => {
    await plan(9, 4);
    const rolls = await Promise.all(Array.from({ length: 8 }, () => film(9, "1")));
    assert.equal(new Set(rolls.map(r => r.roll_number)).size, 8);
    const sequences = (await query("SELECT sequence FROM factory_rolls WHERE production_order_id=9 ORDER BY sequence")).map(r => r.sequence);
    assert.deepEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8]);
    const input = { ...key(), machine_id: "F1", weight_kg: "1" };
    const [first, retry] = await Promise.all([service.film(actor, 9, input), service.film(actor, 9, input)]);
    assert.equal(first.id, retry.id);
    await assert.rejects(service.film(actor, 9, { ...input, weight_kg: "2" }), /مفتاح/);
  });
  await test("concurrent transitions cannot print/cut twice, net/gross limits and waste are authoritative", async () => {
    await plan(10, 1);
    const roll = await film(10);
    const results = await Promise.allSettled([print(roll.id), print(roll.id)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    await assert.rejects(cut(roll.id, "10.01"), /الصافي/);
    const cutResults = await Promise.allSettled([cut(roll.id), cut(roll.id)]);
    assert.equal(cutResults.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await query("SELECT waste_kg FROM factory_rolls WHERE id=$1", [roll.id]))[0].waste_kg, "1.00");
  });
  await test("multi-item receipts update EVERY balance and movement at the fixed hall despite legacy location inputs", async () => {
    const input = { ...key(), notes: "Fixture voucher", items: [
      { production_order_id: 1, location_id: secondLocation.id, quantity_kg: "8.00" },
      { production_order_id: 3, location_id: location.id, quantity_kg: "12.00" },
    ] };
    const receipt = await warehouse.receive(actor, input);
    const replay = await warehouse.receive(actor, input);
    assert.equal(receipt.id, replay.id);
    const movements = await query("SELECT * FROM factory_movements WHERE receipt_id=$1", [receipt.id]);
    assert.equal(movements.length, 2);
    const balances = await query("SELECT * FROM factory_inventory WHERE production_order_id IN(1,3) ORDER BY production_order_id,location_id");
    assert.equal(balances.length, 2);
    assert.equal(new Set(balances.map(row=>row.location_id)).size,1);
    assert.ok(balances.every(row=>row.location_id!==location.id&&row.location_id!==secondLocation.id));
    assert.equal(balances.find(r => r.production_order_id === 3).quantity_kg, "12.00");
  });
  await test("concurrent over-receipt has one winner; partial receipt accounting stays exact", async () => {
    const make = () => warehouse.receive(actor, { ...key(), items: [{ production_order_id: 4, location_id: location.id, quantity_kg: "4" }] });
    const results = await Promise.allSettled([make(), make()]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await read.state(actor)).orders.find(o => o.id === 4)?.remaining_kg, "1.00");
  });
  await test("a late database failure rolls back voucher, ALL items, balances and movements", async () => {
    const before = await query("SELECT (SELECT count(*) FROM factory_receipts)::int receipts,(SELECT sum(quantity_kg) FROM factory_inventory)::text total,(SELECT count(*) FROM factory_movements)::int movements");
    await query(`CREATE FUNCTION fixture_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.production_order_id=5 THEN RAISE EXCEPTION 'fixture late failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON factory_receipt_items FOR EACH ROW EXECUTE FUNCTION fixture_fail_second()`);
    await assert.rejects(warehouse.receive(actor, { ...key(), items: [
      { production_order_id: 4, location_id: location.id, quantity_kg: "1" },
      { production_order_id: 5, location_id: location.id, quantity_kg: "1" },
    ] }), /fixture late failure/);
    const after = await query("SELECT (SELECT count(*) FROM factory_receipts)::int receipts,(SELECT sum(quantity_kg) FROM factory_inventory)::text total,(SELECT count(*) FROM factory_movements)::int movements");
    assert.deepEqual(after, before);
    await query("DROP TRIGGER fixture_fail ON factory_receipt_items; DROP FUNCTION fixture_fail_second()");
  });
  await test("started plan protected across direct update/delete/cascade and parent completion", async () => {
    for (const sql of ["UPDATE production_orders SET quantity_kg=101 WHERE id=4", "UPDATE production_orders SET final_quantity_kg=101 WHERE id=4",
      "UPDATE production_orders SET customer_product_id=1 WHERE id=4", "UPDATE production_orders SET status='pending' WHERE id=4",
      "DELETE FROM production_orders WHERE id=4", "DELETE FROM orders WHERE id=4", "UPDATE orders SET status='completed' WHERE id=4",
      "UPDATE orders SET customer_id='OTHER' WHERE id=4"]) await assert.rejects(query(sql), /factory|Factory/);
    assert.equal((await query("SELECT count(*)::int n FROM production_orders WHERE id=4"))[0].n, 1);
  });
  await test("paused orders, wrong machine types/inactive machines, original thickness are server-checked", async () => {
    await query("UPDATE orders SET status='paused' WHERE id=9");
    await assert.rejects(film(9), /متوقف/);
    await query("UPDATE orders SET status='in_production' WHERE id=9");
    await assert.rejects(service.film(actor, 9, { ...key(), machine_id: "P1", weight_kg: "1" }), /نشطة/);
    await assert.rejects(service.film(actor, 9, { ...key(), machine_id: "DOWN", weight_kg: "1" }), /نشطة/);
    await query("UPDATE machines SET min_thickness=30 WHERE id='F1'");
    await assert.rejects(film(9), /السماكة الأصلية.*الحد الأدنى/);
    await query("UPDATE machines SET min_thickness=NULL WHERE id='F1'");
  });
  await test("permissions, frozen route/product specs, independent stage queues, historic execution absence", async () => {
    await assert.rejects(async () => service.film({ id: 1, permissions: ["manage_production"] }, 9, { ...key(), machine_id: "F1", weight_kg: "1" }), /صلاحية/);
    await assert.rejects(async () => warehouse.receive({ id: 1, permissions: ["view_production_hall"] }, { ...key(), items: [{ production_order_id: 4, location_id: location.id, quantity_kg: "1" }] }), /صلاحية/);
    await query("UPDATE customer_products SET is_printed=false,item_id='ROLL',width=99 WHERE id=1");
    const fresh = await film(6);
    assert.equal(fresh.stage, "film");
    const state = await read.state(actor);
    assert.equal(state.orders.find(o => o.id === 6)?.product?.width, "28");
    assert.equal(state.orders.find(o => o.id === 6)?.is_printed, true);
    const q1 = await service.queue(actor, { ...key(), production_order_id: 6, stage: "film", machine_id: "F1", position: 2 });
    await service.queue(actor, { ...key(), production_order_id: 6, stage: "printing", machine_id: "P1", position: 1 });
    assert.equal((await read.state(actor)).queues.filter(q => q.production_order_id === 6).length, 2);
    await service.removeQueue(actor, (q1 as { id: number }).id, key());
    assert.equal((await read.state(actor)).queues.filter(q => q.production_order_id === 6).length, 1);
    const hall = await read.state({ id: 1, permissions: ["view_production_hall"] });
    assert.equal(hall.inventory.length, 0); assert.equal(hall.rolls.length, 0);
    assert.ok(hall.orders.every(o => Number(o.remaining_kg) > 0));
    await query("INSERT INTO orders VALUES(90,'HISTORIC','C1','completed'); INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status) VALUES(90,90,'HISTORIC-1',2,500,500,'completed')");
    assert.equal((await read.state(actor)).orders.find(o => o.id === 90), undefined);
    assert.equal((await read.history(actor, "orders", { search: "HISTORIC-1" })).records[0]?.started_at, null);
  });
  await test("order release is concurrent-safe, leaves plans untouched and enables explicit production start", async () => {
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES(91,'RELEASE-91','C1','waiting')");
    await query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status)
      VALUES(91,91,'RELEASE-91-01',1,10,11,'pending')`);
    const before = await query("SELECT * FROM production_orders WHERE id=91");
    await Promise.all([releaseOrderToProduction(91,"waiting",isolated),releaseOrderToProduction(91,"waiting",isolated)]);
    assert.deepEqual(await query("SELECT * FROM production_orders WHERE id=91"),before);
    assert.equal((await query("SELECT * FROM orders WHERE id=91"))[0].previous_status,"waiting");
    assert.equal((await query("SELECT * FROM factory_execution WHERE production_order_id=91")).length,0);
    await service.start(actor,91,key());
    await releaseOrderToProduction(91,"waiting",isolated);
    assert.equal((await query("SELECT * FROM orders WHERE id=91"))[0].status,"in_production");
    assert.equal((await query("SELECT * FROM factory_rolls WHERE production_order_id=91")).length,0);
  });
  await test("atomic queue reordering, stale position rejection and replay protection", async () => {
    await service.queue(actor, { ...key(), production_order_id: 9, stage: "film", machine_id: "F1", position: 1 });
    await service.queue(actor, { ...key(), production_order_id: 8, stage: "film", machine_id: "F1", position: 2 });
    const entries = (await read.state(actor)).queues.filter(q => q.stage === "film" && q.machine_id === "F1");
    const uiReorder = uiRequests?.find(request=>request.route==="/production/queues/reorder");
    if(uiRequests) assert.ok(uiReorder,"browser must supply its actual reorder payload");
    const input = { ...key(), first_id: entries[0].id, second_id: entries[1].id,
      first_position: uiReorder?.input.first_position??entries[0].position,
      second_position: uiReorder?.input.second_position??entries[1].position };
    await service.reorderQueue(actor, input); await service.reorderQueue(actor, input);
    const swapped = (await read.state(actor)).queues.filter(q => q.stage === "film" && q.machine_id === "F1");
    assert.equal(swapped[0].id, entries[1].id);
    await assert.rejects(service.reorderQueue(actor, { ...input, ...key() }), /تغير/);
  });
  await test("shared folders are manual, status-independent, atomic and replay-safe", async () => {
    await query(readFileSync("migrations/0012_order_display_folders.sql", "utf8"));
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES(92,'WORKSPACE-92','C1','waiting'),(93,'WORKSPACE-93','C1','on_hold')");
    const before = await query("SELECT * FROM orders WHERE id IN(90,91,92,93) ORDER BY id");
    const plans = await query("SELECT * FROM production_orders WHERE order_id IN(90,91,92,93) ORDER BY id");
    await moveOrderFolders("archive", [{ id: 91, expected_folder: "new" }, { id: 90, expected_folder: "new" }], 1, isolated);
    assert.deepEqual(await query("SELECT * FROM orders WHERE id IN(90,91,92,93) ORDER BY id"), before);
    assert.deepEqual(await query("SELECT * FROM production_orders WHERE order_id IN(90,91,92,93) ORDER BY id"), plans);
    assert.equal((await moveOrderFolders("archive", [{ id: 91, expected_folder: "new" }], 1, isolated)).moved, 0);
    await assert.rejects(moveOrderFolders("urgent", [{ id: 92, expected_folder: "new" }, { id: 91, expected_folder: "new" }], 1, isolated), /لم يُنقل/);
    assert.equal((await query("SELECT * FROM order_display_folder_assignments WHERE order_id=92")).length, 0);
    const results = await Promise.allSettled([
      moveOrderFolders("production", [{ id: 92, expected_folder: "new" }], 1, isolated),
      moveOrderFolders("urgent", [{ id: 92, expected_folder: "new" }], 1, isolated),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    await moveOrderFolders("new", [{ id: 91, expected_folder: "archive" }], 1, isolated);
    assert.equal((await query("SELECT folder FROM order_display_folder_assignments WHERE order_id=91"))[0].folder, "new");
    const counts = await orderFolderCounts(isolated);
    assert.equal(counts.total, (await query("SELECT count(*)::int count FROM orders"))[0].count);
    assert.equal(counts.counts.archive, 1);
  });
  await test("bulk actions stop execution without modifying plans or folders; invalid batches roll back", async () => {
    const folders = await query("SELECT * FROM order_display_folder_assignments ORDER BY order_id");
    const plans = await query("SELECT * FROM production_orders WHERE order_id IN(91,92,93) ORDER BY id");
    await applyOrderActions("pause", [{ id: 92, expected_status: "waiting" }, { id: 93, expected_status: "on_hold" }], isolated);
    assert.equal((await query("SELECT status FROM orders WHERE id=92"))[0].status, "paused");
    await applyOrderActions("pause", [{ id: 92, expected_status: "waiting" }], isolated);
    await assert.rejects(applyOrderActions("cancel", [{ id: 92, expected_status: "paused" }, { id: 90, expected_status: "completed" }], isolated), /لم تتغير/);
    assert.equal((await query("SELECT status FROM orders WHERE id=92"))[0].status, "paused");
    await applyOrderActions("cancel", [{ id: 91, expected_status: "in_production" }, { id: 92, expected_status: "paused" }], isolated);
    await assert.rejects(film(91), /متوقف|قابل للتنفيذ/);
    await assert.rejects(applyOrderActions("release", [{ id: 91, expected_status: "cancelled" }], isolated), /لم تتغير/);
    await assert.rejects(applyOrderActions("pause", [{ id: 93, expected_status: "paused" }, { id: 93, expected_status: "paused" }], isolated), /دون تكرار/);
    assert.deepEqual(await query("SELECT * FROM production_orders WHERE order_id IN(91,92,93) ORDER BY id"), plans);
    assert.deepEqual(await query("SELECT * FROM order_display_folder_assignments ORDER BY order_id"), folders);
  });
  await test("film operators start released plans without auto-start, unauthorized starts or duplicate execution", async () => {
    const filmActor: ProductionUser = { ...actor, permissions: ["operate_film"] };
    const prepare = async (id: number, parentStatus = "for_production") => {
      await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1',$3)",[id,`READY-${id}`,parentStatus]);
      await query("INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,1,'100.00','110.00','pending')",[id,`READY-PO-${id}`]);
    };
    await prepare(99001);
    const pending = (await read.state(filmActor, "film")).orders.find(order => order.id===99001)!;
    assert.equal(pending.started_at,null);
    assert.equal(pending.order_status,"for_production");
    assert.equal(pending.previous_status,null);
    assert.equal(canStartFilmProductionOrder(pending),true);
    const request=key();
    const started=await service.start(filmActor,99001,request);
    assert.deepEqual(await service.start(filmActor,99001,request),started);
    assert.equal((await query("SELECT count(*)::int n FROM factory_execution WHERE production_order_id=99001"))[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM factory_rolls WHERE production_order_id=99001"))[0].n,0);
    assert.equal((await query("SELECT status FROM orders WHERE id=99001"))[0].status,"in_production");
    assert.equal((await query("SELECT status FROM production_orders WHERE id=99001"))[0].status,"active");
    for (const permissions of [["view_production"],["operate_printing"],["operate_cutting"]]) {
      await assert.rejects(async () => service.start({...actor,permissions},99001,key()), (error:any)=>error.status===403);
    }
    for (const status of ["waiting","paused","cancelled","completed","delivered","archived"]) {
      const id=99010+["waiting","paused","cancelled","completed","delivered","archived"].indexOf(status);
      await prepare(id,status);
      await assert.rejects(service.start(filmActor,id,key()), /قابل للتنفيذ/);
      assert.equal((await query("SELECT count(*)::int n FROM factory_execution WHERE production_order_id=$1",[id]))[0].n,0);
    }
    await prepare(99002);
    await query("UPDATE production_orders SET previous_status='active' WHERE id=99002");
    const historical = (await read.state(filmActor,"film")).orders.find(order=>order.id===99002)!;
    assert.equal(historical.previous_status,"active");
    assert.equal(canStartFilmProductionOrder(historical),false);
    await assert.rejects(service.start(filmActor,99002,key()),/تاريخي/);
    await prepare(99003);
    const results=await Promise.allSettled([service.start(filmActor,99003,key()),service.start(filmActor,99003,key())]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
    assert.equal((await query("SELECT count(*)::int n FROM factory_execution WHERE production_order_id=99003"))[0].n,1);
  });
  await test("HTTP authentication, read-only permissions, strict payload rejection and no client-forced transitions", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const permissions = req.headers["x-fixture-permissions"];
      if (typeof permissions === "string") req.user = { ...actor, permissions: permissions.split(","), username: "fixture", display_name: null, display_name_ar: null,
        role_id: 1, role_name: null, role_name_ar: null, section_id: null, preferred_language: "en", must_change_password: false };
      next();
    });
    app.use("/api/production", createProductionRouter(isolated));
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => http.once("listening", resolve));
    const { port } = http.address() as { port: number };
    async function call(path: string, permissions?: string, body?: unknown) {
      return fetch(`http://127.0.0.1:${port}/api/production${path}`, { method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(permissions ? { "x-fixture-permissions": permissions } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    try {
      assert.equal((await call("/state")).status, 401);
      assert.equal((await call("/state", "view_orders")).status, 403);
      assert.equal((await call("/state", "view_production")).status, 200);
      assert.equal((await call("/state?scope=invalid", "view_production")).status, 400);
      assert.equal((await call("/history/orders")).status, 401);
      assert.equal((await call("/history/orders", "view_finished_inventory")).status, 403);
      assert.equal((await call("/history/receipts", "operate_film")).status, 403);
      assert.equal((await call("/history/receipts", "view_finished_inventory")).status, 200);
      const receiptLine={production_order_id:9,quantity_kg:"1"};
      const packedLine={...receiptLine,packing:{unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"1"}};
      assert.equal((await call("/receipts","view_finished_inventory",{...key(),items:[receiptLine]})).status,403);
      for(const invalid of [
        packedLine,
        {...packedLine,packing:{...packedLine.packing,unit:"box"}},
        {...packedLine,packing:{...packedLine.packing,quantity:"-1"}},
        {...packedLine,packing:{...packedLine.packing,actor_id:123}},
        {...packedLine,line_number:999},
        {...packedLine,packaging:{roll_weight_grams:"1",rolls_per_unit:1,units:1}},
        {production_order_id:9,location_id:location.id},
      ]){
        assert.equal((await call("/receipts","receive_production",{...key(),items:[invalid]})).status,400);
      }
      for (const query of ["limit=101", "limit=0", "before=-1", "search=a&search=b", "from=invalid", "from=2026-02-30", "from=2026-10-02&to=2026-10-01", "status=unknown", "location_id=0"]) {
        assert.equal((await call(`/history/orders?${query}`, "view_production")).status, 400, query);
      }
      assert.equal((await call("/history/receipts?status=done", "view_finished_inventory")).status, 400);
      assert.equal((await call("/history/rolls?status=completed", "operate_film")).status, 400);
      assert.equal((await call("/orders/9/rolls", "view_production", { ...key(), machine_id: "F1", weight_kg: "1" })).status, 403);
      for (const extra of [{ stage: "done" }, { printed_at: "2026-10-01" }, { printing_machine_id: "P1" }, { request_id: "bad-key" }, { weight_kg: "-1" }, { weight_kg: "1.001" },
        { production_minutes: 10 }, { production_minutes: null }, { production_minutes: "10" }]) {
        assert.equal((await call("/orders/9/rolls", "operate_film", { ...key(), machine_id: "F1", weight_kg: "1", ...extra })).status, 400);
      }
      const denial = await call("/locations", "view_finished_inventory", { ...key(), name: "Unauthorized", name_ar: "مرفوض" });
      assert.equal(denial.status, 403); assert.ok((await denial.json()).message_en);
      assert.equal((await call("/rolls/1")).status, 401);
      assert.equal((await call("/rolls/1", "view_orders")).status, 403);
      const [{id:tracedRollId}]=await query("SELECT id FROM factory_rolls WHERE production_order_id=1 ORDER BY sequence LIMIT 1");
      const traced = await call(`/rolls/${tracedRollId}`, "view_finished_inventory");
      assert.equal(traced.status, 200);
      const rollDetail = await traced.json();
      assert.equal(rollDetail.order_number, "ORDER-1");
      assert.equal(rollDetail.order_status, "completed");
      assert.equal(rollDetail.production_order_status, "completed");
      assert.equal(rollDetail.production_stage, "completed");
      assert.ok(rollDetail.batch_number.startsWith("FP-"));
      assert.equal(rollDetail.film_duration.machine_id, rollDetail.film_machine_id);
      assert.ok(rollDetail.film_duration.roll_count >= 1);
      assert.equal((await call("/rolls/1/qr")).status, 401);
      assert.equal((await call("/rolls/1/qr", "view_orders")).status, 403);
      const qrResponse = await call(`/rolls/${tracedRollId}/qr`, "operate_film");
      assert.equal(qrResponse.status, 200);
      assert.equal(qrResponse.headers.get("cache-control"), "private, no-store");
      const qr = await qrResponse.json();
      assert.equal(qr.url, `http://127.0.0.1:${port}/production/rolls/${tracedRollId}`);
      assert.ok(qr.image.startsWith("data:image/png;base64,"));
    } finally { await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); }
  });
  if (process.argv.includes("--local")) await verifyProductionSearch(isolated);
  await verifyProductionHistory(isolated, query, process.argv.includes("--large"));
  await verifyFilmDurations(isolated, query);
  await verifyRollActors(isolated, query);
  await verifyFilmOperationSpecs(isolated, query);
  await verifyKgReceiving(isolated, query);
  console.log(`Verified ${passed} PostgreSQL factory production integration scenarios.`);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await setup?.query("ROLLBACK");
  setup?.release();
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
  if (pool !== appPool) await appPool.end();
  await sessionPool.end();
}