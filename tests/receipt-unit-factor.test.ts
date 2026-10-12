import { describe, expect, test } from "@jest/globals";
import { calculatePacking, packingUnitWeightKg } from "../shared/production-packing";
import { deriveReceiptPacking, type ReceiptDraft } from "../shared/receipt-draft";

const draft = (overrides: Partial<ReceiptDraft> = {}): ReceiptDraft => ({
  orderId: "4", quantity: "20.00", unit: "packet", count: "10",
  method: "unit_weight", unitWeight: "", pieces: "", pieceWeight: "", ...overrides,
});

describe("receipt unit factor is the derived unit weight, not a new stock calculation", () => {
  test("20 kg in 10 packets gives a 2 kg factor", () => {
    const {result} = deriveReceiptPacking(draft());
    expect(packingUnitWeightKg(result.specification)).toBe("2.000000");
    expect(result.quantity_kg).toBe("20.00");
    expect(result.unit_quantity).toBe("10");
  });
  test("kg always has a factor of one", () => {
    const {result} = deriveReceiptPacking(draft({unit: "kg", quantity: "2.50"}));
    expect(packingUnitWeightKg(result.specification)).toBe("1.000000");
    expect(result.unit_quantity).toBe("2.50");
  });
  test("piece-based packing still displays kg per full packing unit", () => {
    const {result} = deriveReceiptPacking(draft({method: "piece_weight", quantity: "30.00", count: "3", pieces: "20"}));
    expect(packingUnitWeightKg(result.specification)).toBe("10.0000000");
    expect(result.specification.piece_weight_grams).toBe("500.0000");
    expect(result.quantity_kg).toBe("30.00");
  });
  test("tiny piece weights do not become a false zero factor", () => {
    const {specification} = calculatePacking({
      unit: "piece", method: "piece_weight", quantity: "100000",
      pieces_per_unit: 1, piece_weight_grams: "0.0001",
    });
    expect(packingUnitWeightKg(specification)).toBe("0.0000001");
  });
  test("large piece-based factors never pass through floating point or unit-weight limits", () => {
    const {specification} = calculatePacking({
      unit: "roll", method: "piece_weight", quantity: "1",
      pieces_per_unit: 1000000, piece_weight_grams: "99999999.9999",
    });
    expect(packingUnitWeightKg(specification)).toBe("99999999999.9000000");
  });
});
