import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") {
  throw new Error("This migration runner is development-only.");
}

const client = await pool.connect();
try {
  // Use one connection for the migration's existing BEGIN/COMMIT boundary.
  await client.query(readFileSync("migrations/0021_finished_deliveries.sql", "utf8"));
  const { rows } = await client.query<{ name: string; relation: string | null }>(`
    SELECT name, to_regclass(name)::text AS relation
    FROM unnest(ARRAY[
      'factory_deliveries', 'factory_delivery_items', 'factory_delivery_movements'
    ]) AS name
  `);
  if (rows.some(row => !row.relation)) {
    throw new Error("Finished delivery tables are missing after the development migration.");
  }
  console.log("Verified finished delivery tables in development; existing records preserved.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
  await sessionPool.end();
}
