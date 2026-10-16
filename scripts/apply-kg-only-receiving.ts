import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("KG-only migration is development-only.");
const summary = async () => (await pool.query(`
  SELECT
    md5(current_database()||COALESCE(inet_server_addr()::text,'local')) AS database_fingerprint,
    (SELECT count(*)::text FROM factory_receipts) AS receipts,
    (SELECT count(*)::text FROM factory_receipt_items) AS receipt_lines,
    (SELECT COALESCE(sum(quantity_kg),0)::text FROM factory_receipt_items) AS received_kg,
    (SELECT COALESCE(sum(quantity_kg),0)::text FROM factory_inventory) AS inventory_kg,
    (SELECT COALESCE(sum(quantity_kg),0)::text FROM factory_movements) AS moved_kg,
    to_regclass('factory_inventory_units') IS NOT NULL AS unit_table_exists,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='factory_receipt_items'
      AND column_name IN ('packing','packaging')) AS unit_columns
`)).rows[0];
try {
  const before = await summary();
  if (process.argv.includes("--inspect")) console.log(JSON.stringify(before));
  else {
    await pool.query(readFileSync("migrations/0019_finished_receipts_kg_only.sql", "utf8"));
    const after = await summary();
    for (const key of ["database_fingerprint", "receipts", "receipt_lines", "received_kg", "inventory_kg", "moved_kg"])
      if (before[key] !== after[key]) throw new Error(`Preserved warehouse invariant changed: ${key}`);
    if (after.unit_table_exists || after.unit_columns) throw new Error("Unit data was not fully retired.");
    console.log(JSON.stringify({before, after, result:"Development migration complete; ledger quantities preserved."}));
  }
} finally {
  await pool.end();
  await sessionPool.end();
}
