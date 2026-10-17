// Research only: invoked by the disposable fixture runner, never the app.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { ConnectionPool } from "../server/production/core";
import { ProductionReadService } from "../server/production/read";
import { ProductionReadPerformance, readPerformanceConfig } from "../server/production/read-performance";
import type { ProductionStateScope } from "../shared/production";

const candidates = ["baseline", "aggregate_first", "lateral_receipts", "memory_64mb"] as const;
type Candidate = typeof candidates[number];
const aggregateFirst = `WITH ready_rolls AS MATERIALIZED (
  SELECT production_order_id,sum(weight_kg) weight,sum(net_weight_kg) net
  FROM factory_rolls WHERE stage='done' GROUP BY production_order_id
), ready AS (
  SELECT r.production_order_id,CASE WHEN e.is_roll_product THEN r.weight ELSE r.net END quantity
  FROM ready_rolls r JOIN factory_execution e ON e.production_order_id=r.production_order_id
)`;

export function hallComparisonSQL(text: string, candidate: Candidate): string {
  if (candidate === "baseline" || candidate === "memory_64mb") return text;
  const marker = "), selected AS MATERIALIZED (";
  const end = text.indexOf(marker);
  assert.ok(text.startsWith("WITH ready AS (") && end > 0, "Hall SQL changed; update the diagnostic explicitly.");
  const suffix = text.slice(end + 1);
  if (candidate === "aggregate_first") return `${aggregateFirst}, received AS (
    SELECT production_order_id,sum(quantity_kg) quantity FROM factory_receipt_items GROUP BY production_order_id
  ), outstanding AS (
    SELECT ready.production_order_id id FROM ready LEFT JOIN received USING(production_order_id)
    WHERE ready.quantity>COALESCE(received.quantity,0)
  )${suffix}`;
  return `${aggregateFirst}, outstanding AS (
    SELECT ready.production_order_id id FROM ready
    LEFT JOIN LATERAL (SELECT sum(quantity_kg) quantity FROM factory_receipt_items
      WHERE production_order_id=ready.production_order_id) received ON true
    WHERE ready.quantity>COALESCE(received.quantity,0)
  )${suffix}`;
}

export async function productionHallComparison(pool: ConnectionPool, archiveSize: number) {
  // Defense in depth: no arbitrary connection string, schema or SQL from CLI.
  assert.ok(process.argv.includes("--local") && process.argv.includes("--large"));
  const guard = await pool.connect();
  try {
    const { rows: [identity] } = await guard.query(`SELECT current_database() db,
      host(inet_server_addr()) host,inet_server_port() port,current_schema() schema,
      current_setting('work_mem') work_mem,version() version`);
    assert.equal(identity.db, "factory_isolated_test");
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, 55439);
    assert.match(identity.schema, /^factory_test_[a-f0-9]{32}$/);
    console.log(JSON.stringify({ diagnostic: "hall_comparison_environment", archiveSize, ...identity }));
  } finally { guard.release(); }
  const disabled = new ProductionReadPerformance({ ...readPerformanceConfig({}), enabled: false });
  const actor = { id: 1, permissions: ["admin"] };
  const baseline = new ProductionReadService(pool, disabled);
  for (const scope of ["management", "hall"] as const) {
    const expected = await baseline.state(actor, scope);
    const services = new Map<Candidate, ProductionReadService>();
    const samples = new Map<Candidate, number[]>();
    for (const candidate of candidates) {
      services.set(candidate, new ProductionReadService(comparisonPool(pool, candidate), disabled));
      samples.set(candidate, []);
      // Warm up equally; assert the ENTIRE payload (including all-source totals,
      // decimal strings, film durations and old outstanding orders), not just IDs.
      assert.deepEqual(await services.get(candidate)!.state(actor, scope), expected);
    }
    // Rotate order between rounds to reduce fixed-order cache/CPU bias.
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[(round + i) % candidates.length];
        const start = performance.now();
        const result = await services.get(candidate)!.state(actor, scope);
        const json = JSON.stringify(result);
        samples.get(candidate)!.push(Number((performance.now() - start).toFixed(2)));
        assert.deepEqual(result, expected);
        assert.equal(Buffer.byteLength(json), Buffer.byteLength(JSON.stringify(expected)));
      }
    }
    for (const candidate of candidates) {
      const ms = samples.get(candidate)!;
      console.log(JSON.stringify({ diagnostic: "hall_comparison", archiveSize, scope, candidate,
        median_ms: [...ms].sort((a, b) => a - b)[2], samples_ms: ms,
        bytes: Buffer.byteLength(JSON.stringify(expected)), orders: expected.orders.length,
        equality: "full_payload" }));
      await new ProductionReadService(comparisonPool(pool, candidate, { scope, archiveSize }), disabled).state(actor, scope);
      await verifyConcurrentSnapshot(pool, candidate, scope, expected);
    }
  }
}

