import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { ProductionUser, ProductionHistoryKind } from "../shared/production";
import type { ConnectionPool } from "../server/production/core";
import { ProductionReadService } from "../server/production/read";
import { inventorySelect, movementSelect, orderSelect, receiptSelect, rollSelect } from "../server/production/read-queries";

type Query = (text: string, values?: unknown[]) => Promise<any[]>;
export async function verifyProductionHistory(pool: ConnectionPool, query: Query, large: boolean) {
  const read = new ProductionReadService(pool);
  const actor: ProductionUser = { id: 1, permissions: ["admin"] };
  const warehouse: ProductionUser = { id: 1, permissions: ["view_finished_inventory"] };
  const operator: ProductionUser = { id: 1, permissions: ["operate_film"] };
  const hall: ProductionUser = { id: 1, permissions: ["view_production_hall"] };
  for (const kind of ["orders", "rolls"] as const) await assert.rejects(read.history(warehouse, kind, {}), /صلاحية/);
  for (const kind of ["receipts", "inventory", "movements"] as const) await assert.rejects(read.history(operator, kind, {}), /صلاحية/);
  await assert.rejects(read.history(hall, "receipts", {}), /صلاحية/);
  for (const kind of ["orders", "rolls", "receipts", "inventory", "movements"] as const) {
    let before: number | undefined, count = 0;
    const ids = new Set<number>();
    do {
      const page = await read.history(actor, kind, { limit: 2, before });
      assert.ok(page.records.length <= 2);
      for (const record of page.records) { assert.ok(!ids.has(record.id)); ids.add(record.id); count++; }
      before = page.next ?? undefined;
    } while (before);
    const table = { orders: "production_orders", rolls: "factory_rolls", receipts: "factory_receipts", inventory: "factory_inventory", movements: "factory_movements" }[kind];
    assert.equal(count, (await query(`SELECT count(*)::int n FROM ${table}`))[0].n);
  }
  const [multi] = await query("SELECT receipt_id FROM factory_receipt_items GROUP BY receipt_id HAVING count(*)>1 LIMIT 1");
  assert.ok(multi);
  const lines = await query("SELECT * FROM factory_receipt_items WHERE receipt_id=$1 ORDER BY id", [multi.receipt_id]);
  const voucherPage = await read.history(actor, "receipts", { order_id: lines[0].production_order_id, location_id: lines[0].location_id, limit: 1 });
  const voucher = voucherPage.records.find(record => record.id === multi.receipt_id)
    ?? (await read.history(actor, "receipts", { search: (await query("SELECT voucher_number FROM factory_receipts WHERE id=$1", [multi.receipt_id]))[0].voucher_number })).records[0];
  assert.deepEqual(voucher.items.map(line => line.id), lines.map(line => line.id));
  const order = (await read.history(actor, "orders", { search: "PO-4" })).records.find(record => record.id === 4)!;
  assert.equal(order.remaining_kg, "1.00"); assert.equal(order.film_closed_at, null);
  const film = await read.state(actor, "film");
  assert.ok(film.orders.some(order => order.id === 4));
  assert.ok(film.rolls.some(roll => roll.production_order_id === 4 && roll.stage === "done"));
  assert.equal(film.orders.find(order => order.id === 4)!.roll_count!, film.rolls.filter(roll => roll.production_order_id === 4).length);
  assert.ok(film.rolls.every(roll => film.orders.some(order => order.id === roll.production_order_id && !order.film_closed_at)));
  assert.equal((await read.state(warehouse, "warehouse")).orders.length, 0);
  assert.equal((await read.state(hall, "hall")).rolls.length, 0);
  const created = (await query("SELECT (created_at AT TIME ZONE 'Asia/Riyadh')::date::text AS fixture_date FROM factory_rolls ORDER BY id LIMIT 1"))[0].fixture_date;
  assert.ok((await read.history(actor, "rolls", { from: created, to: created })).records.length);
  assert.equal((await read.history(actor, "rolls", { from: "1900-01-01", to: "1900-01-01" })).records.length, 0);
  assert.equal((await read.history(actor, "orders", { search: "%' OR true --" })).records.length, 0);
  assert.ok((await read.history(actor, "orders", { search: "Fixture customer" })).records.length);
  assert.ok((await read.history(actor, "orders", { search: "عميل الاختبار" })).records.length);
  assert.ok((await read.history(actor, "rolls", { status: "done" })).records.every(roll => roll.stage === "done"));
  console.log("PASS paginated history coverage, permission parity, dates/search, whole vouchers and full-source partial quantities");
  if (!large) return;
  // Synthetic records only, inside the disposable fixture database/schema.
  // Keep 70 OLD completed orders partially unreceived: a single 50-row archive
  // page must never determine what the hall can receive.
  const size = 100000;
  await query(`
    INSERT INTO orders SELECT n,'ARCHIVE-'||n,'C1','completed' FROM generate_series(10001,${10000 + size}) n;
    INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status)
      SELECT n,n,'ARCHIVE-PO-'||n,2,30,30,'completed' FROM generate_series(10001,${10000 + size}) n;
    INSERT INTO factory_execution(production_order_id,customer_product_id,item_id,product,is_printed,is_roll_product,
      started_at,film_closed_at,completed_at,stage,batch_number)
      SELECT n,2,'BAG','{"id":2,"item_id":"BAG","name":"Bag","name_ar":"كيس","customer_name":"Archive customer","customer_name_ar":"عميل الأرشيف"}',
        false,false,'2025-01-01','2025-01-02','2025-01-03','completed','ARCHIVE-B-'||n
      FROM generate_series(10001,${10000 + size}) n;
    INSERT INTO factory_rolls(production_order_id,sequence,roll_number,weight_kg,stage,film_machine_id,
      created_at,cutting_machine_id,cut_completed_at,net_weight_kg,waste_kg)
      SELECT n,s,'ARCHIVE-R-'||n||'-'||s,10,'done','F1','2025-01-01','C1','2025-01-02',9,1
      FROM generate_series(10001,${10000 + size}) n CROSS JOIN generate_series(1,3) s;
    INSERT INTO factory_receipts(voucher_number,created_at) SELECT 'ARCHIVE-V-'||n,'2025-01-03' FROM generate_series(10001,${10000 + size}) n;
    INSERT INTO factory_receipt_items(receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg)
      SELECT r.id,n,2,'BAG',1,CASE WHEN n<10071 THEN 26 ELSE 27 END FROM generate_series(10001,${10000 + size}) n
      JOIN factory_receipts r ON r.voucher_number='ARCHIVE-V-'||n;
    INSERT INTO factory_inventory(production_order_id,customer_product_id,item_id,location_id,quantity_kg)
      SELECT production_order_id,2,'BAG',1,quantity_kg FROM factory_receipt_items WHERE production_order_id>=10001;
    INSERT INTO factory_movements(receipt_id,receipt_item_id,quantity_kg,created_at)
      SELECT receipt_id,id,quantity_kg,'2025-01-03' FROM factory_receipt_items WHERE production_order_id>=10001;
    ANALYZE;
  `);
  await query(`
    INSERT INTO factory_rolls(production_order_id,sequence,roll_number,weight_kg,stage,film_machine_id)
      SELECT 4,n,'PAGED-ACTUALS-R-'||n,0.10,'done','F1' FROM generate_series(1000,1119) n;
    INSERT INTO factory_receipts(voucher_number) SELECT 'PAGED-ACTUALS-V-'||n FROM generate_series(1,60) n;
    INSERT INTO factory_receipt_items(receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg)
      SELECT r.id,4,e.customer_product_id,e.item_id,1,0.10 FROM factory_receipts r
      CROSS JOIN factory_execution e WHERE r.voucher_number LIKE 'PAGED-ACTUALS-V-%' AND e.production_order_id=4;
    INSERT INTO factory_movements(receipt_id,receipt_item_id,quantity_kg)
      SELECT ri.receipt_id,ri.id,ri.quantity_kg FROM factory_receipt_items ri JOIN factory_receipts r ON r.id=ri.receipt_id
      WHERE r.voucher_number LIKE 'PAGED-ACTUALS-V-%';
    UPDATE factory_inventory SET quantity_kg=quantity_kg+6 WHERE production_order_id=4 AND location_id=1;
    ANALYZE;
  `);
  const current = await read.state(actor);
  const pagedActuals = current.orders.find(order => order.id === 4)!;
  assert.equal(pagedActuals.roll_count, 121);
  assert.equal(pagedActuals.ready_kg, "22.00");
  assert.equal(pagedActuals.received_kg, "15.00");
  assert.equal(pagedActuals.remaining_kg, "7.00");
  assert.equal(pagedActuals.film_closed_at, null);
  const rollsPage = await read.history(actor, "rolls", { order_id: 4, limit: 50 });
  assert.equal(rollsPage.records.length, 50); assert.ok(rollsPage.next);
  const receiptsPage = await read.history(actor, "receipts", { order_id: 4, limit: 50 });
  assert.equal(receiptsPage.records.length, 50); assert.ok(receiptsPage.next);
  const actualsHistory = (await read.history(actor, "orders", { order_id: 4 })).records[0];
  assert.equal(actualsHistory.ready_kg, pagedActuals.ready_kg);
  assert.equal(actualsHistory.received_kg, pagedActuals.received_kg);
  assert.equal(current.orders.filter(order => order.id >= 10001).length, 70);
  assert.ok(current.orders.filter(order => order.id >= 10001).every(order => order.ready_kg === "27.00" && order.received_kg === "26.00" && order.remaining_kg === "1.00"));
  assert.equal(current.receipts.length, 0); assert.equal(current.movements.length, 0); assert.equal(current.inventory.length, 0);
  const hallState = await read.state({ id: 1, permissions: ["receive_production"] }, "hall");
  assert.equal(hallState.orders.filter(order => order.id >= 10001).length, 70);
  assert.equal(hallState.orders.find(order => order.id === 4)?.remaining_kg, "7.00");
  assert.equal(hallState.orders.filter(order => order.id >= 10001).reduce((sum, order) => sum + Number(order.remaining_kg), 0), 70);
  const first = await read.history(actor, "orders", { limit: 50 });
  assert.ok(first.next); assert.equal(first.records.length, 50);
  const second = await read.history(actor, "orders", { limit: 50, before: first.next! });
  assert.ok(second.records.every(order => order.id < first.next!));
  assert.equal(first.records.find(order => order.id === 10001), undefined);
  for (const kind of ["orders", "rolls", "receipts", "movements", "inventory"] as ProductionHistoryKind[]) {
    assert.equal((await read.history(actor, kind, { limit: 50 })).records.length, 50);
  }
  const totals = (await query(`SELECT (SELECT count(*)::int FROM production_orders) orders,
    (SELECT count(*)::int FROM factory_rolls) rolls,(SELECT count(*)::int FROM factory_receipts) receipts,
    (SELECT count(*)::int FROM factory_movements) movements,count(*)::int inventory,sum(quantity_kg)::text inventory_kg FROM factory_inventory`))[0];
  assert.deepEqual(current.totals, totals);
  // Representative previous unbounded snapshot, same projections/joins and
  // transaction isolation. Archive data and parameters are identical.
  const original = async () => {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const orders = (await tx.query(orderSelect.replace("FROM selected s JOIN production_orders p ON p.id=s.id", "FROM production_orders p"))).rows;
      const rolls = (await tx.query(`${rollSelect} ORDER BY r.id DESC`)).rows;
      const receipts = (await tx.query(`${receiptSelect} ORDER BY r.id DESC`)).rows;
      const inventory = (await tx.query(`${inventorySelect} ORDER BY inv.id DESC`)).rows;
      const movements = (await tx.query(`${movementSelect} ORDER BY m.id DESC`)).rows;
      await tx.query("COMMIT");
      return { orders, rolls, receipts, inventory, movements };
    } finally { tx.release(); }
  };
  const measure = async (name: string, action: () => Promise<unknown>, iterations = 3) => {
    const samples: { ms: number; bytes: number }[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now(), result = await action();
      const json = JSON.stringify(result);
      samples.push({ ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(json) });
    }
    const median = [...samples].sort((a, b) => a.ms - b.ms)[Math.floor(samples.length / 2)];
    console.log(JSON.stringify({ benchmark: name, median, samples }));
    return median;
  };
  const baseline = await measure("unbounded_archive_snapshot", original);
  const work = await measure("management_work_state", () => read.state(actor));
  assert.ok(work.bytes < baseline.bytes / 100);
  assert.ok(work.ms < baseline.ms);
  await measure("film_work_state", () => read.state(actor, "film"), 5);
  await measure("warehouse_summary", () => read.state(warehouse, "warehouse"), 5);
  await measure("history_orders_page", () => read.history(actor, "orders", {}), 5);
  await measure("history_receipts_page", () => read.history(warehouse, "receipts", {}), 5);
  await measure("history_rolls_page", () => read.history(actor, "rolls", {}), 5);
  await measure("history_order_search", () => read.history(actor, "orders", { search: "ARCHIVE-PO-10001" }), 5);
  console.log(`PASS isolated large archive: ${size} orders / ${size * 3} rolls / ${size} vouchers plus original lifecycle fixtures`);
}