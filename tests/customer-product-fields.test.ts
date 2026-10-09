import { describe, expect, it } from "@jest/globals";
import { deriveCustomerProductFields, isManualCuttingCategory, isManualCuttingProduct, PRINTING_CYLINDERS, printingCylinderLength, punchingOptions } from "../shared/customer-product-fields";
import { insertCustomerProductSchema } from "../shared/schema";

describe("customer-product shared calculations", () => {
  it("exports canonical printing and punching options", () => {
    expect(PRINTING_CYLINDERS).toEqual([
      "8\"", "10\"", "12\"", "14\"", "16\"", "18\"", "20\"", "22\"",
      "24\"", "26\"", "28\"", "30\"", "32\"", "34\"", "36\"", "39\"", "بدون طباعة",
    ]);
    expect(punchingOptions("كيس علاقي")).toEqual(["بدون", "علاقي", "علاقي هوك"]);
    expect(punchingOptions("banana bag")).toEqual(["بدون", "بنانة", "بنانة 6سم"]);
    expect(punchingOptions("roll")).toEqual(["بدون"]);
    expect(isManualCuttingCategory("سفرة بلاستيكية مطوية")).toBe(true);
    expect(isManualCuttingCategory("Reusable Table Cover")).toBe(true);
    expect(isManualCuttingCategory("shopping bag")).toBe(false);
    expect(isManualCuttingProduct({ printing_cylinder: "historic-cylinder" })).toBe(true);
    expect(isManualCuttingProduct({ printing_cylinder: "8\"" }, "سفرة بلاستيكية مطوية / Table Cover")).toBe(true);
    expect(isManualCuttingProduct({ printing_cylinder: "8\"" }, "hanger bag")).toBe(false);
  });

  it("converts valid inch cylinders and rejects non-cylinder labels", () => {
    expect(printingCylinderLength("8\"")).toBe(20);
    expect(printingCylinderLength("8.5")).toBe(22);
    expect(printingCylinderLength("بدون طباعة")).toBeNull();
    expect(printingCylinderLength("legacy-cylinder")).toBeNull();
    expect(deriveCustomerProductFields({ printing_cylinder: "legacy-cylinder", cutting_length_cm: 31 }).cutting_length_cm).toBe(31);
  });

  it("derives caption, universal-micron weight, bags per kilo and package weight", () => {
    expect(deriveCustomerProductFields({
      width: "20",
      left_facing: "2",
      right_facing: "3",
      thickness: "20",
      density: "0.95",
      printing_cylinder: "8\"",
      unit_weight_kg: "1.234",
      unit_quantity: 3,
    })).toEqual({
      size_caption: "20+2+3X20",
      cutting_length_cm: 20,
      bag_weight_grams: "5",
      bags_per_kilo: "211",
      package_weight_kg: "3.70",
      is_printed: true,
    });
  });

  it("uses the same default density for blank preview inputs and explicit default inputs", () => {
    const dimensions = { width: "30", thickness: "10", cutting_length_cm: 40 };
    expect(deriveCustomerProductFields({ ...dimensions, density: null }))
      .toEqual(deriveCustomerProductFields({ ...dimensions, density: "0.95" }));
    expect(deriveCustomerProductFields({ ...dimensions, density: "" }))
      .toEqual(deriveCustomerProductFields({ ...dimensions, density: "0.95" }));
    expect(deriveCustomerProductFields(dimensions))
      .toEqual(deriveCustomerProductFields({ ...dimensions, density: "0.95" }));
  });

  it("keeps manual and historical cutting lengths and retains legacy size captions when dimensions are incomplete", () => {
    expect(deriveCustomerProductFields({
      width: "30",
      thickness: "10",
      cutting_length_cm: 45,
      size_caption: "historic-cut",
    })).toMatchObject({ cutting_length_cm: 45, size_caption: "30X45", is_printed: false });
    expect(deriveCustomerProductFields({
      width: "30",
      thickness: "10",
      cutting_length_cm: 45,
      printing_cylinder: "8\"",
    }, "سفرة بلاستيكية مطوية", true).cutting_length_cm).toBe(45);
    expect(deriveCustomerProductFields({ width: "30", size_caption: "manual-size" }))
      .toMatchObject({ size_caption: "manual-size", bag_weight_grams: null, bags_per_kilo: null });
  });

  it("omits all calculated fields and generated thickness from generic insert schemas", () => {
    for (const field of ["size_caption", "bag_weight_grams", "bags_per_kilo", "package_weight_kg", "is_printed", "universal_thickness"]) {
      expect(insertCustomerProductSchema.strict().safeParse({ [field]: "forged" }).success).toBe(false);
    }
    expect(insertCustomerProductSchema.strict().safeParse({ width: "12.5" }).success).toBe(false);
  });
});