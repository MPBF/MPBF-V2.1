import { describe, expect, it } from "@jest/globals";
import { customerProductFacingNotice } from "../shared/customer-product-fields";
import { validateCustomerProductForm } from "../client/src/components/customer-product-form";

describe("customer product facing notices", () => {
  it.each([
    { width: "30", right_facing: "5", left_facing: "5" },
    { width: "10", right_facing: "0", left_facing: "0" },
    { width: null, right_facing: "", left_facing: null },
  ])("does not warn for equal valid or unspecified sides: %j", (form) => {
    expect(customerProductFacingNotice(form)).toBeNull();
  });
  it.each([
    { width: "30", right_facing: "5", left_facing: "4" },
    { width: "30", right_facing: "5", left_facing: "" },
    { width: null, right_facing: "5", left_facing: "4" },
  ])("warns without preventing a valid save: %j", (form) => {
    expect(customerProductFacingNotice(form)?.kind).toBe("warning");
    expect(validateCustomerProductForm({ customer_id: "C1", ...form })).toBeNull();
  });
  it.each([
    { width: "10", right_facing: "5", left_facing: "5" },
    { width: "10", right_facing: "6", left_facing: "5" },
    { width: "10", right_facing: "", left_facing: "10" },
  ])("blocks equal-or-larger sums, taking precedence over a mismatch warning: %j", (form) => {
    expect(customerProductFacingNotice(form)?.kind).toBe("blocking");
    expect(validateCustomerProductForm({ customer_id: "C1", ...form })).toContain("يجب أن يكون مجموع الجانبين أقل من العرض");
  });
});