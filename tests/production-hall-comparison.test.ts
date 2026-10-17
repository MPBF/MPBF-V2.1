import { describe, expect, it } from "@jest/globals";
import { hallComparisonSQL } from "../scripts/production-hall-comparison";

const suffix = `, selected AS MATERIALIZED (
  SELECT id FROM outstanding UNION SELECT production_order_id FROM factory_queues
) SELECT all_source_quantities FROM selected ORDER BY id DESC`;
const source = `WITH ready AS (SELECT original_ready), received AS (SELECT original_received),
outstanding AS (SELECT original_outstanding)${suffix}`;

describe("isolated hall research SQL", () => {
  it("keeps baseline and memory-only SQL byte-identical", () => {
    expect(hallComparisonSQL(source, "baseline")).toBe(source);
    expect(hallComparisonSQL(source, "memory_64mb")).toBe(source);
  });
  it.each(["aggregate_first", "lateral_receipts"] as const)("preserves selection and projection for %s", candidate => {
    const result = hallComparisonSQL(source, candidate);
    expect(result.endsWith(suffix)).toBe(true);
    expect(result).toContain("sum(weight_kg)");
    expect(result).toContain("sum(net_weight_kg)");
    expect(result).toContain("CASE WHEN e.is_roll_product THEN r.weight ELSE r.net END");
    expect(result).toContain("ready.quantity>COALESCE(received.quantity,0)");
    expect(result).not.toMatch(/\b(LIMIT|OFFSET|CREATE|INSERT|UPDATE|DELETE)\b/i);
  });
  it("fails explicitly on SQL shape drift instead of benchmarking a different query", () => {
    expect(() => hallComparisonSQL("SELECT 1", "aggregate_first")).toThrow("Hall SQL changed");
    expect(() => hallComparisonSQL(source.replace("selected AS MATERIALIZED", "selected AS"), "lateral_receipts")).toThrow();
  });
});
