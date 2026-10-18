import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This migration runner is development-only.");
try {
  await pool.query(readFileSync("migrations/0023_mix_corrections.sql", "utf8"));
  console.log("Applied additive mix correction/audit schema to development. Existing balances unchanged.");
} finally {
  await pool.end();
  await sessionPool.end();
}
