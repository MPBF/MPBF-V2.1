import { readFileSync } from "node:fs";
import { pool, sessionPool } from "../server/db";

if (process.env.NODE_ENV === "production") throw new Error("This migration runner is development-only.");
try {
  await pool.query(readFileSync("migrations/0022_leave_dates.sql", "utf8"));
  console.log("Applied nullable leave-date columns and their integrity check to development only; existing request values preserved.");
} finally {
  await pool.end();
  await sessionPool.end();
}
