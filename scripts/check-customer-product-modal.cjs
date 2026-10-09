// Mocked browser regression check; no database records are created or changed.
// Requires Playwright/Chromium, or PLAYWRIGHT_MODULE and CHROMIUM_PATH overrides.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "customer-product-modal-"));
  let browser;
  try {
    await esbuild.build({
      stdin: { contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import Modal from "./client/src/components/CustomerProductModal";
        const row = JSON.parse(new URLSearchParams(location.search).get("row") || "{}");
        createRoot(document.getElementById("root")).render(<Modal row={row}
          onSaved={() => { window.saved = true; }}
          onClose={() => { window.closed = true; }} />);
      `, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, jsx: "automatic", platform: "browser", outfile: path.join(temp, "fixture.js"),
      logLevel: "silent",
    });
    const js = await fs.readFile(path.join(temp, "fixture.js"), "utf8");
    const css = await fs.readFile(path.join(temp, "fixture.css"), "utf8");
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = {
      "/api/customers": [
        { id: 1, name_ar: "عميل تجريبي", name: "Test Customer" },
        { id: 2, name_ar: "عميل آخر", name: "Other Customer" },
      ],
      "/api/categories": [{ id: "CAT01", name_ar: "أكياس بنانة" }],
      "/api/items": [],
      "/api/master-batch-colors": [],
      "/api/customer-products/form-options": { printing_cylinders: ['20"'] },
    };
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/__cp-check") return route.fulfill({
        contentType: "text/html", body: `<html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"><style>${css}</style></head><body><div id="root"></div><script src="/__cp-check.js"></script></body></html>`,
      });
      if (url.pathname === "/__cp-check.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname.startsWith("/api/customer-products") && route.request().method() !== "GET") {
        writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
        return route.fulfill({ json: { id: 99 } });
      }
      if (data[url.pathname]) return route.fulfill({ json: data[url.pathname] });
      return route.continue();
    });
    const open = async (width, row = {}) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/__cp-check?row=${encodeURIComponent(JSON.stringify(row))}`);
      await page.locator("#cp-right").waitFor();
    };
    const save = async () => {
      await page.locator(".cp-save").click();
      if (await page.getByRole("button", { name: "الاستمرار في الحفظ" }).count()) {
        await page.getByRole("button", { name: "الاستمرار في الحفظ" }).click();
      }
      await page.waitForFunction(() => window.saved === true);
    };
    for (const width of [390, 768, 1024]) {
      await open(width);
      assert.equal(await page.getByRole("combobox", { name: "ابحث عن العميل بالاسم أو الرقم" }).count(), 0);
      await page.getByRole("button", { name: "اختر العميل" }).click();
      const search = page.getByRole("combobox", { name: "ابحث عن العميل بالاسم أو الرقم" });
      await search.fill("other");
      assert.equal(await page.getByRole("option", { name: /Other Customer/ }).count(), 1);
      await search.press("Enter");
      assert.match(await page.locator("#cp-customer").innerText(), /Other Customer/);
      await page.locator("#cp-customer").click();
      await search.fill("لا توجد نتيجة");
      assert.equal(await page.getByRole("listbox", { name: "العملاء" }).getByRole("option").count(), 0);
      await search.press("Escape");
      assert.equal(await page.locator('[role="dialog"]').count(), 1);
      assert.equal(await page.locator("#cp-customer").getAttribute("aria-expanded"), "false");
      await page.locator("#cp-customer").click();
      await search.fill("1");
      await search.press("ArrowDown");
      await search.press("Enter");
      assert.match(await page.locator("#cp-customer").innerText(), /Test Customer/);
      await page.locator("#cp-customer").click();
      await search.press("Tab");
      assert.equal(await page.locator("#cp-customer").getAttribute("aria-expanded"), "false");
      assert(await page.locator("#cp-category").evaluate((el) => document.activeElement === el));
      await page.locator("#cp-category").selectOption("CAT01");
      for (const [id, min, max] of [["cp-right", 0, 50], ["cp-left", 0, 50], ["cp-width", 10, 100], ["cp-thickness", 1, 60], ["cp-cut-length", 0, 300]]) {
        const values = await page.locator(`#${id} option`).evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
        assert.deepEqual(values, Array.from({ length: max - min + 1 }, (_, i) => String(i + min)));
      }
      assert.deepEqual(await page.locator("#cp-density option").evaluateAll((options) => options.map((o) => o.value).filter(Boolean)), ["0.95", "1", "1.15"]);
      await page.locator("#cp-right").selectOption("5");
      await page.locator("#cp-width").selectOption("30");
      await page.locator("#cp-left").selectOption("5");
      await page.locator("#cp-thickness").selectOption("20");
      await page.locator("#cp-density").selectOption("1.15");
      await page.locator("#cp-cut-length").selectOption("50");
      assert.equal(await page.locator(".cp-packaging #cp-cut-unit").count(), 1);
      const packagingLabels = await page.locator(".cp-packaging .cp-field label").allTextContents();
      assert.deepEqual(packagingLabels.slice(0, 3), ["الوحدة", "وزن الوحدة (جرام)", "التعبئة / عبوة"]);
      assert.deepEqual(await page.locator("#cp-cut-unit option").evaluateAll((options) => options.map((o) => o.value).filter(Boolean)), ["كيلو", "رول", "باكت", "كيس", "كرتون"]);
      assert.deepEqual(await page.locator("#cp-unit-weight option").evaluateAll((options) => options.filter((o) => o.value).map((o) => o.textContent)), Array.from({ length: 59 }, (_, i) => `${100 + i * 50} جرام`));
      assert.deepEqual(await page.locator("#cp-unit-quantity option").evaluateAll((options) => options.map((o) => o.value).filter(Boolean)), Array.from({ length: 25 }, (_, i) => String(i + 1)));
      await page.locator("#cp-cut-unit").selectOption("باكت");
      await page.locator("#cp-unit-weight").selectOption("0.15");
      await page.locator("#cp-unit-quantity").selectOption("25");
      assert.equal(await page.locator(".cp-packaging .cp-readonly").innerText(), "3.75");
      assert.equal(await page.locator(".cp-dimensions .cp-readonly").innerText(), "30+5+5X50");
      await page.locator("#cp-cylinder").selectOption('20"');
      assert.equal(await page.locator("#cp-cut-length").inputValue(), "51");
      assert(await page.locator("#cp-cut-length").isDisabled());
      await page.locator("#cp-cylinder").selectOption("");
      await page.locator("#cp-cut-length").selectOption("0");
      assert.equal(await page.locator(".cp-dimensions .cp-readonly").innerText(), "—");
      await page.locator("#cp-cut-length").selectOption("50");
      const layout = await page.evaluate(() => {
        const fields = (selector) => [...document.querySelectorAll(`${selector} .cp-field`)].map((el) => ({
          label: el.querySelector("label").textContent,
          top: Math.round(el.getBoundingClientRect().top),
          left: el.getBoundingClientRect().left,
        }));
        return { dimensions: fields(".cp-dimensions"), specifications: fields(".cp-specifications"),
          overflow: [...document.querySelectorAll(".cp-modal,.cp-body")].some((el) => el.scrollWidth > el.clientWidth + 1) };
      });
      assert.deepEqual(layout.dimensions.map((f) => f.label), ["الجانب الأيمن", "العرض (سم)", "الجانب الأيسر", "وصف المقاس المحسوب"]);
      assert.deepEqual(layout.specifications.map((f) => f.label), ["السماكة (ميكرون)", "الكثافة", "التخريم", "وزن الكيس (جرام)", "عدد الأكياس في الكيلو"]);
      assert.equal(layout.overflow, false);
      if (width === 1024) {
        assert.equal(new Set(layout.dimensions.map((f) => f.top)).size, 1);
        assert.equal(new Set(layout.specifications.map((f) => f.top)).size, 1);
        assert(layout.dimensions.every((f, i, a) => i === 0 || a[i - 1].left > f.left));
        await page.locator(".cp-body").evaluate((el) => el.scrollTop = 0);
        await page.screenshot({ path: "/tmp/customer-product-dropdowns-desktop.png" });
      }
      await page.locator("#cp-left").selectOption("4");
      const writesBeforeWarning = writes.length;
      await page.locator(".cp-save").click();
      const warning = page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" });
      await warning.waitFor();
      assert.equal(writes.length, writesBeforeWarning);
      assert(await warning.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      if (width === 1024) await page.screenshot({ path: "/tmp/customer-product-facing-warning-desktop.png" });
      await page.getByRole("button", { name: "العودة للتعديل" }).click();
      await page.locator("#cp-left").selectOption("5");
      await save();
      assert.equal(writes.at(-1).body.customer_id, "1");
      assert.equal(writes.at(-1).body.cutting_length_cm, 50);
      assert.equal(writes.at(-1).body.cutting_unit, "باكت");
      assert.equal(writes.at(-1).body.unit_weight_kg, "0.15");
      assert.equal(writes.at(-1).body.unit_quantity, 25);
      console.log(`PASS: search, keyboard, lists, calculations, layout, save at ${width}px`);
    }
    await open(1024);
    await page.locator("#cp-customer").click();
    await page.getByRole("option", { name: /Test Customer/ }).click();
    await page.locator("#cp-cut-length").selectOption("0");
    await save();
    assert.equal(writes.at(-1).body.cutting_length_cm, null);
    await open(1024, { customer_id: 1 });
    await page.locator("#cp-width").selectOption("30");
    await page.locator("#cp-right").selectOption("5");
    await page.locator("#cp-left").selectOption("4");
    const beforeWarning = writes.length;
    await page.locator(".cp-save").click();
    await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor();
    assert.equal(writes.length, beforeWarning);
    await page.getByRole("button", { name: "العودة للتعديل" }).click();
    await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).count(), 0);
    assert.equal(writes.length, beforeWarning);
    await page.locator(".cp-save").click();
    await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor();
    await page.locator("#cp-left").selectOption("5");
    await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).count(), 0);
    await page.locator("#cp-width").selectOption("10");
    await page.locator(".cp-save").click();
    await page.getByRole("alert").filter({ hasText: "مجموع الجانب الأيمن والجانب الأيسر" }).waitFor();
    assert.equal(writes.length, beforeWarning);
    assert.equal(await page.getByRole("button", { name: "الاستمرار في الحفظ" }).count(), 0);
    await page.locator("#cp-right").selectOption("6");
    await page.locator(".cp-save").click();
    assert.equal(writes.length, beforeWarning);
    await page.locator("#cp-width").selectOption("30");
    await save();
    assert.equal(writes.length, beforeWarning + 1);
    const historic = { id: 17, customer_id: 1, width: "150", right_facing: "55", left_facing: "52", thickness: "80", density: "0.92", cutting_length_cm: 350, cutting_unit: "بندل", unit_weight_kg: "4.125", unit_quantity: 40, notes: "قديم", punching: "بدون", status: "active", front_print_colors: [], back_print_colors: [] };
    await open(1024, historic);
    for (const [id, value] of [["cp-width", "150"], ["cp-right", "55"], ["cp-left", "52"], ["cp-thickness", "80"], ["cp-density", "0.92"], ["cp-cut-length", "350"], ["cp-cut-unit", "بندل"], ["cp-unit-weight", "4.125"], ["cp-unit-quantity", "40"]]) {
      assert.equal(await page.locator(`#${id}`).inputValue(), value);
      assert.match(await page.locator(`#${id} option:checked`).innerText(), /القيمة الحالية/);
    }
    await page.locator("textarea").fill("تعديل ملاحظات فقط");
    await save();
    assert.equal(writes.at(-1).method, "PUT");
    assert.deepEqual(writes.at(-1).body, { notes: "تعديل ملاحظات فقط" });
    assert.equal(await page.locator("#cp-unit-weight option:checked").innerText(), "القيمة الحالية: 4125 جرام");
    assert.equal(await page.locator(".cp-packaging .cp-readonly").innerText(), "165.00");
    await open(1024, historic);
    await page.locator("#cp-unit-weight").selectOption("3");
    await page.locator("#cp-unit-quantity").selectOption("2");
    await save();
    assert.deepEqual(writes.at(-1).body, { unit_weight_kg: "3", unit_quantity: 2 });
    assert.deepEqual(errors, []);
    console.log("PASS: zero/unset length and historical values preserved on notes-only PUT; no page errors");
  } finally {
    await browser?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });