import { describe, expect, it } from "@jest/globals";
import { customerFormSchema, nextCustomerId } from "../server/customer-form";
import { DRAWER_LETTERS, DRAWER_NUMBERS, joinDrawerCode, splitDrawerCode } from "../shared/customer-drawer";

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

  it("accepts only canonical A-Z and 1-100 drawer codes when explicitly supplied", () => {
    for (const plate_drawer_code of ["A-1", "C-24", "Z-100", null, undefined])
      expect(customerFormSchema.safeParse({ name: "Customer", plate_drawer_code }).success).toBe(true);
    for (const plate_drawer_code of ["C-0", "A-101", "a-24", "AA-24", "C-01", "C-", "-24", "C-1.5", "C 24", ""])
      expect(customerFormSchema.safeParse({ name: "Customer", plate_drawer_code }).success).toBe(false);
    // Historical noncanonical codes remain untouched when another field is edited.
    expect(customerFormSchema.partial().parse({ phone: "0501234567" })).not.toHaveProperty("plate_drawer_code");
  });

  it("splits and composes drawer selections without coercing invalid legacy values", () => {
    expect(DRAWER_LETTERS).toHaveLength(26);
    expect(DRAWER_NUMBERS).toHaveLength(100);
    expect(DRAWER_NUMBERS[0]).toBe("1");
    expect(DRAWER_NUMBERS[99]).toBe("100");
    expect(splitDrawerCode("C-24")).toEqual({ letter: "C", number: "24" });
    expect(splitDrawerCode("C-240")).toEqual({ letter: "", number: "" });
    expect(joinDrawerCode("C", "24")).toBe("C-24");
    expect(joinDrawerCode("Z", "100")).toBe("Z-100");
    expect(joinDrawerCode("", "")).toBeNull();
    expect(() => joinDrawerCode("C", "")).toThrow();
    expect(() => joinDrawerCode("", "24")).toThrow();
    expect(() => joinDrawerCode("C", "101")).toThrow();
  });
});