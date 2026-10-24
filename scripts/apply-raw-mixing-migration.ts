import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This migration runner is development-only.");
try {
  await pool.query(readFileSync("migrations/0014_raw_material_mixing.sql", "utf8"));
  await pool.query(readFileSync("migrations/0015_raw_catalogue_movements.sql", "utf8"));
  await pool.query(readFileSync("migrations/0017_raw_mixing_screws.sql", "utf8"));
  console.log("Applied additive raw catalogue/mixing/movement tables to development; historical balances unchanged.");
} finally {
  await pool.end();
  await sessionPool.end();
}
