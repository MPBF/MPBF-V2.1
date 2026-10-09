import { describe, expect, it } from "@jest/globals";
import {
  groupProductsByRootCategory,
  type CatalogRow,
} from "../client/src/lib/product-category-groups";

describe("groupProductsByRootCategory", () => {
  it("groups nested categories under their root and preserves product order", () => {
    const products: CatalogRow[] = [
      { id: "first", category_id: "leaf" },
      { id: "other", category_id: "root-b" },
      { id: "second", category_id: "branch" },
    ];
    const categories: CatalogRow[] = [
      { id: "leaf", name_ar: "ورقي", parent_id: "branch" },
      { id: "root-b", name: "B category" },
      { id: "branch", name: "Branch", parent_id: "root-a" },
      { id: "root-a", name_ar: "مواد", name: "Materials" },
    ];
    const productsBefore = structuredClone(products);
    const categoriesBefore = structuredClone(categories);

    const groups = groupProductsByRootCategory(products, categories);

    expect(groups.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "root-a", label: "مواد" },
      { id: "root-b", label: "B category" },
    ]);
    expect(groups[0].products).toEqual([products[0], products[2]]);
    expect(products).toEqual(productsBefore);
    expect(categories).toEqual(categoriesBefore);
  });

  it("assigns distinct colors to roots and keeps colors stable for product subsets", () => {
    const categories = [
      { id: "root-1", name: "One" },
      { id: "root-2", name: "Two" },
      { id: "root-3", name: "Three" },
    ];
    const allProducts = categories.map(({ id }) => ({ category_id: id }));
    const fullGroups = groupProductsByRootCategory(allProducts, categories);
    const subsetGroups = groupProductsByRootCategory([allProducts[1]], categories);
    const colorsById = new Map(fullGroups.map(({ id, color }) => [id, color]));

    expect(new Set(fullGroups.map(({ color }) => color)).size).toBe(3);
    expect(subsetGroups[0].color).toBe(colorsById.get("root-2"));
  });

  it("assigns colors in natural numeric root-ID order", () => {
    const categories = [{ id: "10" }, { id: "2" }, { id: "1" }];
    const products = categories.map(({ id }) => ({ category_id: id }));
    const groups = groupProductsByRootCategory(products, categories);

    expect(new Map(groups.map(({ id, color }) => [id, color]))).toEqual(
      new Map([
        ["1", "#1D4ED8"],
        ["2", "#047857"],
        ["10", "#B45309"],
      ]),
    );
  });

  it("returns groups in natural ID order with uncategorized last", () => {
    const products = [
      { id: "ten-first", category_id: "CAT10" },
      { id: "two-first", category_id: "CAT2" },
      { id: "ten-second", category_id: "CAT10" },
      { id: "no-category" },
    ];
    const categories = [{ id: "CAT10" }, { id: "CAT2" }];
    const groups = groupProductsByRootCategory(products, categories);

    expect(groups.map(({ id }) => id)).toEqual(["CAT2", "CAT10", "uncategorized"]);
    expect(groups[1].products).toEqual([products[0], products[2]]);
    expect(groups[2].products).toEqual([products[3]]);
  });

  it("uses the last existing category as root when its parent is missing", () => {
    const groups = groupProductsByRootCategory(
      [{ category_id: "child" }],
      [{ id: "child", parent_id: "not-in-catalog", name: "Available category" }],
    );

    expect(groups).toEqual([
      {
        id: "child",
        label: "Available category",
        color: "#1D4ED8",
        products: [{ category_id: "child" }],
      },
    ]);
  });

  it("handles unknown and uncategorized products with fallback labels and neutral colors", () => {
    const products = [
      { id: 1, category_id: "gone", category_name_ar: "اسم عربي", category_name: "English" },
      { id: 2, category_id: "missing-label", category_name: "Fallback name" },
      { id: 3, category_id: "missing-label" },
      { id: 4, category_id: null, category_name: "Ignored without category ID" },
      { id: 5 },
    ];
    const groups = groupProductsByRootCategory(products, []);

    expect(groups.map(({ id, label, color, products: grouped }) => ({
      id,
      label,
      color,
      productIds: grouped.map((product) => product.id),
    }))).toEqual([
      { id: "gone", label: "اسم عربي", color: "#4B5563", productIds: [1] },
      { id: "missing-label", label: "Fallback name", color: "#4B5563", productIds: [2, 3] },
      { id: "uncategorized", label: "غير مصنف", color: "#4B5563", productIds: [4, 5] },
    ]);
  });

  it("resolves category cycles to the smallest natural ID in the cycle", () => {
    const categories = [
      { id: "10", parent_id: "2", name: "Ten" },
      { id: "2", parent_id: "3", name: "Two" },
      { id: "3", parent_id: "10", name: "Three" },
      { id: "child", parent_id: "10", name: "Child" },
      { id: "outside", parent_id: "1", name: "Separate root" },
    ];
    const products = [
      { id: "in-cycle", category_id: "3" },
      { id: "through-cycle", category_id: "child" },
    ];

    const groups = groupProductsByRootCategory(products, categories);

    expect(groups).toEqual([
      {
        id: "2",
        label: "Two",
        color: "#1D4ED8",
        products: [products[0], products[1]],
      },
    ]);
  });

  it("extends the palette with distinct dark colors for large catalogs", () => {
    const categories = Array.from({ length: 24 }, (_, index) => ({ id: `root-${index}` }));
    const products = categories.map(({ id }) => ({ category_id: id }));
    const colors = groupProductsByRootCategory(products, categories).map(({ color }) => color);

    expect(colors).toHaveLength(24);
    expect(new Set(colors).size).toBe(24);
    expect(colors.slice(16).every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
  });
});