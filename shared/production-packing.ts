export const receiptUnits = ["kg", "packet", "roll", "piece"] as const;
export type ReceiptUnit = typeof receiptUnits[number];
export type ReceiptPacking = {
  unit: ReceiptUnit;
  method: "unit_weight" | "piece_weight";
  quantity: string;
  unit_weight_kg?: string;
  pieces_per_unit?: number;
  piece_weight_grams?: string;
};
export type PackingSpecification = Omit<ReceiptPacking, "quantity">;
export type InventoryUnitBalance = PackingSpecification & {
  id: number; unit_quantity: string; quantity_kg: string;
};

export class PackingError extends Error {
  constructor(readonly message_ar: string, readonly message_en: string) { super(message_ar); }
}
const invalid = () => new PackingError("أدخل وحدة وكمية وبيانات تعبئة موجبة وصحيحة.", "Enter a valid unit, positive quantity and packing details.");
function scaled(value: string, digits: number, wholeDigits: number): bigint {
  if (typeof value !== "string" || !new RegExp(`^\\d{1,${wholeDigits}}(?:\\.\\d{1,${digits}})?$`).test(value)) throw invalid();
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"));
  if (result <= 0n) throw invalid();
  return result;
}
function decimal(value: bigint, digits: number) {
  const scale = 10n ** BigInt(digits);
  return `${value / scale}.${String(value % scale).padStart(digits, "0")}`;
}
/** One shared exact calculation; the server always recalculates the stock weight. */
export function calculatePacking(input: ReceiptPacking) {
  if (!input || !receiptUnits.includes(input.unit)) throw invalid();
  let count: bigint;
  if (input.unit === "kg") count = scaled(input.quantity, 2, 12);
  else {
    if (typeof input.quantity !== "string" || !/^\d{1,12}$/.test(input.quantity)) throw invalid();
    count = BigInt(input.quantity) * 100n;
    if (count <= 0n) throw invalid();
  }
  let weight: bigint;
  let specification: PackingSpecification;
  if (input.method === "unit_weight") {
    if (input.pieces_per_unit !== undefined || input.piece_weight_grams !== undefined) throw invalid();
    const perUnit = scaled(input.unit_weight_kg ?? (input.unit === "kg" ? "1" : ""), 6, 8);
    if (input.unit === "kg" && perUnit !== 1000000n) throw invalid();
    weight = (count * perUnit + 500000n) / 1000000n;
    specification = {unit: input.unit, method: input.method, unit_weight_kg: decimal(perUnit, 6)};
  } else if (input.method === "piece_weight") {
    if (input.unit === "kg" || input.unit_weight_kg !== undefined ||
      !Number.isSafeInteger(input.pieces_per_unit) || input.pieces_per_unit! <= 0 || input.pieces_per_unit! > 1000000) throw invalid();
    const perPiece = scaled(input.piece_weight_grams ?? "", 4, 8);
    weight = (count * BigInt(input.pieces_per_unit!) * perPiece + 5000000n) / 10000000n;
    specification = {unit: input.unit, method: input.method, pieces_per_unit: input.pieces_per_unit, piece_weight_grams: decimal(perPiece, 4)};
  } else throw invalid();
  if (weight <= 0n || weight > 99999999999999n) throw invalid();
  const unit_quantity = input.unit === "kg" ? decimal(count, 2) : String(count / 100n);
  const packing_key = [specification.unit, specification.method, specification.unit_weight_kg ?? "",
    specification.pieces_per_unit ?? "", specification.piece_weight_grams ?? ""].join("|");
  return {quantity_kg: decimal(weight, 2), unit_quantity, specification, packing_key};
}
export function receiptUnitLabel(unit: ReceiptUnit, language: string) {
  const labels: Record<ReceiptUnit, [string, string]> = {
    kg: ["كيلو", "kg"], packet: ["باكت", "Packet"], roll: ["رول", "Roll"], piece: ["قطعة", "Piece"],
  };
  return labels[unit]?.[language === "en" ? 1 : 0] ?? "—";
}

/** Display the derived kg per packing unit without changing the stored calculation. */
export function packingUnitWeightKg(specification: PackingSpecification): string {
  if (specification.method === "unit_weight") {
    // kg is always one kg per unit; other units retain their validated precision.
    return decimal(scaled(specification.unit_weight_kg ?? (specification.unit === "kg" ? "1" : ""), 6, 8), 6);
  }
  if (!Number.isSafeInteger(specification.pieces_per_unit) || specification.pieces_per_unit! <= 0 ||
    specification.pieces_per_unit! > 1000000) throw invalid();
  const pieceGrams = scaled(specification.piece_weight_grams ?? "", 4, 8);
  // Four fractional gram digits become seven fractional kg digits.
  return decimal(pieceGrams * BigInt(specification.pieces_per_unit!), 7);
}
