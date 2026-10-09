import { describe, expect, it } from "@jest/globals";
import { insertCustomerProductSchema } from "../shared/schema";

describe("customer product whole-number inputs", () => {
  const fields = ["width", "left_facing", "right_facing", "thickness"] as const;

  it.each(fields)("rejects fractions in %s", (field) => {
    expect(insertCustomerProductSchema.strict().partial().safeParse({ [field]: "12.5" }).success).toBe(false);
    expect(insertCustomerProductSchema.strict().partial().safeParse({ [field]: "12" }).success).toBe(true);
    expect(insertCustomerProductSchema.strict().partial().safeParse({ [field]: null }).success).toBe(true);
  });

  it("does not let callers set the generated universal thickness", () => {
    expect(insertCustomerProductSchema.strict().safeParse({ universal_thickness: "123" }).success).toBe(false);
  });
  it.each(["bags_per_kilo", "bag_weight_grams", "package_weight_kg", "size_caption", "is_printed"])("does not accept client-supplied calculated %s", (field) => {
    expect(insertCustomerProductSchema.strict().partial().safeParse({ [field]: "12" }).success).toBe(false);
    expect(insertCustomerProductSchema.strict().partial().safeParse({ [field]: null }).success).toBe(false);
  });
});