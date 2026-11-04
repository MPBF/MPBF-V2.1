// Run with node --test tests/hr-correction-overlap.test.cjs.
// Exercises the actual Drizzle predicate against a disposable PostgreSQL,
// never the application's database or attendance records.
require("tsx/cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Client } = require("pg");
const { PgDialect } = require("drizzle-orm/pg-core");
const { correctionSessionOverlap } = require("../server/hr-correction-overlap.ts");

test("correction overlap respects finite open-session windows without changing history", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hr-overlap-"));
  const data = join(root, "data");
  const socket = join(root, "socket");
  mkdirSync(socket);
  let started = false;
  let client;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-w", "start",
      "-o", `-k ${socket} -h '' -p 5432`], { stdio: "pipe" });
    started = true;
    client = new Client({ host: socket, port: 5432, database: "postgres", user: process.env.USER || "runner" });
    await client.connect();
    // Only a CTE is needed; there are no fixture writes, even in this isolated DB.
    const evaluate = async ({ start = "2026-10-30T04:00:00Z", end = "2026-10-30T12:00:00Z",
      open = "2026-10-30T05:00:00Z", close = null, shift = "2026-10-30T04:00:00Z",
      owner = 1, exclude = undefined } = {}) => {
      const predicate = new PgDialect().sqlToQuery(correctionSessionOverlap(1, new Date(start), new Date(end), exclude));
      const offset = predicate.params.length;
      const result = await client.query(`
        WITH attendance_sessions(id, user_id, check_in_at, check_out_at, shift_start_at) AS (
          VALUES (99, $${offset + 1}::integer, $${offset + 2}::timestamptz,
            $${offset + 3}::timestamptz, $${offset + 4}::timestamptz)
        )
        SELECT EXISTS(SELECT 1 FROM attendance_sessions WHERE ${predicate.sql}) AS overlaps
      `, [...predicate.params, owner, open, close, shift]);
      return result.rows[0].overlaps;
    };
    const cases = [
      ["old unclosed September shift does not block October 30", {
        open: "2026-09-29T11:55:20.234Z", shift: "2026-09-29T04:00:00Z",
      }, false],
      ["second old unclosed shift also expires", {
        open: "2026-09-30T06:46:36.967Z", shift: "2026-09-30T04:00:00Z",
      }, false],
      ["open shift within its correction window blocks an overlapping earlier check-in", {}, true],
      ["open shift starting inside the correction interval blocks it", {
        open: "2026-10-30T09:00:00Z",
      }, true],
      ["overnight open shift blocks overlapping next-day correction", {
        open: "2026-10-29T17:00:00Z", shift: "2026-10-29T17:00:00Z",
      }, true],
      ["exact 24-hour boundary is adjacent, not overlapping", {
        open: "2026-10-29T04:00:00Z", shift: "2026-10-29T04:00:00Z",
      }, false],
      ["completed shift uses real checkout even beyond its nominal window", {
        open: "2026-10-28T04:00:00Z", shift: "2026-10-28T04:00:00Z",
        close: "2026-10-30T08:00:00Z",
      }, true],
      ["completed shift ending exactly at corrected check-in is adjacent", {
        open: "2026-10-29T04:00:00Z", shift: "2026-10-29T04:00:00Z",
        close: "2026-10-30T04:00:00Z",
      }, false],
      ["shift starting exactly at corrected checkout is adjacent", {
        open: "2026-10-30T12:00:00Z",
      }, false],
      ["another employee never conflicts", { owner: 2 }, false],
      ["existing record excludes itself", { exclude: 99 }, false],
      ["another record still conflicts when self is excluded", { exclude: 100 }, true],
    ];
    for (const [name, options, expected] of cases) {
      await t.test(name, async () => assert.equal(await evaluate(options), expected));
    }
  } finally {
    if (client) await client.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-w", "stop", "-m", "immediate"], { stdio: "pipe" });
    rmSync(root, { recursive: true, force: true });
  }
});
