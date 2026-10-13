// Fixture-only print coverage. The caller owns the disposable browser and directory.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const labels = {
  en: {
    headers: ["Line", "Production order", "Received quantity (kg)"],
    total: "Voucher total", signatures: ["Released by · production hall", "Received by · finished-goods hall"],
  },
  ar: {
    headers: ["م", "أمر الإنتاج", "الكمية المستلمة (كجم)"],
    total: "إجمالي السند", signatures: ["التسليم · صالة الإنتاج", "الاستلام · صالة المواد التامة"],
  },
};

// Poppler's logical layout can invert the lam-alef ligature in Chromium's Arabic
// glyphs. Normalize that pair on both sides, not the rest of the Arabic text.
const normalize = text => text.normalize("NFKC")
  .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
  .replace(/ل([اأإآ])/g, "$1ل").replace(/\s+/g, " ").replace(/\s*:\s*/g, ": ").trim();
const tokenCount = (text, token) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"))].length;
};

function makeReceiptFixture(count, language) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 100);
  return {
    id: 670, voucher_number: `TEST-67-${language}-${count}`,
    created_at: "2026-10-11T06:00:00Z", created_by: 670,
    notes: language === "en" ? "Fixture notes only.\nEND-NOTES-67" : "ملاحظات اختبار فقط.\nEND-NOTES-67",
    items: Array.from({ length: count }, (_, index) => {
      const line = index + 1, suffix = String(line).padStart(3, "0");
      const item = { line_number: line, production_order_id: 670000 + line,
        production_order_number: `T67JO${suffix}`, item_id: `T67IT${suffix}`,
        quantity_kg: `${line}.25` };
      return item;
    }),
  };
}

function validateReceiptPages(pages, receipt, language) {
  const context = `${language}/${receipt.items.length} lines`;
  const normalized = pages.map(normalize), whole = normalized.join(" ");
  const expected = labels[language];
  const contains = (text, value) => text.includes(normalize(value));
  assert.equal(tokenCount(whole, receipt.voucher_number), 1, `${context}: voucher identity`);
  const seen = [];
  for (const [index, text] of normalized.entries()) {
    assert.ok(text, `${context}: blank page ${index + 1}`);
    const rows = text.match(/\bT67JO\d{3}\b/g) || [];
    seen.push(...rows);
    assert.ok(rows.length || contains(text, expected.total), `${context}: header-only/orphan page ${index + 1}`);
    if (rows.length) {
      for (const header of expected.headers) {
         // RTL extraction may move a parenthesis to the other end of a
         // heading despite a correct rendered PDF. Retain every label/unit
         // token and verify physical header positions independently below.
         const headerText = normalize(header).replace(/[()]/g, "");
         const pageText = text.replace(/[()]/g, "");
         assert.ok(headerText.split(" ").every(word => pageText.includes(word)),
          `${context}: missing header "${header}" on page ${index + 1}`);
      }
    }
  }
  assert.deepEqual(seen, receipt.items.map(item => item.production_order_number),
    `${context}: every ordered row must appear exactly once`);
  for (const item of receipt.items) {
    assert.equal(tokenCount(whole, item.production_order_number), 1, `${context}: order once`);
    const rowPage = normalized.find(text => text.includes(item.production_order_number));
    // The independent fixture total includes fractional kg and thousands grouping.
    const quantity = new Intl.NumberFormat("en-GB").format(Number(item.quantity_kg));
    assert.ok(rowPage.includes(quantity), `${context}: missing row weight ${item.line_number}`);
  }
  const final = normalized.at(-1);
  const total = receipt.items.length * (receipt.items.length + 1) / 2 + receipt.items.length / 4;
  const number = new Intl.NumberFormat("en-GB", {minimumFractionDigits:2,maximumFractionDigits:2}).format(total);
  assert.ok(pages.at(-1).split("\n").some(line =>
    contains(line, expected.total) && normalize(line).includes(`${number} kg`)),
  `${context}: full exact total on final page`);
  assert.equal(whole.split(normalize(expected.total)).length - 1, 1, `${context}: total once`);
  assert.equal(tokenCount(whole, "END-NOTES-67"), 1, `${context}: notes once`);
  assert.ok(final.includes("END-NOTES-67"), `${context}: complete closing notes`);
  for (const signature of expected.signatures) {
    assert.ok(contains(final, signature), `${context}: complete signature "${signature}" on final page`);
    assert.equal(whole.split(normalize(signature)).length - 1, 1, `${context}: signature once`);
  }
  if (language === "en") assert.ok(!/[\u0600-\u06ff]/.test(whole), `${context}: English PDF contains Arabic`);
}

