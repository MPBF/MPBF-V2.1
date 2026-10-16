// Explicit, reviewed development setup only. Never run this on app startup.
import { readFileSync } from "node:fs";

async function main() {
  if (!process.argv.includes("--development") || process.env.NODE_ENV === "production") {
    console.error("Development setup requires --development and a non-production environment.");
    process.exitCode = 1; return;
  }
  const { pool, sessionPool } = await import("../server/db");
  try {
    const q = await pool.connect();
    try {
      // The migration creates only the four technical tables and their indexes.
      // It contains BEGIN/COMMIT and never deletes or changes business rows.
      await q.query(readFileSync(new URL("../migrations/0020_data_transfer.sql", import.meta.url), "utf8"));
      const { rows } = await q.query(`SELECT bool_and(to_regclass(name) IS NOT NULL) AS ready
        FROM unnest(ARRAY['public.data_transfer_operations','public.data_transfer_previews',
          'public.data_transfer_backups','public.data_transfer_templates']) AS name`);
      if (!rows[0]?.ready) throw Error("SETUP_INCOMPLETE");
      console.log("Development data-tool tables are ready. Existing business data was not modified.");
    } catch {
      await q.query("ROLLBACK").catch(() => {});
      throw Error("SETUP_FAILED");
    } finally { q.release(); }
  } catch {
    console.error("Data-tool setup failed. No database credentials or row values are logged.");
    process.exitCode = 1;
  } finally { await pool.end(); await sessionPool.end(); }
}
void main();
