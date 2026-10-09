import { describe, expect, it } from "@jest/globals";
import { nextCategoryId } from "../server/category-id";

describe("category identifier allocation", () => {
  it("starts with the existing two-digit CAT format", () => {
    expect(nextCategoryId(null, null)).toBe("CAT01");
  });

  it("continues existing IDs through digit boundaries and preserves wider padding", () => {
    expect(nextCategoryId("12", 2)).toBe("CAT13");
    expect(nextCategoryId("99", 2)).toBe("CAT100");
    expect(nextCategoryId("12", 4)).toBe("CAT0013");
  });

  it("rejects invalid or exhausted identifiers", () => {
    expect(() => nextCategoryId("CAT12", 2)).toThrow("غير صالح");
    expect(() => nextCategoryId("9".repeat(17), 17)).toThrow("الحد الأقصى");
  });
});