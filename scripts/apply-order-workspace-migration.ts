import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This script is development-only.");
try {
  await pool.query(readFileSync("migrations/0012_order_display_folders.sql", "utf8"));
  console.log("Applied the additive development order-folder migration.");
} finally {
  await pool.end();
  await sessionPool.end();
}