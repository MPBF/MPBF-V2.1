import { describe, expect, it } from "@jest/globals";
import { customerFormSchema, nextCustomerId } from "../server/customer-form";

describe("customer form contract", () => {
  it("allocates the existing CID format including sequence growth", () => {
    expect(nextCustomerId(null, null)).toBe("CID001");
    expect(nextCustomerId("9", 3)).toBe("CID010");
    expect(nextCustomerId("332", 3)).toBe("CID333");
    expect(nextCustomerId("999", 3)).toBe("CID1000");
    expect(nextCustomerId("12", 5)).toBe("CID00013");
    expect(() => nextCustomerId("invalid", 3)).toThrow();
    expect(() => nextCustomerId("99999999999999999", 17)).toThrow();
  });

  it("requires a nonblank English name but no manually supplied ID", () => {
    expect(customerFormSchema.parse({ name: "  New customer  ", name_ar: "  عميل  " }))
      .toMatchObject({ name: "New customer", name_ar: "عميل" });
    for (const name of ["", " ", null]) {
      expect(customerFormSchema.safeParse({ name }).success).toBe(false);
    }
    expect(customerFormSchema.safeParse({ name: "Customer", id: "MANUAL" }).success).toBe(false);
  });

  it("allows optional representatives only as positive integer user IDs", () => {
    for (const sales_rep_id of [null, undefined, 7]) {
      expect(customerFormSchema.safeParse({ name: "Customer", sales_rep_id }).success).toBe(true);
    }
    for (const sales_rep_id of ["7", 0, -1, 7.5]) {
      expect(customerFormSchema.safeParse({ name: "Customer", sales_rep_id }).success).toBe(false);
    }
  });

  it("supports partial edits without clearing historical customer fields", () => {
    expect(customerFormSchema.partial().parse({ phone: "0501234567" }))
      .toEqual({ phone: "0501234567" });
    expect(customerFormSchema.partial().safeParse({ name: " " }).success).toBe(false);
    expect(customerFormSchema.safeParse({ name: "Customer", phone: "1".repeat(21) }).success).toBe(false);
  });
});