async function verifyConcurrentSnapshot(pool: ConnectionPool, candidate: Candidate,
  scope: "management" | "hall", expected: Awaited<ReturnType<ProductionReadService["state"]>>) {
  const writer = await pool.connect();
  let changed = false;
  try {
    const { rows: [item] } = await writer.query(`SELECT ri.id,ri.production_order_id
      FROM factory_receipt_items ri JOIN production_orders p ON p.id=ri.production_order_id
      WHERE p.production_order_number LIKE 'ARCHIVE-PO-%'
      ORDER BY p.id LIMIT 1`);
    assert.ok(item);
    const wrapped = comparisonPool(pool, candidate);
    const concurrent: ConnectionPool = { async connect() {
      const tx = await wrapped.connect();
      return { release: () => tx.release(), async query(text, values) {
        const result = await tx.query(text, values);
        if (text.startsWith("WITH ready AS (")) {
          // Commit a receipt/balance change BETWEEN order selection and totals.
          // Only the guarded disposable database is reachable here.
          await writer.query("BEGIN");
          try {
            await writer.query("UPDATE factory_receipt_items SET quantity_kg=quantity_kg+0.01 WHERE id=$1", [item.id]);
            await writer.query("UPDATE factory_inventory SET quantity_kg=quantity_kg+0.01 WHERE production_order_id=$1", [item.production_order_id]);
            await writer.query("COMMIT");
            changed = true;
          } catch (error) { await writer.query("ROLLBACK"); throw error; }
        }
        return result;
      } };
    } };
    const read = new ProductionReadService(concurrent,
      new ProductionReadPerformance({ ...readPerformanceConfig({}), enabled: false }));
    assert.deepEqual(await read.state({ id: 1, permissions: ["admin"] }, scope), expected);
    console.log(JSON.stringify({ diagnostic: "hall_snapshot_consistency", candidate, scope, passed: true }));
  } finally {
    if (changed) {
      await writer.query("BEGIN");
      try {
        await writer.query(`UPDATE factory_receipt_items SET quantity_kg=quantity_kg-0.01
          WHERE id=(SELECT ri.id FROM factory_receipt_items ri JOIN production_orders p ON p.id=ri.production_order_id
            WHERE p.production_order_number LIKE 'ARCHIVE-PO-%' ORDER BY p.id LIMIT 1)`);
        await writer.query(`UPDATE factory_inventory SET quantity_kg=quantity_kg-0.01
          WHERE production_order_id=(SELECT id FROM production_orders
            WHERE production_order_number LIKE 'ARCHIVE-PO-%' ORDER BY id LIMIT 1)`);
        await writer.query("COMMIT");
      } catch (error) { await writer.query("ROLLBACK"); throw error; }
    }
    writer.release();
  }
}

function comparisonPool(pool: ConnectionPool, candidate: Candidate,
  explain?: { scope: ProductionStateScope; archiveSize: number }): ConnectionPool {
  return { async connect() {
    const tx = await pool.connect();
    return { release: () => tx.release(), async query(text, values) {
      if (text === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") {
        const result = await tx.query(text, values);
        await tx.query("SET LOCAL statement_timeout = '30s'");
        if (candidate === "memory_64mb") await tx.query("SET LOCAL work_mem = '64MB'");
        const { rows: [settings] } = await tx.query(`SELECT current_setting('transaction_isolation') isolation,
          current_setting('transaction_read_only') readonly`);
        assert.deepEqual(settings, { isolation: "repeatable read", readonly: "on" });
        return result;
      }
      if (!text.startsWith("WITH ready AS (")) return tx.query(text, values);
      const sql = hallComparisonSQL(text, candidate);
      if (explain) {
        const { rows } = await tx.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
        const plan = rows[0]["QUERY PLAN"][0];
        const nodes: object[] = [];
        const walk = (n: any) => {
          nodes.push({ type: n["Node Type"], relation: n["Relation Name"], rows: n["Actual Rows"],
            loops: n["Actual Loops"], removed: n["Rows Removed by Filter"],
            shared_hits: n["Shared Hit Blocks"], shared_reads: n["Shared Read Blocks"],
            temp_read: n["Temp Read Blocks"], temp_written: n["Temp Written Blocks"] });
          for (const child of n.Plans ?? []) walk(child);
        };
        walk(plan.Plan);
        console.log(JSON.stringify({ diagnostic: "hall_comparison_plan", ...explain, candidate,
          planning_ms: plan["Planning Time"], execution_ms: plan["Execution Time"], nodes }));
      }
      return tx.query(sql, values);
    } };
  } };
}
