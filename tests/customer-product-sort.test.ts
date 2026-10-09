import { describe, expect, it } from "@jest/globals";
import { sortCustomerProductsByCategory } from "../client/src/lib/customer-product-sort";

const product = (id: number, categoryId: string | null, name?: string | null, english?: string | null) =>
  ({ id, category_id: categoryId, category_name_ar: name, category_name: english });
const ids = (rows: { id: number }[]) => rows.map((row) => row.id);

describe("customer profile category-name sorting", () => {
  it("uses English category names rather than Arabic when English is active", () => {
    const rows = [product(1, "CAT01", "أكياس", "Z Bags"), product(2, "CAT02", "شنط", "A Bags")];
    expect(ids(sortCustomerProductsByCategory(rows, "ar"))).toEqual([1, 2]);
    expect(ids(sortCustomerProductsByCategory(rows, "en"))).toEqual([2, 1]);
  });

  it("keeps English-missing categories grouped by ID without an Arabic fallback", () => {
    const rows = [product(1, null), product(2, "CAT2", "أكياس"), product(3, "CAT1", "شنط", "شنط"), product(4, "CAT3", "رولات", "Rolls"), product(5, "CAT2", "أكياس")];
    expect(ids(sortCustomerProductsByCategory(rows, "en"))).toEqual([4, 3, 2, 5, 1]);
  });

  it("sorts by Arabic category name, not category code or product ID", () => {
    const rows = [
      product(9, "CAT01", "شنط"), product(8, "CAT02", "أكياس"),
      product(7, "CAT03", "رولات"), product(6, "CAT02", "أكياس"),
      product(5, "CAT01", "شنط"),
    ];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([8, 6, 7, 9, 5]);
  });

  it("preserves the original order of each category's products", () => {
    const rows = [product(12, "CAT01", "أكياس"), product(3, "CAT01", "أكياس"), product(7, "CAT01", "أكياس")];
    expect(sortCustomerProductsByCategory(rows)).toEqual(rows);
  });

  it("falls back to the English name when the Arabic name is absent or blank", () => {
    const rows = [product(1, "CAT01", " ", "Rolls"), product(2, "CAT02", null, "Bags"), product(3, "CAT03", undefined, "Paper")];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([2, 3, 1]);
  });

  it("prefers the Arabic name over English", () => {
    const rows = [product(1, "CAT01", "شنط", "A"), product(2, "CAT02", "أكياس", "Z")];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([2, 1]);
  });

  it("keeps different categories with identical names grouped together", () => {
    const rows = [
      product(1, "CAT10", "أكياس"), product(2, "CAT2", "أكياس"),
      product(3, "CAT10", "أكياس"), product(4, "CAT2", "أكياس"),
    ];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([2, 4, 1, 3]);
  });

  it("places unnamed associated categories before truly unclassified products", () => {
    const rows = [
      product(1, null), product(2, "CAT02", null), product(3, "CAT01", "رولات"),
      product(4, null, "stale name"), product(5, "CAT02", ""), product(6, " ", "stale name"),
    ];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([3, 2, 5, 1, 4, 6]);
  });

  it("uses natural name ordering for category names containing numbers", () => {
    const rows = [product(1, "CAT01", "أكياس 10"), product(2, "CAT02", "أكياس 2")];
    expect(ids(sortCustomerProductsByCategory(rows))).toEqual([2, 1]);
  });

  it("does not mutate the input array or the products", () => {
    const rows = Object.freeze([
      Object.freeze(product(1, "CAT01", "شنط")), Object.freeze(product(2, "CAT02", "أكياس")),
    ]);
    const sorted = sortCustomerProductsByCategory(rows);
    expect(ids([...rows])).toEqual([1, 2]);
    expect(ids(sorted)).toEqual([2, 1]);
    expect(sorted[0]).toBe(rows[1]);
    expect(sorted[1]).toBe(rows[0]);
  });

  it("handles empty lists and products with no category fields", () => {
    expect(sortCustomerProductsByCategory([])).toEqual([]);
    expect(sortCustomerProductsByCategory([{}, {}])).toEqual([{}, {}]);
  });
});