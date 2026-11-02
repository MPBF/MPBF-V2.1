---
name: Table column width verification
description: Verify compact audit columns against the original layout in both languages.
---
For requests to reduce an auto-layout table column, compare rendered widths
with the previous styles in Arabic and English; do not require the CSS width
to equal the final measured width.

**Why:** A table's minimum width distributes surplus space, and English leave
badges have different intrinsic widths. A compact column can genuinely shrink
while still measuring wider than its declared width.

**How to apply:** Measure before/after at phone, tablet and desktop widths.
Keep full dates and leave badges readable rather than clipping them solely
to satisfy an arbitrary pixel threshold.
