---
name: Product calculation provenance
description: Evidence behind migrated product size and cylinder calculations; distinguish historical reconstruction from factory-approved weight physics.
---

The supplied historical customer-product UI did not include its size-caption generator, cylinder-option generator, or cutting-length calculation. The adopted size pattern (width plus nonzero gussets, then length) and inch-to-cm rounded cylinder conversion were reconstructed from historical product examples, not recovered original implementation.

**Why:** The user approved extending the current form compatibly, not blindly copying an incomplete legacy component. Historical cutting lengths can differ from a fresh cylinder conversion; replacing them during unrelated edits would alter production specifications.

**How to apply:** Treat untouched stored cutting lengths as authoritative during edits. If factory rules are clarified later, revise the reconstruction explicitly rather than claiming the original attachment established it. The separately documented universal-thickness × two-layer bag-weight formula has explicit factory-agreed provenance and must not be conflated with the separate Tools calculator's product-type exclusions.

Dropdown ranges are selection presets, not retroactive factory validity limits.

Stored printing-cylinder values can include a trailing inch mark, such as `18"`, rather than a bare numeric string.

**Why:** A read-only check of actual customer-product data confirmed this legacy format after the operator board displayed recorded cylinders as missing.

**How to apply:** Normalize inch marks when interpreting cylinder measurements; do not rewrite saved product or execution-snapshot values as part of a display fix.

**Why:** The user requested preferred lists as a refinement to the approved legacy-compatible form, not a data migration or stricter backend limits. Historical dimensions and densities outside those presets must remain editable without silently changing them.

**How to apply:** Retain the current historical value as an option. A zero cutting-length choice means unspecified (null on save), not a physical zero-length product; this reconciles the requested 0–300 list with the existing positive-length-or-unspecified business rule.

Packaging weight choices displayed in grams are a presentation change, not a storage-unit migration.

**Why:** The user requested more convenient gram-based choices in this form, not changes to existing product records or downstream package-weight calculations.

**How to apply:** Keep the saved weight and calculation inputs in their established kilogram units, with gram labels in the selector. Do not multiply stored historical weights as part of a UI-only refinement.

A product's selected category must remain explicit, even when its item belongs to a catalog category.

**Why:** Legacy products can have an unspecified category despite a categorized item. Inferring that category silently changes category-sensitive cutting and weight calculations, disagreeing with the form's preview and the user's selection.

**How to apply:** Do not auto-assign a category during creation, cloning, editing, or embedded order creation. Any future auto-selection rule must also appear in the shared form and explicitly address historical products.