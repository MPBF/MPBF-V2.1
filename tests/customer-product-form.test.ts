import { describe, expect, it } from "@jest/globals";
import {
  buildCustomerProductPayload,
  initializeCustomerProductForm,
  validateCustomerProductForm,
} from "../client/src/components/customer-product-form";

describe("customer product form state and payload", () => {
  const row = {
    id: 17, customer_id: "C1", category_id: "CAT01", item_id: "ITM01",
    width: "30", left_facing: "9", right_facing: "9", thickness: "10",
    density: "0.95", printing_cylinder: '20"', cutting_length_cm: 53,
    unit_weight_kg: "1.25", unit_quantity: 10, cutting_unit: "باكت",
    punching: "علاقي هوك", raw_material: "HDPE", master_batch_id: "WHITE",
    cliche_front_design: "/front.png", cliche_back_design: "/back.png",
    front_print_colors: ["#112233", "أسود"], back_print_colors: ["#ffffff"],
    notes: "احتفظ بالمواصفات", status: "inactive", size_caption: "30+9+9X53",
    bag_weight_grams: "13", bags_per_kilo: "81", universal_thickness: "25",
    customer_name: "Joined customer", created_at: "2026-01-01",
  };

  it("preserves all editable fields for edit and clone without IDs or joined properties", () => {
    const state = initializeCustomerProductForm(row);
    const payload = buildCustomerProductPayload(state, { categoryName: "أكياس علاقي", preserveCuttingLength: true });
    expect(payload).toMatchObject({
      customer_id: "C1", item_id: "ITM01", width: "30",
      cutting_length_cm: 53, unit_quantity: 10, unit_weight_kg: "1.25",
      cliche_front_design: "/front.png", cliche_back_design: "/back.png",
      front_print_colors: ["#112233", "أسود"], back_print_colors: ["#ffffff"],
      notes: "احتفظ بالمواصفات", status: "inactive", punching: "علاقي هوك",
    });
    for (const field of ["id", "created_at", "customer_name", "size_caption", "bag_weight_grams", "bags_per_kilo", "package_weight_kg", "is_printed", "universal_thickness"]) {
      expect(payload).not.toHaveProperty(field);
    }
    state.front_print_colors.push("#aabbcc");
    expect(row.front_print_colors).toEqual(["#112233", "أسود"]);
  });

  it("creates with safe defaults and explicitly clears optional values", () => {
    const state = initializeCustomerProductForm({ customer_id: "C1" });
    const payload = buildCustomerProductPayload(state);
    expect(payload).toMatchObject({
      customer_id: "C1", category_id: null, item_id: null, width: null,
      left_facing: null, right_facing: null, thickness: null, density: "0.95",
      cutting_length_cm: null, master_batch_id: null, unit_quantity: null,
      unit_weight_kg: null, cliche_front_design: "", cliche_back_design: "",
      front_print_colors: [], back_print_colors: [], status: "active",
    });
  });

  it("derives new/clone printed lengths but preserves untouched historical edit lengths", () => {
    const state = initializeCustomerProductForm(row);
    expect(buildCustomerProductPayload(state, { categoryName: "أكياس علاقي" }).cutting_length_cm).toBe(51);
    expect(buildCustomerProductPayload(state, { categoryName: "أكياس علاقي", preserveCuttingLength: true }).cutting_length_cm).toBe(53);
    expect(buildCustomerProductPayload(state, { categoryName: "سفرة بلاستيكية مطوية" }).cutting_length_cm).toBe(53);
    state.printing_cylinder = "بدون طباعة";
    expect(buildCustomerProductPayload(state).cutting_length_cm).toBe(53);
  });

  it("requires a real customer and prevents selecting an item from another category", () => {
    const state = initializeCustomerProductForm(row);
    expect(validateCustomerProductForm(state, { customers: [{ id: "C1" }], items: [{ id: "ITM01", category_id: "CAT01" }] })).toBeNull();
    expect(validateCustomerProductForm(state, { customers: [{ id: "OTHER" }] })).not.toBeNull();
    expect(validateCustomerProductForm(state, { items: [{ id: "ITM01", category_id: "CAT02" }] })).not.toBeNull();
    state.customer_id = "";
    expect(validateCustomerProductForm(state)).not.toBeNull();
  });

  it("rejects fractional or negative whole fields, allows zero gussets, and requires positive measurements", () => {
    const state = initializeCustomerProductForm(row);
    for (const field of ["width", "thickness", "left_facing", "right_facing", "unit_quantity", "cutting_length_cm"]) {
      expect(validateCustomerProductForm({ ...state, [field]: "2.5" })).not.toBeNull();
      expect(validateCustomerProductForm({ ...state, [field]: "-1" })).not.toBeNull();
    }
    expect(validateCustomerProductForm({ ...state, left_facing: "0", right_facing: "0" })).toBeNull();
    for (const field of ["width", "thickness", "density", "unit_weight_kg", "unit_quantity", "cutting_length_cm"]) {
      expect(validateCustomerProductForm({ ...state, [field]: "0" })).not.toBeNull();
    }
  });
});