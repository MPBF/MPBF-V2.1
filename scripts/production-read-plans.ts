import type { ConnectionPool } from "../server/production/core";
import { ProductionReadService } from "../server/production/read";
import { ProductionReadPerformance, readPerformanceConfig } from "../server/production/read-performance";

// Invoke ONLY with the disposable local fixture pool. No SQL, predicates,
// parameters, customer data or search text is included in diagnostic output.
export async function productionReadPlans(pool: ConnectionPool, selectiveSearch: string) {
  let scenario = "";
  let queryNumber = 0;
  const diagnosticPool: ConnectionPool = {
    async connect() {
      const tx = await pool.connect();
      return {
        release: () => tx.release(),
        async query(text, values) {
          if (!/^\s*(WITH|SELECT)\b/i.test(text)) return tx.query(text, values);
          await tx.query("SET LOCAL statement_timeout = '30s'");
          const result = await tx.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, values);
          const plan = result.rows[0]["QUERY PLAN"][0];
          const nodes: object[] = [];
          const walk = (node: any) => {
            nodes.push({ type: node["Node Type"], relation: node["Relation Name"],
              actual_rows: node["Actual Rows"], loops: node["Actual Loops"],
              rows_removed: node["Rows Removed by Filter"], total_ms: node["Actual Total Time"],
              shared_hit_blocks: node["Shared Hit Blocks"], shared_read_blocks: node["Shared Read Blocks"],
              temp_read_blocks: node["Temp Read Blocks"], temp_written_blocks: node["Temp Written Blocks"] });
            for (const child of node.Plans ?? []) walk(child);
          };
          walk(plan.Plan);
          console.log(JSON.stringify({ diagnostic: "production_read_plan", scenario, query: ++queryNumber,
            planning_ms: plan["Planning Time"], execution_ms: plan["Execution Time"], nodes }));
          return tx.query(text, values);
        },
      };
    },
  };
  const read = new ProductionReadService(diagnosticPool,
    new ProductionReadPerformance({ ...readPerformanceConfig({}), enabled: false }));
  const actor = { id: 1, permissions: ["admin"] };
  for (const [name, run] of [
    ["management", () => read.state(actor)],
    ["hall", () => read.state(actor, "hall")],
    ["warehouse", () => read.state(actor, "warehouse")],
    ["orders_page", () => read.history(actor, "orders", {})],
    ["orders_selective_search", () => read.history(actor, "orders", { search: selectiveSearch })],
    ["orders_broad_search", () => read.history(actor, "orders", { search: "Archive" })],
    ["receipts_broad_search", () => read.history(actor, "receipts", { search: "Archive" })],
  ] as const) {
    scenario = name; queryNumber = 0;
    await run();
  }
}
