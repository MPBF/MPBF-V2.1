import { describe, expect, it, jest } from "@jest/globals";
import { categories, customer_products } from "../shared/schema";
import { categoryProductionPlan } from "../server/category-production-plan";

function transaction(
  product: { category_id: string | null } | undefined,
  percentage: number | undefined,
) {
  const tables: unknown[] = [];
  const select = jest.fn(() => ({
    from(table: unknown) {
      tables.push(table);
      return {
        where: () => ({
          limit: async () => table === customer_products ? (product ? [product] : []) :
            table === categories ? (percentage == null ? [] : [{ overrun_percentage: percentage }]) : [],
        }),
      };
    },
  }));
  return {
    tx: { select } as unknown as Parameters<typeof categoryProductionPlan>[0],
    tables,
  };
}

describe("new production order category plan", () => {
  it.each([0, 5, 10, 20])("snapshots %s%% and computes the final planned quantity", async (percentage) => {
    const { tx, tables } = transaction({ category_id: "CAT1" }, percentage);
    const plan = await categoryProductionPlan(tx, 3, "1000.00");
    expect(plan).toEqual({
      overrun_percentage: String(percentage),
      final_quantity_kg: (1000 * (1 + percentage / 100)).toFixed(2),
    });
    expect(tables).toEqual([customer_products, categories]);
  });

  it("rounds to two decimals using the existing planning rule", async () => {
    const { tx } = transaction({ category_id: "CAT1" }, 5);
    expect(await categoryProductionPlan(tx, 3, "120.50")).toEqual({
      overrun_percentage: "5", final_quantity_kg: "126.53",
    });
  });

  it("uses zero for a product without a category", async () => {
    const { tx, tables } = transaction({ category_id: null }, undefined);
    expect(await categoryProductionPlan(tx, 3, "10.25")).toEqual({
      overrun_percentage: "0", final_quantity_kg: "10.25",
    });
    expect(tables).toEqual([customer_products]);
  });

  it.each([null, undefined])("uses zero when no product is supplied (%s)", async (productId) => {
    const { tx, tables } = transaction(undefined, undefined);
    expect(await categoryProductionPlan(tx, productId, "10.25")).toEqual({
      overrun_percentage: "0", final_quantity_kg: "10.25",
    });
    expect(tables).toEqual([]);
  });

  it("does not silently accept a missing product", async () => {
    const { tx } = transaction(undefined, 20);
    await expect(categoryProductionPlan(tx, 3, "10")).rejects.toMatchObject({ status: 400 });
  });

  it("does not silently accept a missing referenced category", async () => {
    const { tx } = transaction({ category_id: "CAT1" }, undefined);
    await expect(categoryProductionPlan(tx, 3, "10")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a percentage outside the category's approved choices", async () => {
    const { tx } = transaction({ category_id: "CAT1" }, 25);
    await expect(categoryProductionPlan(tx, 3, "10")).rejects.toThrow();
  });

  it("rejects a final quantity that exceeds database precision", async () => {
    const { tx } = transaction({ category_id: "CAT1" }, 20);
    await expect(categoryProductionPlan(tx, 3, "99999999.99")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps a previous snapshot when the category percentage changes", async () => {
    const first = transaction({ category_id: "CAT1" }, 5);
    const saved = await categoryProductionPlan(first.tx, 3, "1000");
    const second = transaction({ category_id: "CAT1" }, 20);
    expect(await categoryProductionPlan(second.tx, 3, "1000")).toEqual({
      overrun_percentage: "20", final_quantity_kg: "1200.00",
    });
    expect(saved).toEqual({ overrun_percentage: "5", final_quantity_kg: "1050.00" });
  });
});