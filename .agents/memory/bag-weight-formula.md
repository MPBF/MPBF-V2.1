---
name: Customer-product bag weight formula
description: The factory's authoritative bag-weight / bags-per-kilo formula for customer_products, and which thickness to use.
---

# Customer-product bag weight formula

`bag_weight_grams` and `bags_per_kilo` on `customer_products` are computed as:

```
flatWidthCm        = width + left_facing + right_facing   (includes both side gussets)
universalMicrons   = (left_facing>0 AND right_facing>0) ? thickness/4*10 : thickness/2*10
grams              = flatWidthCm * cutting_length_cm * 2 (layers) * (universalMicrons * 1e-4) * density
bags_per_kilo      = 1000 / grams        (null when grams <= 0)
```

- **Use the *universal* thickness, NOT the raw `thickness`.** `universal_thickness`
  is a generated DB column (computed, hidden from the UI) — the same CASE as above.
  The raw `thickness` field is a factory press value, not real microns.
- **Always include the ×2 layers factor** (front + back wall of the bag).
- **All three columns are whole numbers, rounded UP (CEIL), no decimals.** `universal_thickness`
  generated column = `CEIL(CASE …)`; `bag_weight_grams` and `bags_per_kilo` = `Math.ceil(...)`
  (storage + frontend) / `CEIL(...)` (SQL backfill). To stay consistent, the JS weight calc
  ceils `universalMicrons` first, so weight derives from the integer universal thickness.
- `density` defaults to 0.95. (Columns are still decimal type but hold integer values.)
- The SQL backfill in server/index.ts can reference the generated `universal_thickness`
  column directly; the JS (storage + frontend useMemo) recomputes it from
  thickness+facings to mirror the column.

**Why:** The factory-correct weight uses **universal thickness × 2 layers**. Two wrong
variants to avoid: universal thickness WITHOUT the ×2 layers factor (gives half the
weight), and raw `thickness` WITH ×2 (wrong thickness basis). The business basis is the
computed universal thickness, never the raw thickness.

**How to apply:** Note `universal_thickness` is dual-purpose — it also drives film-machine
eligibility matching (see universal-thickness-eligibility.md). Don't confuse "use raw
thickness" with weight; weight always uses universal thickness. Keep storage, frontend
preview, and the migration backfill in lockstep when the formula changes.
