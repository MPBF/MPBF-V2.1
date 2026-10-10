import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This migration runner is development-only.");
try {
  await pool.query(readFileSync("migrations/0016_finished_inventory_units.sql", "utf8"));
  console.log("Applied additive finished-inventory units migration to development; historical balances unchanged.");
} finally {
  await pool.end();
  await sessionPool.end();
}
