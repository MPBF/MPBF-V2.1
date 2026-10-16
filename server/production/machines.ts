import { machineStage, type ProductSnapshot, type ProductionMachine, type ProductionStage } from "../../shared/production";
import { one, ProductionError, type Connection } from "./core";
import { snapshotWithDisplayThickness } from "./read-queries";

/** Saved snapshots retain the cylinder's display unit; compare inches, not NaN. */
function printingCylinderInches(value: string | null): number | null {
  const normalized = String(value ?? "").trim()
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".");
  const match = /^(\d+(?:\.\d+)?)(?:\s*(?:"|″|”|in(?:ch(?:es)?)?\.?|بوصة|بوصه|إنش|انش))?$/iu.exec(normalized);
  if (!match) return null;
  const inches = Number(match[1]);
  return Number.isFinite(inches) && inches > 0 ? inches : null;
}

/** Explain the first failed check without changing the existing numeric rules. */
function requireRange(
  value: string | number | null, min: string | null, max: string | null,
  labels: [string, string], units: [string, string] = ["", ""],
) {
  if (min == null && max == null) return;
  const missing = value == null || String(value).trim() === "";
  const n = missing ? NaN : Number(value);
  if (Number.isFinite(n) && (min == null || n >= Number(min)) && (max == null || n <= Number(max))) return;
  const display = (v: string | number, language: number) => {
    // Keep enough precision to explain a just-outside-boundary rejection.
    const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 }).format(Number(v));
    return `${number}${units[language] ? ` ${units[language]}` : ""}`;
  };
  const range = (language: number) => {
    const lo = min != null && Number.isFinite(Number(min)) ? display(min, language) : null;
    const hi = max != null && Number.isFinite(Number(max)) ? display(max, language) : null;
    if (lo != null && hi != null) return language === 0 ? `حدود الماكينة: ${lo} – ${hi}` : `Machine limits: ${lo} – ${hi}`;
    if (lo != null) return language === 0 ? `الحد الأدنى: ${lo}` : `Minimum: ${lo}`;
    if (hi != null) return language === 0 ? `الحد الأقصى: ${hi}` : `Maximum: ${hi}`;
    return language === 0 ? "راجع حدود الماكينة" : "Check machine limits";
  };
  if (!Number.isFinite(n)) {
    throw new ProductionError(
      `قيمة ${labels[0]} غير مسجلة أو غير صالحة. ${range(0)}.`,
      `${labels[1]} is missing or invalid. ${range(1)}.`,
    );
  }
  if (min != null && n < Number(min)) {
    throw new ProductionError(
      `${labels[0]} ${display(n, 0)} أقل من الحد الأدنى ${display(min, 0)}.`,
      `${labels[1]} ${display(n, 1)} is below the minimum ${display(min, 1)}.`,
    );
  }
  if (max != null && n > Number(max)) {
    throw new ProductionError(
      `${labels[0]} ${display(n, 0)} أعلى من الحد الأقصى ${display(max, 0)}.`,
      `${labels[1]} ${display(n, 1)} exceeds the maximum ${display(max, 1)}.`,
    );
  }
  // Invalid machine limits still reject, as before; do not invent a numeric limit.
  throw new ProductionError(`${labels[0]} لا يطابق حدود الماكينة. ${range(0)}.`,
    `${labels[1]} does not meet machine limits. ${range(1)}.`);
}
export async function machine(tx: Connection, id: string, stage: ProductionStage, product: ProductSnapshot) {
  const selected = await one<ProductionMachine & {
    raw_material_type: string | null; max_print_colors: number | null;
    min_cylinder_inch: string | null; max_cylinder_inch: string | null;
    min_length_cm: string | null; max_length_cm: string | null;
  }>(tx, "SELECT * FROM machines WHERE id=$1 FOR SHARE", [id]);
  if (machineStage(selected.type) !== stage || selected.status !== "active")
    throw new ProductionError("اختر ماكينة نشطة من نوع المرحلة الصحيح", "Select an active machine of the correct stage type.");
  let thickness = product.thickness ?? null;
  if (stage === "film" && !Object.hasOwn(product, "thickness") &&
      (selected.min_thickness != null || selected.max_thickness != null)) {
    // Older frozen execution specs omitted raw thickness. Use the same guarded,
    // read-only enrichment as operator feeds; never substitute universal thickness.
    const legacy = await one<{ thickness: string | null }>(tx,
      `SELECT (${snapshotWithDisplayThickness})->>'thickness' thickness
       FROM (SELECT $1::jsonb product) e LEFT JOIN customer_products cp ON cp.id=$2`,
      [JSON.stringify(product), product.id]);
    thickness = legacy.thickness;
  }
  if (stage !== "cutting")
    requireRange(product.width, selected.min_width_cm, selected.max_width_cm, ["العرض", "Width"], ["سم", "cm"]);
  if (stage === "film")
    requireRange(thickness, selected.min_thickness, selected.max_thickness, ["السماكة الأصلية", "Original thickness"]);
  if (stage === "cutting")
    requireRange(product.cutting_length_cm, selected.min_length_cm, selected.max_length_cm, ["طول القص", "Cutting length"], ["سم", "cm"]);
  if (stage === "printing")
    requireRange(printingCylinderInches(product.printing_cylinder), selected.min_cylinder_inch, selected.max_cylinder_inch,
      ["سلندر الطباعة", "Printing cylinder"], ["بوصة", "in"]);
  const machineMaterial = selected.raw_material_type?.trim().toUpperCase();
  const productMaterial = product.raw_material?.trim().toUpperCase();
  if (stage === "film" && machineMaterial && machineMaterial !== "MIX" &&
      !machineMaterial.split(/[\\/]/).some(material => material.trim() === productMaterial))
    throw new ProductionError("المادة الخام لا تطابق الماكينة", "The raw material is incompatible with this machine.");
  if (stage === "printing" && selected.max_print_colors != null &&
      Math.max(product.front_print_colors?.length ?? 0, product.back_print_colors?.length ?? 0) > selected.max_print_colors)
    throw new ProductionError("عدد ألوان المنتج يتجاوز سعة الطابعة", "The product has more colors than this printer supports.");
  return selected;
}
