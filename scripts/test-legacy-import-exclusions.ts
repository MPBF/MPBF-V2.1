import assert from "node:assert/strict";
import { keepCurrentProductDimensions, legacyExclusion, roundProductDimensions } from "./lib/legacy-import-exclusions";

for (const value of [null, "", " ", "0", "0.00", "0.000", "-0.0", "+0"]) {
  assert(legacyExclusion("customer_products", { width: value, thickness: "30" }));
  assert(legacyExclusion("customer_products", { width: "30", thickness: value }));
}
for (const width of ["24.50", "0.5", "20"])
  assert.equal(legacyExclusion("customer_products", { width, thickness: "3.500" }), null);
// Other incomplete dimensions are not permission to discard the product.
assert.equal(legacyExclusion("customer_products", { width: "30", thickness: "30", left_facing: null }), null);
assert.equal(legacyExclusion("customers", { name: "" }), null);
assert(legacyExclusion("customers", { name: "", name_ar: " " }, { excludeUnnamed: true }));
assert.equal(legacyExclusion("customers", { name: "", name_ar: "عميل عربي" }, { excludeUnnamed: true }), null);
assert.equal(legacyExclusion("customers", { name: "English customer", name_ar: "" }, { excludeUnnamed: true }), null);
assert.equal(legacyExclusion("customer_products", { width: "20", thickness: "30" }, { excludeUnnamed: true }), null);
assert(legacyExclusion("users", { display_name: "", display_name_ar: "" }, { excludeUnnamed: true }));
assert.equal(legacyExclusion("users", { display_name_ar: "موظف" }, { excludeUnnamed: true }), null);
assert(legacyExclusion("users", { status: "deleted" }));
assert(legacyExclusion("users", { status: " Deleted " }));
for (const status of ["active", "inactive", null])
  assert.equal(legacyExclusion("users", { status }), null);
const original = { width: "24.50", thickness: "3.500" };
const before = JSON.stringify(original);
legacyExclusion("customer_products", original);
assert.equal(JSON.stringify(original), before);
const current = { width: "24", thickness: "35", left_facing: null, right_facing: "0", cutting_length_cm: "45" };
const source = { ...original, left_facing: "7.50", right_facing: "7.50", cutting_length_cm: "50", notes: "keep source text" };
const sourceBefore = JSON.stringify(source), currentBefore = JSON.stringify(current);
const result = keepCurrentProductDimensions(source, current);
assert.equal(result.preserved, true);
assert.equal(result.pending, null);
for (const [field, value] of Object.entries(current)) assert.equal(result.row[field], value);
assert.equal(result.row.notes, source.notes);
assert.equal(JSON.stringify(source), sourceBefore);
assert.equal(JSON.stringify(current), currentBefore);
const missing = keepCurrentProductDimensions(source, undefined);
assert(missing.pending);
assert.equal(missing.preserved, false);
assert.equal(missing.row, source);
assert(keepCurrentProductDimensions(source, { width: "0", thickness: "30" }).pending);
assert.equal(keepCurrentProductDimensions({ width: "24", thickness: "35" }, undefined).pending, null);
const measured = {
  width: "13.50", left_facing: "13.49", right_facing: "13.500000000000000001",
  thickness: "2.499999999999999999", cutting_length_cm: "150.9",
  density: "0.95", unit_weight_kg: "0.025", notes: "1.5 should remain text",
};
const measuredBefore = JSON.stringify(measured), rounded = roundProductDimensions(measured);
assert.deepEqual(rounded.row, { ...measured, width: "14", left_facing: "13", right_facing: "14", thickness: "2", cutting_length_cm: "151" });
assert.equal(rounded.changes.length, 5);
assert.equal(JSON.stringify(measured), measuredBefore);
assert.equal(roundProductDimensions({ width: "9007199254740992.5" }).row.width, "9007199254740993");
assert.equal(roundProductDimensions({ width: "-0.4" }).row.width, "-0.4");
assert(legacyExclusion("customer_products", roundProductDimensions({ width: "0.4", thickness: "30" }).row));
assert.equal(roundProductDimensions(result.row).changes.length, 0);
console.log("PASS approved import exclusions: blank/zero dimensions, deleted users, decimals retained, unrelated rows and originals unchanged");
console.log("PASS current dimensions: complete dimension set preserved, unrelated fields unchanged, absent/invalid current rows stay pending without invented values");
console.log("PASS approved rounding and nameless exclusions: exact decimal rounding, named rows retained, no rounding of density/weights/text");
