import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This migration runner is development-only.");
try {
  await pool.query(readFileSync("migrations/0014_raw_material_mixing.sql", "utf8"));
  console.log("Applied additive raw-material mixing tables to development; historical balances unchanged.");
} finally {
  await pool.end();
  await sessionPool.end();
}
