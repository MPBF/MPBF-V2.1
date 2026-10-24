import assert from "node:assert/strict";
import type { ConnectionPool } from "../server/production/core";
import { historyPage } from "../server/production/history";
import type { ProductionHistoryFilter } from "../shared/production";
import { searchExperimentSQL } from "./production-search-experiments";

// Synthetic contract fixtures live in one rolled-back transaction. No customer
// records, query values, result payloads or assertion diffs are logged.
export async function verifyProductionSearch(pool: ConnectionPool) {
  const tx = await pool.connect();
  let begun = false;
  try {
    const guard = (await tx.query("SELECT current_database() db, host(inet_server_addr()) host")).rows[0];
    assert.equal(guard.db, "factory_isolated_test");
    assert.equal(guard.host, "127.0.0.1");
    await tx.query("BEGIN");
    begun = true;
    const base = Number((await tx.query("SELECT COALESCE(max(id),0)::int n FROM orders")).rows[0].n);
    const location = (await tx.query("SELECT id FROM factory_locations ORDER BY id LIMIT 1")).rows[0].id;
    for (let n = 1; n <= 4; n++) {
      await tx.query("INSERT INTO orders VALUES($1,$2,'C1','completed',NULL)", [base + n, `SEARCH-ORDER-${n}`]);
      await tx.query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,
        quantity_kg,final_quantity_kg,status,batch_number) VALUES($1,$1,$2,2,30,30,'completed',$3)`,
      [base + n, `SEARCH-PO-${n}`, `SEARCH-BATCH-${n}`]);
      if (n === 4) continue; // live-name fallback without execution
      const product = n === 1
        ? { name: "Needle%_\\ English", name_ar: "عينة%_\\ عربية", customer_name: "Frozen English", customer_name_ar: "عميل محفوظ" }
        : n === 2
          ? { name: "NeedleXXY English", name_ar: "عينةXXY عربية", customer_name: "Frozen English", customer_name_ar: "عميل محفوظ" }
          : { name: null, name_ar: null, customer_name: null, customer_name_ar: null };
      await tx.query(`INSERT INTO factory_execution(production_order_id,customer_product_id,item_id,product,
        is_printed,is_roll_product,started_at,film_closed_at,completed_at,stage)
        VALUES($1,2,'BAG',$2,false,false,'2025-01-01','2025-01-02','2025-01-03','completed')`,
      [base + n, JSON.stringify(product)]);
    }
    const vouchers: number[] = [];
    for (let n = 1; n <= 4; n++) {
      const id = (await tx.query("INSERT INTO factory_receipts(voucher_number,notes,created_at) VALUES($1,$2,'2025-01-03') RETURNING id",
        [`SEARCH-V-${n}`, n === 1 ? "Notes%_\\ عربية" : null])).rows[0].id;
      vouchers.push(id);
      for (const order of n === 4 ? [] : n === 2 ? [3] : [1, 2]) {
        await tx.query(`INSERT INTO factory_receipt_items(receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg)
          VALUES($1,$2,2,'BAG',$3,1.25)`, [id, base + order, location]);
      }
    }
    const searches = ["%", "_", "\\", "%_", "Needle", "needle", "عينة", "عربية", "Frozen English", "عميل محفوظ",
      "Fixture customer", "عميل الاختبار", "SEARCH-PO-1", "SEARCH-ORDER-1", "SEARCH-BATCH-1", "SEARCH-V-4",
      "Notes", "BAG", "2", "%' OR true --", "SyntheticAbsentToken"];
    for (const variant of ["current", "split_or", "correlated_receipts"] as const) {
      const connection = { release() {}, query: (text: string, values?: any[]) =>
        tx.query(searchExperimentSQL(text, variant), values) };
      for (const kind of ["orders", "receipts"] as const) {
        for (const search of searches) {
          // Full results and multiple tiny cursor pages must be identical.
          const full = await historyPage(tx, kind, { search, limit: 100 });
          assert.deepEqual(await historyPage(connection, kind, { search, limit: 100 }), full);
          let before: number | undefined;
          const ids: number[] = [];
          do {
            const filter = { search, limit: 1, before };
            const expected = await historyPage(tx, kind, filter);
            const actual = await historyPage(connection, kind, filter);
            assert.deepEqual(actual, expected);
            ids.push(...actual.records.map(record => record.id));
            before = actual.next ?? undefined;
          } while (before);
          assert.deepEqual(ids, full.records.map(record => record.id));
          assert.equal(new Set(ids).size, ids.length);
        }
      }
      for (const search of ["%", "_", "\\", "%_"]) {
        const orders = await historyPage(connection, "orders", { search });
        assert.deepEqual(orders.records.map(order => order.id), [base + 1]);
        const receipts = await historyPage(connection, "receipts", { search });
        assert.deepEqual(receipts.records.map(receipt => receipt.id), [vouchers[2], vouchers[0]]);
        assert.ok(receipts.records.every(receipt => receipt.items.length === 2));
        assert.ok(receipts.records.every(receipt => receipt.items.every(item => item.quantity_kg === "1.25")));
      }
      const filters: ProductionHistoryFilter[] = [
        { search: "Needle", order_id: base + 1, location_id: location, limit: 1 },
        { search: "Needle", from: "2025-01-03", to: "2025-01-03", limit: 1 },
        { search: "Needle", to: "1900-01-01", limit: 1 },
      ];
      for (const filter of filters) {
        assert.deepEqual(await historyPage(connection, "receipts", filter), await historyPage(tx, "receipts", filter));
      }
      for (const filter of [{ search: "Needle", status: "completed", limit: 1 },
        { search: "Needle", order_id: base + 1, from: "2025-01-01", to: "2025-01-01" },
        { search: "Fixture customer", status: "completed" }]) {
        assert.deepEqual(await historyPage(connection, "orders", filter), await historyPage(tx, "orders", filter));
      }
    }
    console.log("PASS local search alternatives: Arabic/English, literal wildcards/backslash, frozen/live names, whole vouchers, decimals, filters and cursor parity");
  } finally {
    try { if (begun) await tx.query("ROLLBACK"); }
    finally { tx.release(); }
  }
}
