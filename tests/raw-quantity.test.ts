import { describe, expect, test } from "@jest/globals";
import { latinDigits } from "../client/src/lib/number-input";
import { normalizeRawNumber, rawQuantityValue } from "../client/src/lib/raw-quantity";

describe("shared raw quantity normalization preserves both pages' rules", () => {
  test.each([
    [" ١٢٫٥٠ ", "12.50"], [" ۱۲٫۵۰ ", "12.50"],
    ["999999999999.99", "999999999999.99"], ["0001.20", "0001.20"],
    ["0.01", "0.01"],
  ])("accepts %s without changing saved precision", (input, expected) => {
    expect(rawQuantityValue(input)).toBe(expected);
  });
  test.each(["", " ", "0", "٠٫٠٠", "-1", "1.234", "1e3", "1,000", "١٬٠٠٠", "1000000000000", ".5", "1.", "NaN"])(
    "rejects invalid quantity %s rather than guessing", input => {
      expect(rawQuantityValue(input)).toBeNull();
    },
  );
  test("still recognizes negative stock without accepting a negative receipt", () => {
    expect(Number(normalizeRawNumber(" -١٫٥٠ "))).toBe(-1.5);
    expect(rawQuantityValue(" -١٫٥٠ ")).toBeNull();
  });
  test("shared digit helper preserves whitespace and grouped separators as before", () => {
    expect(latinDigits(" ١٬۲۳۴٫٥٠ ")).toBe(" 1,234.50 ");
    expect(normalizeRawNumber(" ١٬۲۳۴٫٥٠ ")).toBe("1,234.50");
  });
});
