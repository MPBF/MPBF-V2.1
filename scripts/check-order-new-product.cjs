// Mocked browser regression check for new products drafted inside an order.
// All API calls are intercepted; this script never creates or changes database records.
// Requires Playwright/Chromium, or PLAYWRIGHT_MODULE and CHROMIUM_PATH overrides.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "order-new-product-"));
  let browser;
  const failures = [];
  const requests = { orderSaves: [], customerProductWrites: [], details: [] };
  let failNextOrderSave = false;
  let failNextNumber = false, numberPreviews = 0;

  const check = (label, fn) => {
    try {
      fn();
      console.log(`PASS: ${label}`);
    } catch (error) {
      failures.push(`${label}: ${error.stack || error.message}`);
      console.error(`FAIL: ${label}: ${error.stack || error.message}`);
    }
  };
  const checkAsync = async (label, fn) => {
    try {
      await fn();
      console.log(`PASS: ${label}`);
    } catch (error) {
      failures.push(`${label}: ${error.stack || error.message}`);
      console.error(`FAIL: ${label}: ${error.stack || error.message}`);
    }
  };

  try {
    await esbuild.build({
      stdin: { contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import OrderCreateModal from "./client/src/components/OrderCreateModal";
        import i18n from "./client/src/i18n";
        void i18n.changeLanguage(new URLSearchParams(location.search).get("lang") || "ar");
        const editId = Number(new URLSearchParams(location.search).get("editId")) || undefined;
        createRoot(document.getElementById("root")).render(<OrderCreateModal
          editId={editId}
          onSaved={() => { window.saved = (window.saved || 0) + 1; }}
          onClose={() => { window.closed = (window.closed || 0) + 1; }} />);
       `, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, jsx: "automatic", platform: "browser", outfile: path.join(temp, "fixture.js"),
      logLevel: "silent",
    });
    const js = await fs.readFile(path.join(temp, "fixture.js"), "utf8");
    const css = await fs.readFile(path.join(temp, "fixture.css"), "utf8");
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const customers = [
      { id: 1, name_ar: "عميل تجريبي", name: "Test Customer" },
      { id: 2, name_ar: "عميل آخر", name: "Other Customer" },
    ];
    const categories = [
      { id: "CAT01", name_ar: "أكياس بنانة", name: "Banana bags" },
      { id: "MANUAL", name_ar: "سفرة بلاستيكية", name: "Plastic table cover" },
    ];
    const existingProducts = [
      { id: 202, customer_id: 2, category_id: "CAT01", item_id: null, width: "40", thickness: "20", right_facing: "5", left_facing: "5", raw_material: "HDPE", category_name_ar: "أكياس بنانة", item_name_ar: "منتج مسجل", status: "active" },
      { id: 203, customer_id: 2, category_id: "CAT01", width: "50", thickness: "30", right_facing: "5", left_facing: "5", raw_material: "LDPE", category_name_ar: "أكياس بنانة", item_name_ar: "منتج قيد الإنتاج", status: "active" },
    ];
    const editOrder = {
      order: {
        id: 77, order_number: "ORD-077", customer_id: 2,
        created_at: "2025-01-01T10:00:00.000Z", delivery_days: 20,
        delivery_date: "2025-01-21", status: "waiting", notes: "edit fixture",
      },
      items: [
        { id: 701, customer_product_id: 202, quantity_kg: "10", status: "pending", production_order_number: "PO-701" },
        { id: 702, customer_product_id: 203, quantity_kg: "20", status: "in_production", batch_number: "B-702", production_order_number: "PO-702" },
      ],
    };

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.pathname === "/__order-check") return route.fulfill({
        contentType: "text/html",
        body: `<html lang="${url.searchParams.get("lang")==="en"?"en":"ar"}" dir="${url.searchParams.get("lang")==="en"?"ltr":"rtl"}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"><style>${css}</style></head><body><div id="root"></div><script src="/__order-check.js"></script></body></html>`,
      });
      if (url.pathname === "/__order-check.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/api/orders/next-number") {
        numberPreviews++;
        if (failNextNumber) {
          failNextNumber = false;
          return route.fulfill({status: 500, json: {message: "تعذر تحميل رقم الطلب.", message_en: "The order number could not be loaded."}});
        }
        return route.fulfill({json: {order_number: "O0001"}});
      }
      if (url.pathname === "/api/customers") return route.fulfill({ json: customers });
      if (url.pathname === "/api/categories") return route.fulfill({ json: categories });
      if (url.pathname === "/api/items") return route.fulfill({ json: [] });
      if (url.pathname === "/api/master-batch-colors") return route.fulfill({ json: [
        { id: 11, name_ar: "أحمر", name: "Red", color_hex: "#c94a43", is_active: true },
        { id: 12, name_ar: "أزرق", name: "Blue", color_hex: "#477da8", is_active: true },
      ] });
      if (url.pathname === "/api/customer-products/form-options") return route.fulfill({ json: { printing_cylinders: ['20"'] } });
      const detailMatch = /^\/api\/customers\/([^/]+)\/detail$/.exec(url.pathname);
      if (detailMatch) {
        requests.details.push(decodeURIComponent(detailMatch[1]));
        return route.fulfill({ json: { products: decodeURIComponent(detailMatch[1]) === "2" ? existingProducts : [] } });
      }
      if (url.pathname === "/api/orders/77/with-items" && method === "GET") return route.fulfill({ json: editOrder });
      if (url.pathname === "/api/customer-products" || url.pathname.startsWith("/api/customer-products/")) {
        if (method !== "GET") {
          requests.customerProductWrites.push({ method, body: request.postData() });
          return route.fulfill({ status: 500, json: { message: "Unexpected standalone product write in draft test" } });
        }
      }
      if (url.pathname === "/api/orders/with-items" || url.pathname === "/api/orders/77/with-items") {
        if (method === "POST" || method === "PUT") {
          const raw = request.postData() || "";
          requests.orderSaves.push({ method, path: url.pathname, raw, body: JSON.parse(raw) });
          if (failNextOrderSave) {
            failNextOrderSave = false;
            return route.fulfill({ status: 500, json: { message: "Simulated order save failure" } });
          }
          return route.fulfill({ json: { order: { id: 900 } } });
        }
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { message: `Unexpected mocked API path: ${url.pathname}` } });
      return route.continue();
    });

    const go = async (width = 1024, editId) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/__order-check${editId ? `?editId=${editId}` : ""}`);
      await page.locator(".order-create-modal").waitFor();
    };
    const chooseCustomer = async (name) => {
      const input = page.locator("#order-customer");
      await input.fill(name);
      const optionName = name.includes("Other") ? /عميل آخر/ : /عميل تجريبي/;
      await page.getByRole("option", { name: optionName }).click();
      await page.locator(".order-line-card").first().waitFor();
      await page.waitForFunction(() => {
        const button = document.querySelector(".order-product-mode button:nth-child(2)");
        return button && !button.disabled;
      });
    };
    const openDraft = async (lineIndex = 0) => {
      await page.locator(".order-line-card").nth(lineIndex).locator(".order-product-mode button").nth(1).click();
      await page.locator(".cp-modal").waitFor();
      await page.locator("#cp-right").waitFor();
    };
    const fillSimpleValidProduct = async (lineIndex = 0, note = "draft") => {
      await openDraft(lineIndex);
      await page.locator("#cp-category").selectOption("CAT01");
      await page.locator("#cp-width").selectOption("40");
      await page.locator("#cp-right").selectOption("5");
      await page.locator("#cp-left").selectOption("5");
      await page.locator("#cp-thickness").selectOption("20");
      await page.locator("#cp-notes").fill(note);
      await page.locator(".cp-save").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
    };
    const makeFile = (name, type, size) => ({
      name, mimeType: type, buffer: Buffer.alloc(size, 0x41),
    });

    if (process.argv.includes("--order-fields-only")) {
      for (const lang of ["ar", "en"]) for (const width of [390, 768, 1440]) {
        await page.setViewportSize({width,height:1000});
        await page.goto(`${origin}/__order-check?lang=${lang}`);
        await page.waitForFunction(() => document.querySelector("#order-number")?.textContent === "O0001");
        const fields = await page.evaluate(() => ({
          number: getComputedStyle(document.querySelector("#order-number")).justifyContent,
          date: getComputedStyle(document.querySelector("#order-created-date")).justifyContent,
          days: getComputedStyle(document.querySelector("#order-delivery-days")).textAlign,
          quantity: getComputedStyle(document.querySelector("#order-quantity-1")).textAlign,
          quantityPadding: [
            getComputedStyle(document.querySelector("#order-quantity-1")).paddingLeft,
            getComputedStyle(document.querySelector("#order-quantity-1")).paddingRight,
          ],
          hint: !!document.querySelector("#order-delivery-days-hint"),
          description: document.querySelector("#order-delivery-days").getAttribute("aria-describedby"),
          fits: document.documentElement.scrollWidth <= innerWidth + 1,
        }));
        check(`${lang} ${width}: fields centered and helper removed`, () => {
          for (const key of ["number", "date", "days", "quantity"]) assert.equal(fields[key], "center");
          assert.equal(fields.quantityPadding[0], fields.quantityPadding[1]);
          assert.equal(fields.hint, false);
          assert.equal(fields.description, null);
          assert.equal(fields.fits, true);
        });
        await page.locator("#order-quantity-1").fill("12.50");
        const quantity = await page.locator("#order-quantity-1").inputValue();
        check(`${lang} ${width}: decimal quantity remains editable`, () => assert.equal(quantity, "12.50"));
        if (lang === "ar" && width === 390) await page.screenshot({path:"/tmp/order-fields-ar-390.png"});
      }
      const beforeEdit = numberPreviews;
      await go(390,77);
      await page.waitForFunction(() => document.querySelector("#order-number")?.textContent === "ORD-077");
      check("editing keeps the saved number and does not fetch a new one", () => assert.equal(numberPreviews,beforeEdit));
      failNextNumber=true;
      await go(390);
      await page.locator(".order-create-number [role=alert]").waitFor();
      await page.locator(".order-create-number button").click();
      await page.waitForFunction(() => document.querySelector("#order-number")?.textContent === "O0001");
      check("preview retry succeeds without business writes", () => assert.equal(requests.orderSaves.length,0));
      check("no order-field runtime errors", () => assert.deepEqual(pageErrors,[]));
      if (failures.length) throw new Error(failures.join("\\n"));
      console.log("Verified customer order fields on phone, tablet and desktop with isolated API fixtures.");
      return;
    }
    for (const width of [390, 768, 1024]) {
      await checkAsync(`nested modal opens and exposes complete product editor at ${width}px`, async () => {
        await go(width);
        await chooseCustomer("Test Customer");
        await openDraft();
        await page.locator("#cp-category").selectOption("CAT01");
        const parent = page.locator(".order-create-modal");
        const child = page.locator(".cp-modal");
        assert.equal(await page.locator(".cp-section").count(), 7);
        assert.equal(await page.locator("#cp-customer").getAttribute("readonly"), "");
        assert.match(await page.locator("#cp-customer").inputValue(), /Test Customer/);
        for (const selector of [
          "#cp-right", "#cp-left", "#cp-width", "#cp-thickness", "#cp-density",
          "#cp-cut-length", "#cp-cylinder", "#cp-punching", "#cp-material", "#cp-master-batch",
          "#cp-cut-unit", "#cp-unit-weight", "#cp-unit-quantity", "#cp-status",
          'input[aria-label="رفع تصميم الوجه الأمامي"]', 'input[aria-label="رفع تصميم الوجه الخلفي"]',
          'input[aria-label="اختيار لون الوجه الأمامي"]', 'input[aria-label="اختيار لون الوجه الخلفي"]',
          "#cp-notes",
        ]) assert.equal(await child.locator(selector).count(), 1, `missing product control ${selector}`);
        assert.equal(await child.locator("#cp-cut-length").isDisabled(), false, "manual cutting length should be editable");
        assert.deepEqual(await child.locator("#cp-punching option").evaluateAll((els) => els.map((el) => el.value)), ["بدون", "بنانة", "بنانة 6سم"]);
        const parentState = await parent.evaluate((el) => ({
          inert: el.hasAttribute("inert"), ariaHidden: el.getAttribute("aria-hidden"), ariaModal: el.getAttribute("aria-modal"),
        }));
        check(`parent inert/aria-hidden state at ${width}px`, () => {
          assert.equal(parentState.inert, true);
          assert.equal(parentState.ariaHidden, "true");
          assert.equal(parentState.ariaModal, "false");
        });
        const nestedForm = await child.locator("#cp-form").evaluate((form) => Boolean(form.parentElement.closest("form")));
        check(`child form is not nested in order form at ${width}px`, () => assert.equal(nestedForm, false));
        const layout = await child.evaluate((el) => ({
          modalOverflow: el.scrollWidth > el.clientWidth + 1,
          bodyOverflow: el.querySelector(".cp-body").scrollWidth > el.querySelector(".cp-body").clientWidth + 1,
        }));
        check(`no horizontal overflow in nested product editor at ${width}px`, () => {
          assert.equal(layout.modalOverflow, false);
          assert.equal(layout.bodyOverflow, false);
        });
        const focusables = await child.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]').evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => ({
          tag: el.tagName, id: el.id, cls: el.className,
        })));
        if (focusables.length > 1) {
          const last = child.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]').filter({ visible: true }).last();
          await last.focus();
          await page.keyboard.press("Tab");
          const afterTab = await page.evaluate(() => ({ id: document.activeElement.id, cls: document.activeElement.className }));
          check(`Tab wraps to first child focus target at ${width}px`, () => {
            assert.equal(afterTab.id, focusables[0].id);
            assert.equal(afterTab.cls, focusables[0].cls);
          });
          const first = child.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]').filter({ visible: true }).first();
          await first.focus();
          await page.keyboard.press("Shift+Tab");
          const afterShiftTab = await page.evaluate(() => ({ id: document.activeElement.id, cls: document.activeElement.className }));
          const expectedLast = focusables.at(-1);
          check(`Shift+Tab wraps to last child focus target at ${width}px`, () => assert.equal(afterShiftTab.id || afterShiftTab.cls, expectedLast.id || expectedLast.cls));
        }
        if (width === 1024) {
          await child.locator(".cp-body").evaluate((el) => { el.scrollTop = 0; });
          await page.screenshot({ path: "/tmp/order-new-product-modal-desktop.png" });
        }
        await page.keyboard.press("Escape");
        await child.waitFor({ state: "detached" });
        await checkAsync(`Escape closes child only and restores trigger focus at ${width}px`, async () => {
          assert.equal(await page.locator(".order-create-modal").count(), 1);
          assert.equal(await page.evaluate(() => document.activeElement?.classList?.contains("cp-cancel") || document.activeElement?.classList?.contains("cp-close")), false);
          assert.equal(await page.evaluate(() => document.activeElement?.closest(".order-line-card") !== null), true);
        });
      });
    }

    await checkAsync("cancel preserves the order line and quantity; successful draft validation and edit cancellation", async () => {
      await go(1024);
      await chooseCustomer("Test Customer");
      const quantity = page.locator("#order-quantity-1");
      await quantity.fill("12.50");
      const productWritesBefore = requests.customerProductWrites.length;
      await openDraft();
      await page.locator(".cp-cancel").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
      assert.equal(await quantity.inputValue(), "12.50");
      assert.equal(await page.locator(".order-product-mode button").nth(0).getAttribute("aria-pressed"), "true");
      assert.equal(requests.customerProductWrites.length, productWritesBefore);

      await openDraft();
      await page.locator("#cp-category").selectOption("CAT01");
      await page.locator("#cp-width").selectOption("30");
      await page.locator("#cp-right").selectOption("15");
      await page.locator("#cp-left").selectOption("15");
      await page.locator("#cp-thickness").selectOption("20");
      await page.locator(".cp-save").click();
      await page.getByRole("alert").filter({ hasText: "مجموع الجانب الأيمن والجانب الأيسر" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "الاستمرار في الحفظ" }).count(), 0);
      assert.equal(requests.customerProductWrites.length, productWritesBefore);

      await page.locator("#cp-width").selectOption("40");
      await page.locator("#cp-right").selectOption("5");
      await page.locator("#cp-left").selectOption("4");
      await page.locator(".cp-save").click();
      const warning = page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" });
      await warning.waitFor();
      assert.equal(requests.customerProductWrites.length, productWritesBefore);
      await page.getByRole("button", { name: "العودة للتعديل" }).click();
      await page.locator("#cp-left").selectOption("5");
      await page.locator("#cp-left").selectOption("4");
      await page.locator(".cp-save").click();
      await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor();
      await page.getByRole("button", { name: "الاستمرار في الحفظ" }).click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
      assert.equal(requests.customerProductWrites.length, productWritesBefore);
      assert.equal(await quantity.inputValue(), "12.50");
      assert.equal(await page.locator(".order-product-mode button").nth(1).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".order-product-draft button").innerText(), "تعديل المنتج");
      const summary = await page.locator(".order-product-draft span").innerText();
      assert.match(summary, /40/);

      await page.locator(".order-product-draft button").click();
      await page.locator("#cp-right").waitFor();
      assert.equal(await page.locator("#cp-width").inputValue(), "40");
      await page.locator("#cp-notes").fill("draft that will be cancelled");
      await page.locator(".cp-cancel").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
      assert.equal(await page.locator(".order-product-draft span").innerText(), summary);
      assert.equal(await quantity.inputValue(), "12.50");
      assert.equal(requests.customerProductWrites.length, productWritesBefore);
    });

    await checkAsync("two 5 MiB images, complete editable payload, retry preservation, and independent draft line keys", async () => {
      await go(1024);
      await chooseCustomer("Test Customer");
      await page.locator("#order-quantity-1").fill("12.50");
      await openDraft();
      await page.locator("#cp-category").selectOption("CAT01");
      await page.locator("#cp-width").selectOption("30");
      await page.locator("#cp-right").selectOption("5");
      await page.locator("#cp-left").selectOption("5");
      await page.locator("#cp-thickness").selectOption("20");
      await page.locator("#cp-density").selectOption("1.15");
      await page.locator("#cp-cut-length").selectOption("50");
      await page.locator("#cp-punching").selectOption("بنانة 6سم");
      await page.locator("#cp-cylinder").selectOption('20"');
      assert.equal(await page.locator("#cp-cut-length").isDisabled(), true);
      assert.equal(await page.locator("#cp-cut-length").inputValue(), "51");
      await page.locator("#cp-cylinder").selectOption("");
      await page.locator("#cp-cut-length").selectOption("50");
      await page.locator("#cp-material").selectOption("LDPE");
      await page.locator("#cp-master-batch").click();
      await page.getByRole("option", { name: /أحمر/ }).click();
      await page.locator("#cp-cut-unit").selectOption("باكت");
      await page.locator("#cp-unit-weight").selectOption("0.15");
      await page.locator("#cp-unit-quantity").selectOption("25");
      await page.locator("#cp-status").selectOption("inactive");
      await page.locator("#cp-notes").fill("complete draft first line");
      for (const [index, color] of ["#123456", "#654321"].entries()) {
        await page.locator('input[type="color"]').nth(index).fill(color);
        await page.locator(".cp-color-add button").nth(index).click();
      }
      const imageSize = 5 * 1024 * 1024;
      const imageBuffer = Buffer.alloc(imageSize, 0x41);
      await page.locator('input[aria-label="رفع تصميم الوجه الأمامي"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: imageBuffer });
      await page.locator('input[aria-label="رفع تصميم الوجه الخلفي"]').setInputFiles({ name: "back.png", mimeType: "image/png", buffer: imageBuffer });
      await page.waitForFunction(() => document.querySelectorAll(".cp-preview img").length === 2 && !document.querySelector('[role="status"]')?.textContent?.includes("جارٍ قراءة الصورة"));
      assert.equal(await page.locator(".cp-preview img").count(), 2);
      await page.locator(".cp-save").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });

      await page.locator(".order-create-add").click();
      assert.equal(await page.locator(".order-line-card").count(), 2);
      await page.locator("#order-quantity-2").fill("7.25");
      await fillSimpleValidProduct(1, "independent second line");
      assert.equal(await page.locator(".order-line-card").count(), 2);
      const secondSummary = await page.locator(".order-line-card").nth(1).locator(".order-product-draft span").innerText();
      await page.locator(".order-line-card").nth(0).locator(".order-product-draft button").click();
      await page.locator("#cp-notes").waitFor();
      assert.equal(await page.locator("#cp-notes").inputValue(), "complete draft first line");
      assert.equal(await page.locator("#cp-status").inputValue(), "inactive");
      assert.equal(await page.locator(".cp-preview img").count(), 2);
      assert.equal(await page.locator(".cp-color-pill").count(), 2);
      assert.equal(await page.locator("#cp-category").inputValue(), "CAT01");
      assert.equal(await page.locator("#cp-right").inputValue(), "5");
      assert.equal(await page.locator("#cp-left").inputValue(), "5");
      assert.equal(await page.locator("#cp-width").inputValue(), "30");
      assert.equal(await page.locator("#cp-thickness").inputValue(), "20");
      assert.equal(await page.locator("#cp-density").inputValue(), "1.15");
      assert.equal(await page.locator("#cp-cut-length").inputValue(), "50");
      assert.equal(await page.locator("#cp-cylinder").inputValue(), "");
      assert.equal(await page.locator("#cp-punching").inputValue(), "بنانة 6سم");
      assert.equal(await page.locator("#cp-material").inputValue(), "LDPE");
      assert.match(await page.locator("#cp-master-batch").innerText(), /أحمر/);
      assert.equal(await page.locator("#cp-cut-unit").inputValue(), "باكت");
      assert.equal(await page.locator("#cp-unit-weight").inputValue(), "0.15");
      assert.equal(await page.locator("#cp-unit-quantity").inputValue(), "25");
      await page.locator(".cp-cancel").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
      assert.equal(await page.locator(".order-line-card").nth(1).locator(".order-product-draft span").innerText(), secondSummary);
      assert.equal(await page.locator("#order-quantity-2").inputValue(), "7.25");
      assert.equal(requests.customerProductWrites.length, 0);

      failNextOrderSave = true;
      const saveCount = requests.orderSaves.length;
      await page.locator(".order-create-save").click();
      await page.getByRole("alert").filter({ hasText: "Simulated order save failure" }).waitFor();
      assert.equal(requests.orderSaves.length, saveCount + 1);
      assert.equal(await page.locator("#order-quantity-1").inputValue(), "12.50");
      assert.equal(await page.locator("#order-quantity-2").inputValue(), "7.25");
      assert.equal(await page.locator(".order-line-card").count(), 2);
      await page.locator(".order-line-card").nth(0).locator(".order-product-draft button").click();
      await page.locator("#cp-width").waitFor();
      assert.equal(await page.locator(".cp-preview img").count(), 2);
      assert.equal(await page.locator("#cp-notes").inputValue(), "complete draft first line");
      await page.locator(".cp-cancel").click();
      await page.locator(".cp-modal").waitFor({ state: "detached" });
      await page.locator(".order-create-save").click();
      await page.waitForFunction(() => window.saved === 1);
      assert.equal(requests.orderSaves.length, saveCount + 2);
      assert.equal(requests.orderSaves.at(-1).raw, requests.orderSaves.at(-2).raw, "failed-save retry must submit the exact same draft body");
      const posted = requests.orderSaves.at(-1).body;
      assert.equal(requests.orderSaves.at(-1).method, "POST");
      assert.equal(posted.customer_id, "1");
      assert.equal(posted.items.length, 2);
      assert.equal(posted.items[0].quantity_kg, "12.50");
      assert.equal(posted.items[1].quantity_kg, "7.25");
      assert.equal(posted.items[0].new_product.customer_id, undefined);
      assert.equal(posted.items[1].new_product.customer_id, undefined);
      assert.equal(posted.items[0].new_product.width, "30");
      assert.equal(posted.items[0].new_product.thickness, "20");
      assert.equal(posted.items[0].new_product.density, "1.15");
      assert.equal(posted.items[0].new_product.cutting_length_cm, 50);
      assert.equal(posted.items[0].new_product.cutting_unit, "باكت");
      assert.equal(posted.items[0].new_product.unit_weight_kg, "0.15");
      assert.equal(posted.items[0].new_product.unit_quantity, 25);
      assert.equal(posted.items[0].new_product.punching, "بنانة 6سم");
      assert.equal(posted.items[0].new_product.raw_material, "LDPE");
      assert.equal(posted.items[0].new_product.master_batch_id, "11");
      assert.equal(posted.items[0].new_product.status, "inactive");
      assert.equal(posted.items[0].new_product.notes, "complete draft first line");
      assert.equal(posted.items[0].new_product.cliche_front_design.length > 6_900_000, true);
      assert.equal(posted.items[0].new_product.cliche_back_design.length > 6_900_000, true);
      assert.deepEqual(posted.items[0].new_product.front_print_colors, ["#123456"]);
      assert.deepEqual(posted.items[0].new_product.back_print_colors, ["#654321"]);
      assert.deepEqual(Object.keys(posted.items[0].new_product).sort(), [
        "back_print_colors", "category_id", "cliche_back_design", "cliche_front_design",
        "cutting_length_cm", "cutting_unit", "density", "front_print_colors", "item_id",
        "left_facing", "master_batch_id", "notes", "printing_cylinder", "punching",
        "raw_material", "right_facing", "status", "thickness", "unit_quantity",
        "unit_weight_kg", "width",
      ].sort());
      assert.equal(posted.items[1].new_product.notes, "independent second line");
      assert.equal(posted.items[1].new_product.width, "40");
      for (const line of posted.items) {
        for (const derived of ["size_caption", "bag_weight_grams", "bags_per_kilo", "package_weight_kg", "is_printed"]) {
          assert.equal(Object.hasOwn(line.new_product, derived), false, `derived field ${derived} must not be sent`);
        }
      }
      assert.equal(Buffer.byteLength(requests.orderSaves.at(-1).raw), Buffer.byteLength(requests.orderSaves.at(-2).raw));
      assert(Buffer.byteLength(requests.orderSaves.at(-1).raw) < 16 * 1024 * 1024, "two 5 MiB images in one draft should remain below the order JSON cap");
      assert.equal(requests.customerProductWrites.length, 0);
    });

    await checkAsync("SVG and over-5-MiB images are rejected without replacing saved image data", async () => {
      await go(1024);
      await chooseCustomer("Test Customer");
      await openDraft();
      await page.locator("#cp-category").selectOption("CAT01");
      await page.locator("#cp-width").selectOption("30");
      await page.locator("#cp-right").selectOption("5");
      await page.locator("#cp-left").selectOption("5");
      await page.locator("#cp-thickness").selectOption("20");
      const valid = makeFile("valid.png", "image/png", 128);
      await page.locator('input[aria-label="رفع تصميم الوجه الأمامي"]').setInputFiles(valid);
      await page.waitForFunction(() => document.querySelectorAll(".cp-preview img").length === 1);
      const before = await page.locator(".cp-preview img").getAttribute("src");
      await page.locator('input[aria-label="رفع تصميم الوجه الأمامي"]').setInputFiles({ name: "vector.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
      await page.getByRole("alert").filter({ hasText: "نوع الملف غير مدعوم" }).waitFor();
      assert.equal(await page.locator(".cp-preview img").getAttribute("src"), before);
      await page.locator('input[aria-label="رفع تصميم الوجه الخلفي"]').setInputFiles(makeFile("too-large.png", "image/png", 5 * 1024 * 1024 + 1));
      await page.getByRole("alert").filter({ hasText: "حجم الصورة يتجاوز 5 ميغابايت" }).waitFor();
      assert.equal(await page.locator(".cp-preview img").count(), 1);
      assert.equal(requests.customerProductWrites.length, 0);
    });

    await checkAsync("aggregate payload over 16 MiB is rejected before network request", async () => {
      await go(1024);
      await chooseCustomer("Test Customer");
      const imageBuffer = Buffer.alloc(5 * 1024 * 1024, 0x42);
      for (let index = 0; index < 2; index += 1) {
        if (index === 1) {
          await page.locator(".order-create-add").click();
          await page.locator("#order-quantity-2").fill("2");
        } else {
          await page.locator("#order-quantity-1").fill("1");
        }
        await openDraft(index);
        await page.locator("#cp-category").selectOption("CAT01");
        await page.locator("#cp-width").selectOption("30");
        await page.locator("#cp-right").selectOption("5");
        await page.locator("#cp-left").selectOption("5");
        await page.locator("#cp-thickness").selectOption("20");
        for (const side of ["front", "back"]) {
          await page.locator(`input[aria-label="رفع تصميم ${side === "front" ? "الوجه الأمامي" : "الوجه الخلفي"}"]`).setInputFiles({
            name: `${index}-${side}.png`, mimeType: "image/png", buffer: imageBuffer,
          });
        }
        await page.waitForFunction(() => document.querySelectorAll(".cp-preview img").length === 2);
        await page.locator(".cp-save").click();
        await page.locator(".cp-modal").waitFor({ state: "detached" });
      }
      const before = requests.orderSaves.length;
      await page.locator(".order-create-save").click();
      await page.getByRole("alert").filter({ hasText: "يتجاوز 16 ميغابايت" }).waitFor();
      assert.equal(requests.orderSaves.length, before);
      assert.equal(await page.locator(".order-line-card").count(), 2);
    });

    await checkAsync("existing-product selection works and changing customers clears selected IDs and drafts", async () => {
      await go(1024);
      await chooseCustomer("Test Customer");
      await page.locator("#order-quantity-1").fill("3");
      await fillSimpleValidProduct(0, "customer one draft");
      assert.equal(await page.locator(".order-product-mode button").nth(1).getAttribute("aria-pressed"), "true");
      const customerSearch = page.locator("#order-customer");
      await customerSearch.fill("Other Customer");
      await page.getByRole("option", { name: /عميل آخر/ }).click();
      await page.waitForFunction(() => document.querySelector("#order-product-1") !== null);
      assert.equal(await page.locator(".order-product-mode button").nth(0).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".order-product-draft").count(), 0);
      await page.locator("#order-product-1").click();
      await page.getByRole("option", { name: /منتج مسجل/ }).click();
      assert.equal((await page.locator("#order-product-1").inputValue()).length > 0, true);
      await page.locator("#order-customer").fill("Test Customer");
      await page.locator("#order-customer").press("Enter");
      await page.waitForFunction(() => document.querySelector("#order-product-1") !== null);
      assert.equal(await page.locator("#order-product-1").inputValue(), "");
      assert.equal(await page.locator(".order-product-mode button").nth(0).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".order-product-draft").count(), 0);
    });

    await checkAsync("order edit accepts a draft on a new line and locks production-started lines", async () => {
      await go(1024, 77);
      await page.waitForFunction(() => document.querySelectorAll(".order-line-card").length === 2);
      const locked = page.locator(".order-line-card").nth(1);
      assert.equal(await locked.locator(".order-product-mode button").nth(1).isDisabled(), true);
      assert.equal(await locked.locator("#order-quantity-2").isDisabled(), true);
      assert.equal(await locked.locator(".order-line-remove").count(), 0);
      await page.locator(".order-create-add").click();
      assert.equal(await page.locator(".order-line-card").count(), 3);
      await page.locator("#order-quantity-3").fill("6.5");
      await fillSimpleValidProduct(2, "draft added to edited order");
      const before = requests.orderSaves.length;
      await page.locator(".order-create-save").click();
      await page.waitForFunction(() => window.saved === 1);
      assert.equal(requests.orderSaves.length, before + 1);
      const saved = requests.orderSaves.at(-1);
      assert.equal(saved.method, "PUT");
      assert.equal(saved.body.items.length, 3);
      assert.equal(saved.body.items[0].customer_product_id, 202);
      assert.equal(saved.body.items[1].customer_product_id, 203);
      assert.equal(saved.body.items[2].new_product.notes, "draft added to edited order");
      assert.equal(saved.body.items[2].new_product.customer_id, undefined);
      assert.equal(saved.body.items[2].quantity_kg, "6.5");
      assert.equal(requests.customerProductWrites.length, 0);
    });

    check("no uncaught browser runtime errors", () => assert.deepEqual(pageErrors, []));
  } finally {
    await browser?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} regression assertion(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll order/new-product browser regression checks passed.");
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });