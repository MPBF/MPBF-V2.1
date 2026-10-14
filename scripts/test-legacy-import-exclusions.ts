import assert from "node:assert/strict";
import { keepCurrentProductDimensions, legacyExclusion } from "./lib/legacy-import-exclusions";

for (const value of [null, "", " ", "0", "0.00", "0.000", "-0.0", "+0"]) {
  assert(legacyExclusion("customer_products", { width: value, thickness: "30" }));
  assert(legacyExclusion("customer_products", { width: "30", thickness: value }));
}
for (const width of ["24.50", "0.5", "20"])
  assert.equal(legacyExclusion("customer_products", { width, thickness: "3.500" }), null);
// Other incomplete dimensions are not permission to discard the product.
assert.equal(legacyExclusion("customer_products", { width: "30", thickness: "30", left_facing: null }), null);
assert.equal(legacyExclusion("customers", { name: "" }), null);
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
console.log("PASS approved import exclusions: blank/zero dimensions, deleted users, decimals retained, unrelated rows and originals unchanged");
console.log("PASS current dimensions: complete dimension set preserved, unrelated fields unchanged, absent/invalid current rows stay pending without invented values");
