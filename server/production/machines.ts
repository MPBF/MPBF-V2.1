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

export async function machine(tx: Connection, id: string, stage: ProductionStage, product: ProductSnapshot) {
  const selected = await one<ProductionMachine & {
    raw_material_type: string | null; max_print_colors: number | null;
    min_cylinder_inch: string | null; max_cylinder_inch: string | null;
    min_length_cm: string | null; max_length_cm: string | null;
  }>(tx, "SELECT * FROM machines WHERE id=$1 FOR SHARE", [id]);
  if (machineStage(selected.type) !== stage || selected.status !== "active")
    throw new ProductionError("اختر ماكينة نشطة من نوع المرحلة الصحيح", "Select an active machine of the correct stage type.");
  const inRange = (value: string | number | null, min: string | null, max: string | null) => {
    if (min == null && max == null) return true;
    const n = value == null || String(value).trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) && (min == null || n >= Number(min)) && (max == null || n <= Number(max));
  };
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
  if (stage !== "cutting" && !inRange(product.width, selected.min_width_cm, selected.max_width_cm) ||
      stage === "film" && !inRange(thickness, selected.min_thickness, selected.max_thickness) ||
      stage === "cutting" && !inRange(product.cutting_length_cm, selected.min_length_cm, selected.max_length_cm) ||
      stage === "printing" && !inRange(printingCylinderInches(product.printing_cylinder), selected.min_cylinder_inch, selected.max_cylinder_inch))
    throw new ProductionError("مواصفات المنتج خارج حدود الماكينة أو غير مكتملة", "The product specifications are missing or outside the machine limits.");
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