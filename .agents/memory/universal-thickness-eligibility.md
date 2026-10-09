---
name: Universal thickness film eligibility
description: Film machine min/max_thickness capability is matched against the order's universal_thickness, not raw thickness.
---

# Universal thickness drives film thickness eligibility

A film machine's `min_thickness` / `max_thickness` capability range (set on the
machine definitions page) is compared against the order's **`universal_thickness`**
(السماكة العالمية), NOT the raw `customer_products.thickness`.

**Why:** The business defines machine thickness limits in terms of the
single-layer "universal" thickness, which differs from the flattened product
thickness. `universal_thickness` is a DB-side STORED generated column on
`customer_products`, now wrapped in `CEIL(...)` (whole-number microns, no decimals):
- flat bag (both side gussets 0/null): `CEIL(thickness / 2 * 10)`
- gusseted bag (both sides > 0): `CEIL(thickness / 4 * 10)`
- any other case: falls back to the flat formula.

Because the value is ceiled, eligibility boundaries shifted slightly (e.g. a 35µm
gusseted product is now 88, not 87.5). Changing this generated expression requires
DROP COLUMN + re-ADD (Postgres can't alter a generation expression in place);
drizzle-kit push won't do it on an existing DB, so run the ALTER via SQL manually.

**How to apply:** When touching film smart-distribution eligibility or manual
assignment, match thickness via `universal_thickness`. The enriched-PO column
list must select `cp.universal_thickness` so order rows carry it, and the
product-type grouping key must key on `universal_thickness` (not raw thickness)
to stay aligned with the eligibility predicate. Absent/NaN values must never
block (numInRange passes on NaN).
