// Local SQL prototypes only. These are deliberately not imported by the server.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { ConnectionPool } from "../server/production/core";
import { ProductionReadService } from "../server/production/read";
import { ProductionReadPerformance, readPerformanceConfig } from "../server/production/read-performance";
import type { ProductionHistoryFilter, ProductionHistoryKind } from "../shared/production";
import { productionReadPlans } from "./production-read-plans";

export type SearchVariant = "current" | "split_or" | "correlated_receipts";

// Parse only our internally generated SQL, not SQL supplied by a user.
// Preserve the other predicates, bound values, final projection and ID cursor.
export function searchExperimentSQL(text: string, variant: SearchVariant): string {
  if (variant === "current" || !text.startsWith("WITH selected AS MATERIALIZED")) return text;
  if (variant === "correlated_receipts") {
    // OFFSET 0 keeps the line subquery correlated instead of hashing all
    // matching receipt IDs. It is a planner experiment, not a row limit.
    return text.replace(/(OR ri\.customer_product_id::text ILIKE \$\d+\))\)\)/, "$1 OFFSET 0))");
  }
  const start = text.indexOf("(p.production_order_number ILIKE");
  const receiptStart = text.indexOf("(r.voucher_number ILIKE");
  const at = receiptStart >= 0 ? receiptStart : start;
  if (at < 0) return text;
  let depth = 0, end = at, branchStart = at + 1;
  const branches: string[] = [];
  for (; end < text.length; end++) {
    if (text[end] === "(") depth++;
    // Closing parentheses and ORs at the outer search-expression level only.
    if (text[end] === ")") {
      depth--;
      if (depth === 0) { branches.push(text.slice(branchStart, end)); break; }
    }
    const separator = depth === 1 ? text.slice(end).match(/^\s+OR\s+/)?.[0] : undefined;
    if (separator) {
      branches.push(text.slice(branchStart, end));
      branchStart = end + separator.length;
      end = branchStart - 1;
    }
  }
  if (depth !== 0) throw Error("Unbalanced generated search expression");
  const prefix = "WITH selected AS MATERIALIZED (\n";
  const tailAt = text.indexOf("\n  ) ", end);
  if (tailAt < 0) throw Error("Missing generated page boundary");
  const query = text.slice(prefix.length, tailAt);
  const searchAt = at - prefix.length;
  const searchEnd = end + 1 - prefix.length;
  const pages = branches.map(branch => `(${query.slice(0, searchAt)}(${branch})${query.slice(searchEnd)})`);
  const limit = query.match(/LIMIT (\$\d+)$/)?.[1];
  if (!limit) throw Error("Missing bound limit");
  return `${prefix}SELECT id FROM (${pages.join(" UNION ")}) candidates ORDER BY id DESC LIMIT ${limit}${text.slice(tailAt)}`;
}

export function searchScenarios(selectiveSearch: string) {
  return [
    { name: "orders_selective_search", kind: "orders", filter: { search: selectiveSearch } },
    { name: "orders_broad_search", kind: "orders", filter: { search: "Archive" } },
    { name: "orders_arabic_search", kind: "orders", filter: { search: "الأرشيف" } },
    { name: "orders_missing_search", kind: "orders", filter: { search: "SyntheticAbsentToken" } },
    { name: "receipts_selective_search", kind: "receipts", filter: { search: selectiveSearch } },
    { name: "receipts_header_search", kind: "receipts", filter: { search: selectiveSearch.replace("-PO-", "-V-") } },
    { name: "receipts_broad_search", kind: "receipts", filter: { search: "Archive" } },
    { name: "receipts_arabic_search", kind: "receipts", filter: { search: "الأرشيف" } },
    { name: "receipts_missing_search", kind: "receipts", filter: { search: "SyntheticAbsentToken" } },
  ] satisfies { name: string; kind: ProductionHistoryKind; filter: ProductionHistoryFilter }[];
}

export function experimentalSearchPool(pool: ConnectionPool, variant: SearchVariant): ConnectionPool {
  return { async connect() {
    const tx = await pool.connect();
    return { release: () => tx.release(), query: (text, values) => tx.query(searchExperimentSQL(text, variant), values) };
  } };
}

export async function compareProductionSearch(pool: ConnectionPool, selectiveSearch: string) {
  const guard = await pool.connect();
  try {
    const { rows } = await guard.query("SELECT current_database() db, host(inet_server_addr()) host");
    assert.equal(rows[0].db, "factory_isolated_test", "Search experiments require the disposable fixture database");
    assert.equal(rows[0].host, "127.0.0.1", "Search experiments require local loopback");
  } finally { guard.release(); }
  const actor = { id: 1, permissions: ["admin"] };
  const quiet = () => new ProductionReadPerformance({ ...readPerformanceConfig({}), enabled: false });
  const baseline = new ProductionReadService(pool, quiet());
  for (const variant of ["current", "split_or", "correlated_receipts"] as const) {
    const experimental = experimentalSearchPool(pool, variant);
    const read = new ProductionReadService(experimental, quiet());
    for (const scenario of searchScenarios(selectiveSearch)) {
      const expected = await baseline.history(actor, scenario.kind, scenario.filter);
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const actual = await read.history(actor, scenario.kind, scenario.filter);
        samples.push(Number((performance.now() - start).toFixed(2)));
        assert.deepEqual(actual, expected, `Search parity: ${variant}/${scenario.name}`);
      }
      console.log(JSON.stringify({ benchmark: "production_search_comparison", variant, scenario: scenario.name,
        median_ms: [...samples].sort((a, b) => a - b)[2], samples }));
    }
    // Transform before adding EXPLAIN so the reported plan is the same SQL
    // that was timed, not the unmodified baseline.
    await productionReadPlans(pool, selectiveSearch, { searchOnly: true, variant,
      transform: text => searchExperimentSQL(text, variant) });
  }
}
