import type { ProductSnapshot } from "../../../shared/production";
import { isTransparentMasterBatch } from "./master-batch-color";

const arabic = /[\u0600-\u06ff]/;
export function safeFilmName(value: string | null | undefined, language: string, fallback: string) {
  const clean = (value ?? "").trim();
  return clean && (language !== "en" || !arabic.test(clean)) ? clean : fallback;
}

export function filmSearchTerm(value: string) {
  return value.trim().replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).toLocaleLowerCase();
}

type Formatter = (value: string | number | null | undefined, digits?: number) => string;
const positive = (value: string | null | undefined) =>
  value !== null && value !== undefined && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;

// Calculate from raw two-decimal kg values, never from rounded display text.
export function filmRemainingQuantity(planned: string | number | null | undefined, produced: string | number | null | undefined) {
  const cents = (value: typeof planned) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : null;
  };
  const target = cents(planned), actual = cents(produced);
  return target === null || actual === null ? null : Math.max(0, target - actual) / 100;
}

export function filmOperationSpecs(product: ProductSnapshot | null, language: string, number: Formatter, unrecorded: string) {
  if (!product) return { size: unrecorded, material: unrecorded, thickness: unrecorded, batchName: unrecorded, batch: null };
  const caption = safeFilmName(product.size_caption, language, "").replace(/[0-9٠-٩۰-۹]+[.٫][0-9٠-٩۰-۹]+/g,
    value => number(value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace("٫", ".")));
  const faces = [product.left_facing, product.right_facing].filter(positive).map(value => number(value));
  const dimensions = [positive(product.width) ? number(product.width) : "", ...faces].filter(Boolean);
  const size = caption.replace(/(?:العرض|الكسرة|Width|Gusset)\s*:?\s*/gi, "").trim()
    || (dimensions.length ? `${dimensions.join(" + ")} cm` : unrecorded);
  const thickness = positive(product.universal_thickness) ? `${number(product.universal_thickness)} µm` : unrecorded;
  const batch = product.master_batch ?? null;
  const batchName = !batch ? unrecorded : isTransparentMasterBatch(batch)
    ? language === "en" ? "Transparent" : "شفاف"
    : (language === "en" ? [batch.name, batch.color_hex] : [batch.name_ar, batch.name, batch.color_hex])
      .map(value => safeFilmName(value, language, "")).find(Boolean) || unrecorded;
  return { size, material: safeFilmName(product.raw_material, language, unrecorded), thickness, batchName, batch };
}
