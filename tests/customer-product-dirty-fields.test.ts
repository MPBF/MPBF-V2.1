import { describe, expect, it } from "@jest/globals";
import { buildCustomerProductDirtyPayload, initializeCustomerProductForm, validateCustomerProductForm } from "../client/src/components/customer-product-form";

describe("customer product edit serialization", () => {
  it("keeps a legacy null density blank while applying the default only to new rows", () => {
    expect(initializeCustomerProductForm({ id: 41, density: null }).density).toBe("");
    expect(initializeCustomerProductForm({}).density).toBe("0.95");
  });

  it("treats numeric formats and blank/null as semantically equal", () => {
    const dirty = buildCustomerProductDirtyPayload(
      { id: 41, width: "20", density: null, right_facing: null, unit_quantity: "3" },
      { width: 20, density: "", right_facing: "", unit_quantity: 3 },
    );
    expect(dirty).toEqual({});
  });

  it("sends only changed editable fields, including explicit clears, and excludes metadata", () => {
    const dirty = buildCustomerProductDirtyPayload(
      { id: 41, width: "20", notes: "Old", front_print_colors: '["#abc"]', size_caption: "historic" },
      {
        width: null,
        notes: "Updated",
        front_print_colors: ["#abc"],
        size_caption: "forged",
        clone_source_id: 41,
        bag_weight_grams: "12",
      },
    );
    expect(dirty).toEqual({ width: null, notes: "Updated" });
  });

  it("allows a legacy item without a category while still enforcing item/category matches when set", () => {
    const form = { customer_id: "8", category_id: "", item_id: "12" };
    expect(validateCustomerProductForm(form, {
      customers: [{ id: 8 }],
      items: [{ id: 12, category_id: 4 }],
      categoryId: null,
    })).toBeNull();
    expect(validateCustomerProductForm({ ...form, category_id: "4" }, {
      customers: [{ id: 8 }],
      items: [{ id: 12, category_id: 7 }],
      categoryId: "4",
    })).toContain("لا يتبع التصنيف");
  });
});