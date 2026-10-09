export type MasterBatchColor = {
  color_hex?: unknown;
  name_ar?: unknown;
  name?: unknown;
  id?: unknown;
};

/** Display-only distinction: ordinary white is not a transparent master batch. */
export function isTransparentMasterBatch(color?: MasterBatchColor | null): boolean {
  if (!color) return false;
  const hex = typeof color.color_hex === "string" ? color.color_hex.trim().toLowerCase() : "";
  if (hex === "transparent" || hex === "شفاف" || /^#[0-9a-f]{3}0$/i.test(hex)
    || /^#[0-9a-f]{6}00$/i.test(hex)
    || /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0(?:\.0+)?\s*\)$/i.test(hex)) return true;
  const names = [color.name_ar, color.name, color.id].filter(value => typeof value === "string").join(" ");
  if (/غير\s*شفاف|non[-\s]*transparent|not\s+transparent|opaque/i.test(names)) return false;
  return /شفاف|\btransparent\b/i.test(names);
}