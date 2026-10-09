export type ProductInput = Record<string, any>;

export const PRINTING_CYLINDERS: string[] = [
  "8\"", "10\"", "12\"", "14\"", "16\"", "18\"", "20\"", "22\"",
  "24\"", "26\"", "28\"", "30\"", "32\"", "34\"", "36\"", "39\"", "بدون طباعة",
];

export function isManualCuttingCategory(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return normalized.includes("سفرة بلاستيكية") || normalized.includes("table cover");
}

export function punchingOptions(name: string): string[] {
  const normalized = name.toLocaleLowerCase();
  if (normalized.includes("علاقي") || normalized.includes("hanger") || normalized.includes("t-shirt")) {
    return ["بدون", "علاقي", "علاقي هوك"];
  }
  if (normalized.includes("بنانة") || normalized.includes("banana")) {
    return ["بدون", "بنانة", "بنانة 6سم"];
  }
  return ["بدون"];
}

export function printingCylinderLength(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text === "بدون طباعة") return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:"|in(?:ches?)?)?$/i);
  if (!match) return null;
  const inches = Number(match[1]);
  return Number.isFinite(inches) && inches > 0 ? Math.round(inches * 2.54) : null;
}

export function isManualCuttingProduct(input: ProductInput, categoryName = ""): boolean {
  const cylinder = input.printing_cylinder;
  return !cylinder || String(cylinder).trim() === "" ||
    String(cylinder).trim() === "بدون طباعة" ||
    printingCylinderLength(cylinder) === null ||
    isManualCuttingCategory(categoryName);
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function nonnegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/** Blank facings mean zero; a missing width cannot establish the sum limit. */
export function customerProductFacingNotice(input: ProductInput): {
  kind: "blocking" | "warning"; message: string;
} | null {
  const left = nonnegativeNumber(input.left_facing);
  const right = nonnegativeNumber(input.right_facing);
  if (left === null || right === null) return null;
  const width = positiveNumber(input.width);
  if (width !== null && left + right >= width) {
    return { kind: "blocking", message: "لا يمكن الحفظ: مجموع الجانب الأيمن والجانب الأيسر يساوي العرض أو يزيد عليه. يجب أن يكون مجموع الجانبين أقل من العرض." };
  }
  if (left !== right) {
    return { kind: "warning", message: "الجانب الأيمن لا يساوي الجانب الأيسر. هل تريد الاستمرار في الحفظ بهذه القيم؟" };
  }
  return null;
}

export function deriveCustomerProductFields(
  input: ProductInput,
  categoryName?: string,
  preserveCuttingLength = false,
): {
  size_caption: string | null;
  cutting_length_cm: number | null;
  bag_weight_grams: string | null;
  bags_per_kilo: string | null;
  package_weight_kg: string | null;
  is_printed: boolean;
} {
  const cylinder = input.printing_cylinder;
  const cylinderLength = printingCylinderLength(cylinder);
  const manualCutting = isManualCuttingProduct(input, categoryName);
  const is_printed = cylinderLength !== null;

  let cutting_length_cm: number | null;
  if (manualCutting || preserveCuttingLength) {
    const length = positiveNumber(input.cutting_length_cm);
    cutting_length_cm = length !== null && Number.isInteger(length) ? length : null;
  } else {
    cutting_length_cm = cylinderLength;
  }

  const width = positiveNumber(input.width);
  const leftValue = nonnegativeNumber(input.left_facing);
  const rightValue = nonnegativeNumber(input.right_facing);
  const left = leftValue ?? 0;
  const right = rightValue ?? 0;
  let size_caption = input.size_caption == null || input.size_caption === ""
    ? null : String(input.size_caption);
  if (width !== null && leftValue !== null && rightValue !== null &&
    cutting_length_cm !== null && cutting_length_cm > 0) {
    const flatWidths = [input.width, left > 0 ? input.left_facing : null, right > 0 ? input.right_facing : null]
      .filter((part) => part !== null && part !== undefined && part !== "");
    size_caption = `${flatWidths.join("+")}X${cutting_length_cm}`;
  }

  const thickness = positiveNumber(input.thickness);
  const density = input.density === undefined || input.density === null || input.density === ""
    ? 0.95
    : positiveNumber(input.density);
  let bag_weight_grams: string | null = null;
  let bags_per_kilo: string | null = null;
  if (width !== null && leftValue !== null && rightValue !== null &&
    thickness !== null && cutting_length_cm !== null && density !== null) {
    const universalMicrons = Math.ceil(
      (left > 0 && right > 0 ? thickness / 4 : thickness / 2) * 10,
    );
    const rawGrams = (width + left + right) * cutting_length_cm * 2 *
      (universalMicrons * 1e-4) * density;
    if (Number.isFinite(rawGrams) && rawGrams > 0) {
      bag_weight_grams = String(Math.ceil(rawGrams));
      bags_per_kilo = String(Math.ceil(1000 / rawGrams));
    }
  }

  const unitWeight = positiveNumber(input.unit_weight_kg);
  const unitQuantity = positiveNumber(input.unit_quantity);
  const package_weight_kg = unitWeight !== null && unitQuantity !== null
    ? (Math.round((unitWeight * unitQuantity + Number.EPSILON) * 100) / 100).toFixed(2)
    : null;

  return { size_caption, cutting_length_cm, bag_weight_grams, bags_per_kilo, package_weight_kg, is_printed };
}