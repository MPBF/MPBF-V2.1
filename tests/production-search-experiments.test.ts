import { describe, it, expect, jest } from "@jest/globals";
import { historyPage } from "../server/production/history";
import { productionReadPlans } from "../scripts/production-read-plans";
import { compareProductionSearch, searchExperimentSQL } from "../scripts/production-search-experiments";
import { verifyProductionSearch } from "../scripts/verify-production-search";
import { verifyProductionHistory } from "../scripts/verify-production-history";
import type { ConnectionPool } from "../server/production/core";

describe("disposable production search experiments", () => {
  it("keeps prototypes out of unrelated queries and preserves all bound values", async () => {
    for (const variant of ["current", "split_or", "correlated_receipts"] as const) {
      expect(searchExperimentSQL("SELECT 1", variant)).toBe("SELECT 1");
      for (const kind of ["orders", "receipts"] as const) {
        let sql = "", params: unknown[] = [];
        await historyPage({ release() {}, async query(text, values) {
          sql = text; params = values!; return { rows: [] };
        } }, kind, { search: "PRIVATE%_\\", before: 100, limit: 2,
          order_id: 4, from: "2025-01-01", to: "2025-01-03",
          ...(kind === "receipts" ? { location_id: 2 } : { status: "completed" }) });
        const rewritten = searchExperimentSQL(sql, variant);
        expect(rewritten).not.toContain("PRIVATE");
        expect(params).toContain("%PRIVATE\\%\\_\\\\%");
        expect(rewritten).toContain("id<$1");
        expect(rewritten).toContain("AT TIME ZONE 'Asia/Riyadh'");
        expect(rewritten).toContain(`LIMIT $${params.length}`);
        if (variant === "split_or") expect(rewritten).toContain(" UNION ");
        if (variant === "correlated_receipts" && kind === "receipts") expect(rewritten).toContain("OFFSET 0");
        // No changing the SQL that projects full vouchers/order quantities.
        expect(rewritten.slice(rewritten.lastIndexOf("\n  ) "))).toBe(sql.slice(sql.lastIndexOf("\n  ) ")));
      }
    }
  });

  it.each([
    ["application_database", "127.0.0.1"],
    ["factory_isolated_test", "192.0.2.1"],
  ])("refuses diagnostic execution outside the local fixture (%s)", async (db, host) => {
    const query = jest.fn(async (_text: string) => ({ rows: [{ db, host }] }));
    const release = jest.fn();
    const pool: ConnectionPool = { async connect() { return { query, release }; } };
    await expect(productionReadPlans(pool, "PRIVATE", { searchOnly: true })).rejects.toThrow();
    await expect(compareProductionSearch(pool, "PRIVATE")).rejects.toThrow();
    await expect(verifyProductionSearch(pool)).rejects.toThrow();
    await expect(verifyProductionHistory(pool, async text => (await query(text)).rows, true)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.every(([text]) => text.startsWith("SELECT current_database()"))).toBe(true);
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("outputs only fixed scenario labels and whitelisted plan measurements", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const explained: string[] = [];
    const pool: ConnectionPool = { async connect() { return { release() {}, async query(text) {
      if (text.startsWith("SELECT current_database()")) return { rows: [{ db: "factory_isolated_test", host: "127.0.0.1" }] };
      if (text.startsWith("EXPLAIN")) {
        explained.push(text);
        return { rows: [{ "QUERY PLAN": [{
        "Planning Time": 1, "Execution Time": 2, Plan: {
          "Node Type": "Seq Scan", "Relation Name": "production_orders",
          "Actual Rows": 51, "Actual Loops": 1,
          Filter: "PRIVATE CUSTOMER SQL", "Output": ["PRIVATE RESPONSE"],
        },
        }] }] };
      }
      return { rows: [] };
    } }; } };
    try {
      await productionReadPlans(pool, "PRIVATE SEARCH", { searchOnly: true,
        transform: text => `${text} /* LOCAL_PROTOTYPE */` });
      expect(log).toHaveBeenCalledTimes(9);
      const output = JSON.stringify(log.mock.calls);
      expect(output).not.toMatch(/PRIVATE|CUSTOMER|RESPONSE|ILIKE|Filter|Output/);
      expect(output).toContain("receipts_selective_search");
      expect(output).toContain("actual_rows");
      expect(explained).toHaveLength(9);
      expect(explained.every(text => text.endsWith("/* LOCAL_PROTOTYPE */"))).toBe(true);
    } finally { log.mockRestore(); }
  });
});
