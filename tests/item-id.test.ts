import { describe, expect, it } from "@jest/globals";
import { nextItemId } from "../server/item-id";

describe("item identifier allocation", () => {
  it("starts with the existing ITM format", () => {
    expect(nextItemId(null, null)).toBe("ITM01");
  });

  it("continues the most recent ITM range and sorts correctly through digit boundaries", () => {
    expect(nextItemId("67", 2)).toBe("ITM68");
    expect(nextItemId("99", 2)).toBe("ITM100");
    expect(nextItemId("67", 3)).toBe("ITM068");
  });

  it("rejects malformed or exhausted identifiers", () => {
    expect(() => nextItemId("ITM67", 2)).toThrow("غير صالح");
    expect(() => nextItemId("9".repeat(17), 17)).toThrow("الحد الأقصى");
  });
});