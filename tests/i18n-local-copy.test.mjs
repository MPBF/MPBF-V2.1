import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditEnglish } from "../scripts/lib/i18n-audit.mjs";
import { auditLocalCopy, collectLocalCopy, localCopyKey } from "../scripts/lib/i18n-local-copy.mjs";

const file = "Screen.tsx";
function fixture(t, source, dictionary) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-copy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, file), source);
  return auditLocalCopy(root, dictionary, [file]);
}

test("extracts tuples, both conditional orientations and print labels, not comments", () => {
  const { pairs, errors } = collectLocalCopy(file, `
    // ["تعليق", "Comment"]
    const messages = { title: ["عنوان", "Title"] };
    const copy = { save: en ? "Save" : "حفظ" };
    const direct = ar ? "طباعة" : "Print";
    const html = label("سند", "Voucher");
  `);
  assert.deepEqual(errors, []);
  assert.deepEqual(pairs.map(p => [p.arabic, p.english]), [
    ["عنوان", "Title"], ["حفظ", "Save"], ["طباعة", "Print"], ["سند", "Voucher"],
  ]);
  assert.equal(pairs[0].id, "title");
  assert.equal(pairs[1].id, "save");
});

test("detects local drift even when Arabic coverage still passes", t => {
  const result = fixture(t, `const copy = { retry: ["إعادة المحاولة", "Retry"] };`, { "إعادة المحاولة": "Try again" });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Screen.tsx:1.*screen "Retry", dictionary "Try again"/);
});

test("requires exact punctuation, spaces and capitalization", t => {
  for (const value of ["Loading...", "loading…", "Loading… "]) {
    assert.equal(fixture(t, `const copy = { loading: ["تحميل", "Loading…"] };`, { تحميل: value }).errors.length, 1);
  }
});

test("keeps distinct translations of one Arabic label without changing the generic one", t => {
  const dictionary = {
    "غير مغطى": "Uncovered portion",
    [localCopyKey(file, "غير مغطى", "uncovered")]: "Uncovered",
  };
  const source = `const copy = { uncovered: ["غير مغطى", "Uncovered"], portion: ["غير مغطى", "Uncovered portion"] };`;
  assert.deepEqual(fixture(t, source, dictionary).errors, []);
  assert.match(fixture(t, source.replace('"Uncovered"', '"Not covered"'), dictionary).errors[0], /mismatch/);
  assert.match(fixture(t, source, { ...dictionary, [localCopyKey(file, "غير مغطى", "uncovered")]: "Changed" }).errors[0], /mismatch/);
});

test("rejects stale contextual keys rather than masking removed or renamed copy", t => {
  const dictionary = { عنوان: "Title", [localCopyKey(file, "عنوان", "oldTitle")]: "Title" };
  assert.match(fixture(t, `const copy = { title: ["عنوان", "Title"] };`, dictionary).errors[0], /Stale local-copy context/);
});

test("rejects missing keys, Arabic English values and unsupported dynamic bilingual forms", t => {
  assert.match(fixture(t, `const copy = { title: ["عنوان", "Title"] };`, {}).errors[0], /dictionary null/);
  assert.match(collectLocalCopy(file, `const title = ["عنوان", "English عربي"];`).errors[0], /invalid local English/);
  for (const source of [
    `const title = ["عنوان", english];`,
    `const title = ["عنوان", "Title", "Extra"];`,
    `const title = en ? english : "عنوان";`,
    `const title = label("عنوان", english);`,
  ]) assert.match(collectLocalCopy(file, source).errors[0], /unsupported bilingual/);
});

test("fails closed on absent files or a source format with no recognized copy", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-copy-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(auditLocalCopy(root, {}, [file]).errors[0], /missing local-copy source/);
  assert.match(fixture(t, `const copy = getCopy();`, {}).errors[0], /no bilingual copy found/);
});

test("all five production sources match the actual merged dictionary and preserve its priority", () => {
  const root = path.resolve("client/src");
  const reviews = JSON.parse(fs.readFileSync("scripts/i18n-reviewed-overrides.json", "utf8"));
  const dictionary = auditEnglish(root, reviews);
  assert.deepEqual(dictionary.errors, []);
  assert.deepEqual(dictionary.mergeOrder, [
    "i18n-en-production.ts", "i18n-en-reviewed.ts", "i18n-en-order-workspace.ts", "i18n-en.ts",
  ]);
  const result = auditLocalCopy(root, dictionary.effective);
  assert.deepEqual(result.errors, []);
  assert.ok(result.pairs.length >= 250);
  assert.equal(dictionary.effective["إعادة المحاولة"], "Try again");
  assert.equal(dictionary.effective["غير مغطى"], "Uncovered portion");
});
