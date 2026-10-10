export type CompositionLine = {
  material_id: number; name: string; name_ar: string; quantity_kg: string;
};
export type Composition = {
  total: number | null;
  rows: { key: number; name: string; kg: number; percent: number }[];
};

/** Merge actual kilograms, never percentages or assumed ABA layer ratios. */
export function mixingComposition(lines: CompositionLine[], label: (ar: string, en: string) => string): Composition {
  const empty: Composition = { total: null, rows: [] };
  if (!lines.length) return empty;
  const quantities = lines.map(line => {
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(line.quantity_kg)) return null;
    const [whole, fraction = ""] = line.quantity_kg.split(".");
    const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    return hundredths > 0n ? hundredths : null;
  });
  if (quantities.some(value => value === null)) return empty;
  const total = quantities.reduce<bigint>((sum, value) => sum + value!, 0n);
  const merged = new Map<number, { name: string; weight: bigint }>();
  lines.forEach((line, index) => {
    const previous = merged.get(line.material_id);
    merged.set(line.material_id, { name: label(line.name_ar, line.name), weight: (previous?.weight ?? 0n) + quantities[index]! });
  });
  return {
    total: Number(total) / 100,
    rows: [...merged].map(([key, row]) => ({
      key, name: row.name, kg: Number(row.weight) / 100,
      percent: Number(row.weight) / Number(total) * 100,
    })),
  };
}
