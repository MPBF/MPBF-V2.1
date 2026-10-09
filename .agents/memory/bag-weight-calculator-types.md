---
name: Bag-weight calculator type semantics
description: The Tools-page bag weight calculator's 6 product types, their exclusion/layer rules, and how roll records map onto the bag_weight_records API.
---

The bag-weight tool supports 6 types: hanger (علاقي), banana (بنانة), trash (نفايات), table-cover (مفرش سفرة), roll-tube, roll-sheet. Legacy stored values (no-handle/flat/side-gusset) migrate to trash on read.

**Rules:**
- hanger: hanger height auto-added to length; die-cut exclusion ≈ 0.3×width × 0.7×hangerHeight; 2 layers.
- banana: fixed 9×2 cm (18 cm²) grip cut excluded for all sizes; 2 layers.
- trash: no exclusion; density auto-sets to 1.15 on select (editable); gusset allowed; 2 layers.
- table-cover: open sheet W×L, 1 layer.
- rolls: no length input; g/m = width×100×layers×t_cm×density (tube 2 layers, sheet 1).

**Why:** these are the factory's agreed physics; changing exclusions/layers silently changes quoted weights and costs.

**How to apply:** roll records reuse the existing bag_weight_records API without schema change by storing gramsPerBag = g/m, bagsPerKg = m/kg, lengthCm = 100 (i.e. "one bag" = one linear meter). The shared onBagWeight feed to Order Cost tabs emits 0 for roll types — Order Cost shows a manual-entry hint when shared weight is 0, don't treat 0 as a real weight.
