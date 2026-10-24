const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeReceiptFixture, validateReceiptPages } = require("../scripts/lib/receipt-pagination.cjs");

const fixture = makeReceiptFixture(2, "en");
const headers = "Line Production order Customer Item Received quantity (kg)";
const rows = fixture.items.map(item =>
  `${item.line_number} ${item.production_order_number} ${item.quantity_kg} kg`);
const closing = "Voucher total: 3.50 kg\nNotes: END-NOTES-67\nReleased by · production hall\nReceived by · finished-goods hall";
const valid = `${fixture.voucher_number}\n${headers}\n${rows.join("\n")}\n${closing}`;

test("fixture matrix is synthetic, bounded and contains kg only", () => {
  for (const language of ["ar", "en"]) {
    const receipt = makeReceiptFixture(100, language);
    assert.equal(receipt.items.length, 100);
    assert.equal(new Set(receipt.items.map(item => item.item_id)).size, 100);
    assert.ok(receipt.items.every(item=>item.quantity_kg && !("packing" in item) && !("packaging" in item)));
  }
  for (const count of [0, 101, -1, 1.5, NaN]) assert.throws(() => makeReceiptFixture(count, "en"));
});

test("PDF text contract accepts complete single and multiple pages", () => {
  validateReceiptPages([valid], fixture, "en");
  validateReceiptPages([
    `${fixture.voucher_number}\n${headers}\n${rows[0]}`,
    `${headers}\n${rows[1]}\n${closing}`,
  ], fixture, "en");
  // A complete closing-only page is legitimate, unlike a blank or stamp-only page.
  validateReceiptPages([valid.replace(`\n${closing}`, ""), closing], fixture, "en");
});

test("Arabic header extraction may relocate parentheses but must preserve all unit letters", () => {
  const receipt=makeReceiptFixture(1,"ar");
  const page=`${receipt.voucher_number}\nم أمر الإنتاج العميل الصنف )الكمية المستلمة (كجم
1 ${receipt.items[0].production_order_number} 1.25 kg
إجمالي السند: 1.25 kg
END-NOTES-67
التسليم · صالة الإنتاج
الاستلام · صالة المواد التامة`;
  validateReceiptPages([page],receipt,"ar");
  assert.throws(()=>validateReceiptPages([page.replace("كجم","")],receipt,"ar"));
});

test("PDF text contract rejects missing, duplicated, reordered or split lines", () => {
  for (const broken of [
    valid.replace(rows[0], ""), valid.replace(rows[0], `${rows[0]}\n${rows[0]}`),
    valid.replace(rows.join("\n"), [...rows].reverse().join("\n")),
    valid.replace("1.25", ""),
  ]) assert.throws(() => validateReceiptPages([broken], fixture, "en"));
});

test("PDF text contract rejects incomplete and unrepeated column headings", () => {
  assert.throws(() => validateReceiptPages([valid.replace("Received quantity (kg)", "")], fixture, "en"));
  assert.throws(() => validateReceiptPages([
    `${fixture.voucher_number}\n${headers}\n${rows[0]}`, `${rows[1]}\n${closing}`,
  ], fixture, "en"));
});

test("English documents allow only the explicitly bilingual factory name", () => {
  validateReceiptPages([`مصنع الاختبار\n${valid}`], fixture, "en", "مصنع الاختبار");
  assert.throws(() => validateReceiptPages([`مصنع الاختبار\nعميل عربي\n${valid}`], fixture, "en", "مصنع الاختبار"));
});

test("PDF text contract rejects wrong totals, missing or duplicated signatures and notes", () => {
  for (const broken of [
    valid.replace("3.50 kg", "3.25 kg"),
    valid.replace("Released by · production hall", ""),
    valid.replace("Received by · finished-goods hall", ""),
    `${valid}\nReceived by · finished-goods hall`,
    valid.replace("END-NOTES-67", ""),
  ]) assert.throws(() => validateReceiptPages([broken], fixture, "en"));
});

test("PDF text contract rejects extra blank, header-only and signature-only pages", () => {
  for (const extra of ["", " \n ", headers, "Received by · finished-goods hall"]) {
    assert.throws(() => validateReceiptPages([valid, extra], fixture, "en"));
  }
});
