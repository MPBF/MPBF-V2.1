---
name: Number display formatting
description: How displayed numbers are formatted app-wide (thousands separators) and which raw toFixed sites must NOT be grouped.
---

# Number display formatting

Displayed numbers across the app must use Latin/English digits and thousands separators (e.g. `1,000`).

Outside the film operator board, decimal values show 0–2 fractional digits:
omit the decimal point for whole numbers, strip trailing zeros, and retain up
to two meaningful decimal places.

The film operator board must always round numeric display values to the nearest
whole number, without changing raw quantities, saved weights or weight-entry
precision.

**Why:** the user corrected the returning decimal display and explicitly chose
«عدد صحيح بلا كسور: 12.34 تصبح 12».

**How to apply:** treat this as the film-board exception to the normal precision
rule. Calculate remaining production from raw quantities before rounding for
display, not by subtracting already-rounded labels.

Use the current central display helper when available; do not assume the
historical camel-case helper filenames still exist. Display formatting must
group thousands, keep Latin digits, and handle DB decimal strings without
changing the raw numeric value. Use a deliberate fixed-precision formatter
only for values whose display explicitly requires that precision.

**Why:** the user explicitly confirmed app-wide English numerals and a maximum of two decimals, shown only when the value has a fractional part. Central helpers prevent inconsistent screens.

**How to apply / do NOT group these `toFixed` sites** (leave as-is):
- CSS/style values (width/height/left/top/transform/progress-bar widths).
- GPS coordinates (lat/lng/latitude/longitude) — commas corrupt them.
- Values not rendered as visible text: object-literal values, API request bodies, setState payloads, anything assigned to a key/variable.
- Percentages, hours, per-unit/gram weights, thickness (micron), dimensions (cm), small ratios — grouping is invisible/meaningless.
- Three.js / 3D scene positions.

**Gotcha:** never re-parse a formatter's output with `parseFloat`/`Number` — grouped output contains commas, so `parseFloat("1,234.5")` returns `1`. `formatNumberWithCommas` used to do this and was fixed to parse the raw value.
