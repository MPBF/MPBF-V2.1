import { calculatePacking, PackingError, type ReceiptPacking, type ReceiptUnit } from "./production-packing";

export type ReceiptDraft = {
  orderId: string; quantity: string;
  unit: ReceiptUnit; count: string; method: "unit_weight" | "piece_weight";
  unitWeight: string; pieces: string; pieceWeight: string;
};
const latin = (value: string) => value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, ".");
const invalid = () => new PackingError("أدخل كمية استلام موجبة بالكيلو وعدد وحدات صحيحًا.", "Enter a positive receipt weight in kg and a valid unit count.");
const decimal = (value: bigint, digits: number) => {
  const scale = 10n ** BigInt(digits);
  return `${value / scale}.${String(value % scale).padStart(digits, "0")}`;
};
/** Derive packing from actual received kilograms, never silently change the requested weight. */
export function deriveReceiptPacking(row: ReceiptDraft) {
  const quantity = latin(row.quantity);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(quantity)) throw invalid();
  const [whole, fraction = ""] = quantity.split(".");
  const weight = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (weight <= 0n) throw invalid();
  let packing: ReceiptPacking;
  if (row.unit === "kg") packing = { unit: "kg", method: "unit_weight", quantity };
  else {
    const count = latin(row.count);
    if (!/^\d{1,12}$/.test(count) || BigInt(count) <= 0n) throw invalid();
    if (row.method === "unit_weight") {
      const divisor = BigInt(count);
      const perUnit = (weight * 10000n + divisor / 2n) / divisor;
      packing = { unit: row.unit, method: row.method, quantity: count, unit_weight_kg: decimal(perUnit, 6) };
    } else if (row.method === "piece_weight") {
      const pieces = latin(row.pieces);
      if (!/^\d{1,7}$/.test(pieces) || BigInt(pieces) <= 0n || BigInt(pieces) > 1000000n) throw invalid();
      const divisor = BigInt(count) * BigInt(pieces);
      const perPiece = (weight * 100000n + divisor / 2n) / divisor;
      packing = { unit: row.unit, method: row.method, quantity: count, pieces_per_unit: Number(pieces), piece_weight_grams: decimal(perPiece, 4) };
    } else throw invalid();
  }
  const result = calculatePacking(packing);
  if (result.quantity_kg !== decimal(weight, 2)) throw new PackingError(
    "لا يمكن تمثيل هذا الوزن بدقة التعبئة الحالية؛ عدّل عدد الوحدات أو استخدم الكيلو.",
    "This weight cannot be represented at the packing precision. Adjust the unit count or use kg.",
  );
  return { packing, result };
}
