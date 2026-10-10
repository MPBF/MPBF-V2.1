import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("Production monitoring migration is development-only.");
try {
  await pool.query(readFileSync("migrations/0018_production_monitoring.sql","utf8"));
  console.log("Applied prospective monitoring to development only; historical roll/mix boundary is immutable.");
} finally {
  await pool.end();
  await sessionPool.end();
}
