import { sql, type SQL } from "drizzle-orm";

type Transaction = { execute: (query: SQL) => Promise<unknown> };

/** Queue writers take their stage lock before locking the parent order. */
export async function lockOrderProductionDeletion(tx: Transaction) {
  for (const stage of ["film", "printing", "cutting"]) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`factory-queue:${stage}`},0))`);
  }
}

/** Called inside the parent deletion transaction, after locking the order. */
export async function deleteOrderProduction(tx: Transaction, orderId: number) {
  const ids = sql`SELECT id FROM production_orders WHERE order_id=${orderId}`;
  await tx.execute(sql`SELECT id FROM production_orders WHERE order_id=${orderId} ORDER BY id FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM factory_receipts WHERE id IN (
    SELECT receipt_id FROM factory_receipt_items WHERE production_order_id IN (${ids})
  ) ORDER BY id FOR UPDATE`);
  await tx.execute(sql`DELETE FROM factory_movements WHERE receipt_item_id IN (
    SELECT id FROM factory_receipt_items WHERE production_order_id IN (${ids})
  )`);
  await tx.execute(sql`DELETE FROM factory_inventory WHERE production_order_id IN (${ids})`);
  // CTE reads share a snapshot: explicitly exclude the lines being deleted
  // when checking whether a voucher still contains another order's items.
  await tx.execute(sql`WITH removed AS (
    DELETE FROM factory_receipt_items WHERE production_order_id IN (${ids}) RETURNING receipt_id
  ) DELETE FROM factory_receipts r WHERE r.id IN (SELECT receipt_id FROM removed)
    AND NOT EXISTS (SELECT 1 FROM factory_receipt_items ri WHERE ri.receipt_id=r.id
      AND ri.production_order_id NOT IN (${ids}))`);
  await tx.execute(sql`DELETE FROM factory_rolls WHERE production_order_id IN (${ids})`);
  await tx.execute(sql`DELETE FROM factory_queues WHERE production_order_id IN (${ids})`);
  await tx.execute(sql`DELETE FROM factory_execution WHERE production_order_id IN (${ids})`);
  await tx.execute(sql`DELETE FROM production_orders WHERE order_id=${orderId}`);
}
