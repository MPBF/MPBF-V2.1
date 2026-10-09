import { describe, expect, it } from "@jest/globals";
import { printDimensionText, printNumberText } from "../client/src/lib/order-print-format";
import { numberText } from "../client/src/lib/order-details";

describe("print-only integer display", () => {
  it.each([
    ["105.53", "106"], ["435.53", "436"], ["25.49", "25"], ["25.50", "26"],
    ["16.5", "17"], ["12345.6", "12,346"], [0, "0"], [-0.1, "0"],
    [-1.5, "-2"], ["1e3", "1,000"],
  ])("rounds %s to %s", (value, expected) => expect(printNumberText(value)).toBe(expected));
  it.each([null, undefined, "", "  ", "invalid", "1,234.5", "0x10", Infinity, NaN, true, []])(
    "does not invent numbers for %j", value => expect(printNumberText(value)).toBe("—"),
  );
  it.each([
    ["28.4+7.5+7.5X41.49", "28+8+8X41"],
    ['16.5″', '17″'], ["16.50", "17"], ["28+7+7X41", "28+7+7X41"],
    ["28.5 × 41.5 cm", "29 × 42 cm"], ["-.5", "-1"],
    ["28+unknown+41.6", "28+unknown+42"], [null, "—"], ["unknown", "—"],
  ])("rounds dimension %s to %s", (value, expected) => expect(printDimensionText(value)).toBe(expected));
  it("rounds the original total, not the sum of displayed rows", () => {
    expect(printNumberText("100.4")).toBe("100");
    expect(printNumberText("200.8")).toBe("201");
  });
  it("leaves source values and general detail formatting unchanged", () => {
    const value = "105.53";
    printNumberText(value);
    expect(value).toBe("105.53");
    expect(numberText(value)).toBe("105.53");
  });
});