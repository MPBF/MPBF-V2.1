import assert from "node:assert/strict";
import { legacyExclusion } from "./lib/legacy-import-exclusions";

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
console.log("PASS approved import exclusions: blank/zero dimensions, deleted users, decimals retained, unrelated rows and originals unchanged");
