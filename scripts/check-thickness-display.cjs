// Isolated PostgreSQL fixture only; never imports the application's DB or reads its credentials.
// Pass the Unix socket directory created for this check, not a connection string.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { Client } = require("pg");

(async () => {
  const host = process.argv[2];
  assert.ok(host?.startsWith("/tmp/raw-thickness."), "An isolated raw-thickness fixture socket is required");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "thickness-contract-"));
  const bundle = path.join(directory, "contract.cjs");
  const client = new Client({ host, port: 55439, user: "fixture", database: "postgres", password: "", ssl: false });
  let checks = 0;
  const check = (label, actual, expected) => {
    assert.deepEqual(actual, expected, label);
    console.log(`PASS ${label}`);
    checks++;
  };
  try {
    await esbuild.build({
      stdin: {
        contents: `import { customer_products } from "./shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";
export { snapshotWithDisplayThickness } from "./server/production/read-queries";
export const generatedSql = new PgDialect().sqlToQuery(customer_products.universal_thickness.generated.as).sql;`,
        resolveDir: process.cwd(), loader: "ts",
      },
      outfile: bundle, bundle: true, platform: "node", format: "cjs",
    });
    const { snapshotWithDisplayThickness, generatedSql } = require(bundle);
    await client.connect();
    const snapshot = { width: "28", left_facing: "7", right_facing: "7", universal_thickness: "35", name: "Frozen item" };
    const current = { id: 1, width: 28, left_facing: 7, right_facing: 7, universal_thickness: 35, thickness: 14 };
    const project = async (saved, live = current) => (await client.query(`
      SELECT ${snapshotWithDisplayThickness} product FROM (SELECT $1::jsonb product) e
      CROSS JOIN jsonb_to_record($2::jsonb) AS cp(id integer,width numeric,left_facing numeric,
        right_facing numeric,thickness numeric,universal_thickness numeric)`,
    [JSON.stringify(saved), JSON.stringify(live)])).rows[0].product;
    check("matching old snapshot gains raw thickness without rewriting frozen values",
      await project(snapshot), { ...snapshot, thickness: "14" });
    check("a captured raw thickness is never replaced by current product data",
      await project({ ...snapshot, thickness: "12" }), { ...snapshot, thickness: "12" });
    check("a deliberately captured null is preserved",
      await project({ ...snapshot, thickness: null }), { ...snapshot, thickness: null });
    for (const [field, changed] of [["width", 30], ["left_facing", 0], ["right_facing", 0], ["universal_thickness", 99]]) {
      check(`changed ${field} cannot fabricate historical raw thickness`,
        await project(snapshot, { ...current, [field]: changed }), { ...snapshot, thickness: null });
    }
    check("deleted products leave frozen metadata untouched", await project(snapshot, { ...current, id: null }), snapshot);
    const numericSnapshot = { ...snapshot, width: 28, left_facing: 7, right_facing: 7, universal_thickness: 35 };
    check("legacy numeric JSON snapshots are supported", await project(numericSnapshot), { ...numericSnapshot, thickness: "14" });

    // Use the actual generated expression compiled from the application's schema.
    await client.query(`CREATE TEMP TABLE generated_thickness_fixture (
      thickness numeric,left_facing numeric,right_facing numeric,
      universal_thickness numeric GENERATED ALWAYS AS (${generatedSql}) STORED)`);
    const insert = async (thickness, left, right) => (await client.query(
      "INSERT INTO generated_thickness_fixture(thickness,left_facing,right_facing) VALUES($1,$2,$3) RETURNING universal_thickness::text value",
      [thickness, left, right])).rows[0].value;
    check("new flat products automatically store universal thickness", await insert(20, 0, 0), "100");
    check("new gusseted products automatically store universal thickness", await insert(14, 7, 7), "35");
    check("automatic generation retains rounding upward", await insert(35, 7, 7), "88");
    const updated = await client.query("UPDATE generated_thickness_fixture SET thickness=22 WHERE thickness=20 RETURNING universal_thickness::text value");
    check("editing raw thickness recalculates the stored universal thickness", updated.rows[0].value, "110");
    await assert.rejects(() => client.query("INSERT INTO generated_thickness_fixture(thickness,universal_thickness) VALUES(10,999)"),
      error => error.code === "428C9");
    console.log(`Thickness contracts passed: ${checks} checks plus generated-column write protection; only isolated temporary fixtures were used.`);
  } finally {
    await client.end().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