function inspectReceiptPdf(file, receipt, language) {
  const info = execFileSync("pdfinfo", ["-box", file], { encoding: "utf8" });
  const count = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  const pages = text.split("\f");
  if (!pages.at(-1).trim()) pages.pop(); // Poppler's terminal separator is not a PDF page.
  assert.equal(pages.length, count, "Extracted pages must match actual PDF page count");
  validateReceiptPages(pages, receipt, language);
  // Check physical A4 dimensions and glyph bounds on *every* page, not the DOM.
  const bbox = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const pageBoxes = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
  assert.equal(pageBoxes.length, count);
  for (const [index, page] of pageBoxes.entries()) {
    const width = Number(page[1]), height = Number(page[2]);
    assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, "Portrait A4 required");
    for (const word of page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">/g)) {
      const [x1, y1, x2, y2] = word.slice(1).map(Number);
      assert.ok(x1 >= 33 && y1 >= 33 && x2 <= width - 33 && y2 <= height - 33,
        `${language}/${receipt.items.length}: clipped glyph on page ${index + 1}`);
    }
    const words = [...page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g)]
      .map(word => ({ x: (Number(word[1]) + Number(word[3])) / 2, y: Number(word[2]),
        text: word[5].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/[\u0600-\u06ff]+/g, run => [...run].reverse().join("")) }));
    const firstRow = words.find(word => /^T67JO\d{3}$/.test(word.text));
    if (firstRow) {
      // Headings must exist in their own PDF columns above the first row.
      // This cannot be satisfied by a duplicate word elsewhere in the document.
       const widths = [9, 61, 30];
      let start = 0;
      for (const [column, percentage] of widths.entries()) {
        const finish = start + percentage;
        const cell = words.filter(word => {
          const position = 100 * (language === "en" ? word.x - 34 : width - 34 - word.x) / (width - 68);
          return position >= start - 0.5 && position <= finish + 0.5 &&
            word.y < firstRow.y - 2 && word.y >= firstRow.y - 45;
        }).map(word => normalize(word.text).replace(/[()]/g, "")).join(" ");
        for (const token of normalize(labels[language].headers[column]).replace(/[()]/g, "").split(" ")) {
          assert.ok(cell.includes(token),
            `${language}/${receipt.items.length}: missing PDF header token "${token}" in column ${column + 1}, page ${index + 1}`);
        }
        start = finish;
      }
    }
  }
  return count;
}

async function checkReceiptPagination({ temp, open, wait, evaluate, send }) {
  const directory = path.join(temp, "receipt-pagination");
  await fs.mkdir(directory, { recursive: true });
  const results = [];
  for (const language of ["ar", "en"]) {
    const pageCounts = [];
    // Exhaustive counts include the immediate neighbours of every actual page
    // transition, even if font metrics move the boundary between environments.
    for (let count = 1; count <= 100; count++) {
      await open(`/fixture-receipt?language=${language}&lines=${count}`);
      await wait(`document.documentElement?.lang===${JSON.stringify(language)} && document.querySelectorAll('tbody tr').length===${count}`);
      await evaluate("document.fonts.ready.then(()=>true)");
      const pdf = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true,
        displayHeaderFooter: false });
      const file = path.join(directory, `pagination-${language}-${count}.pdf`);
      await fs.writeFile(file, Buffer.from(pdf.data, "base64"));
      pageCounts.push(inspectReceiptPdf(file, makeReceiptFixture(count, language), language));
    }
    const boundaries = pageCounts.flatMap((pages, index) =>
      index && pages !== pageCounts[index - 1] ? [index + 1] : []);
    assert.ok(boundaries.length && pageCounts.at(-1) > 1, `${language}: long receipts must span pages`);
    console.log(`PASS ${language} actual receipt PDFs: all 1–100 rows; page transitions at ${boundaries.join(", ")}; 100 rows = ${pageCounts.at(-1)} pages`);
    results.push({ language, boundaries, pageCounts });
  }
  await fs.writeFile(path.join(directory, "summary.json"), JSON.stringify(results, null, 2));
}

module.exports = { makeReceiptFixture, validateReceiptPages, inspectReceiptPdf, checkReceiptPagination };
