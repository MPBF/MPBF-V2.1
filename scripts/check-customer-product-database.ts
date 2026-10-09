import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import express from "express";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromiumPath = process.env.CHROMIUM_PATH ||
  "/repl/ctls/3qgx41z8882ff85y9prdc5zgbb2id6y8-chromium-152.0.7977.64/bin/chromium";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("This check runs only in the development workspace.");
}

const marker = `cp-db-check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const testNotes = `integration test ${marker}`;
const temporaryDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
  mkdtemp(path.join(tmpdir(), "customer-product-database-")));
const trackedProductIds = new Set<number>();
const uiWrites: Array<{ method: string; body: Record<string, unknown> }> = [];
const uiWriteStatuses: number[] = [];
const pageErrors: string[] = [];
let currentStep = "initialize";
let browser: any;
let server: Server | undefined;
let database: typeof import("../server/db") | undefined;
let customerProductsTable: typeof import("../shared/schema").customer_products | undefined;

function verify(condition: unknown, assertion: string): asserts condition {
  assert.ok(condition, assertion);
}

function pass(assertion: string) {
  console.log(`PASS: ${assertion}`);
}

function tinyPng(red: number, green: number, blue: number): Buffer {
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const typeBytes = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([length, typeBytes, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.from([0, red, green, blue, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const frontImage = `data:image/png;base64,${tinyPng(18, 85, 170).toString("base64")}`;
const backImage = `data:image/png;base64,${tinyPng(205, 52, 239).toString("base64")}`;

function activeBatch(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function str(value: unknown) {
  return value == null ? null : String(value);
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  verify(body !== null, "API returned JSON");
  return body;
}

async function apiJson(origin: string, apiPath: string, init?: RequestInit) {
  const response = await fetch(`${origin}/api${apiPath}`, init);
  return { response, body: await readJson(response) };
}

async function fetchProduct(origin: string, id: number) {
  const { response, body } = await apiJson(origin, "/customer-products?limit=10");
  verify(response.ok && Array.isArray(body), "customer-products list API returned rows");
  const ids = body.map((row: Record<string, unknown>) => Number(row.id));
  verify(ids.every((value: number, index: number) => index === 0 || ids[index - 1] > value),
    "customer-products list is ordered by descending id");
  const row = body.find((candidate: Record<string, unknown>) => Number(candidate.id) === id);
  verify(row, "GET customer-products?limit=10 retrieves the test product");
  return row as Record<string, any>;
}

function assertCoreFields(row: Record<string, any>, expected: {
  customerId: string;
  categoryId: string | null;
  itemId: string | null;
  batchId: string | null;
  leftFacing: string;
  notes: string;
}) {
  const equal = (field: string, actual: unknown, wanted: unknown) => {
    if (!Object.is(actual, wanted)) throw new Error(`SAFE_FIELD:${field}`);
  };
  equal("customer_id", str(row.customer_id), expected.customerId);
  equal("category_id", str(row.category_id), expected.categoryId);
  equal("item_id", str(row.item_id), expected.itemId);
  equal("master_batch_id", str(row.master_batch_id), expected.batchId);
  equal("width", str(row.width), "30");
  equal("left_facing", str(row.left_facing), expected.leftFacing);
  equal("right_facing", str(row.right_facing), "5");
  equal("thickness", str(row.thickness), "20");
  equal("density", Number(row.density), 0.95);
  equal("printing_cylinder", row.printing_cylinder, '20"');
  equal("cutting_length_cm", Number(row.cutting_length_cm), 51);
  equal("raw_material", row.raw_material, "HDPE");
  equal("cutting_unit", row.cutting_unit, "باكت");
  equal("unit_weight_kg", Number(row.unit_weight_kg), 0.15);
  equal("unit_quantity", Number(row.unit_quantity), 25);
  equal("status", row.status, "inactive");
  equal("notes", row.notes, expected.notes);
  equal("is_printed", row.is_printed, true);
  equal("size_caption", row.size_caption, `30+${expected.leftFacing}+5X51`);
  equal("universal_thickness", Number(row.universal_thickness), 50);
  const rawBagWeight = (30 + Number(expected.leftFacing) + 5) * 51 * 2 * 0.005 * 0.95;
  equal("bag_weight_grams", Number(row.bag_weight_grams), Math.ceil(rawBagWeight));
  equal("bags_per_kilo", Number(row.bags_per_kilo), Math.ceil(1000 / rawBagWeight));
  equal("package_weight_kg", Number(row.package_weight_kg), 3.75);
  equal("cliche_front_design", row.cliche_front_design, frontImage);
  equal("cliche_back_design", row.cliche_back_design, backImage);
  equal("front_print_colors", JSON.stringify(row.front_print_colors), JSON.stringify(["#1255aa"]));
  equal("back_print_colors", JSON.stringify(row.back_print_colors), JSON.stringify(["#cd34ef"]));
}

async function cleanup() {
  if (!database || !customerProductsTable || trackedProductIds.size === 0) return;
  const { and, inArray, like } = await import("drizzle-orm");
  const ids = [...trackedProductIds];
  const ownedRows = await database.db.select({ id: customerProductsTable.id })
    .from(customerProductsTable)
    .where(and(
      inArray(customerProductsTable.id, ids),
      like(customerProductsTable.notes, `%${marker}%`),
    ));
  verify(ownedRows.length === ids.length, "all tracked rows remain owned by this unique test marker");
  await database.db.delete(customerProductsTable).where(and(
    inArray(customerProductsTable.id, ids),
    like(customerProductsTable.notes, `%${marker}%`),
  ));
  const remaining = await database.db.select({ id: customerProductsTable.id })
    .from(customerProductsTable)
    .where(inArray(customerProductsTable.id, ids));
  verify(remaining.length === 0, "database cleanup verified for every tracked test product");
}

try {
  currentStep = "bundle the actual modal";
  const bundlePath = path.join(temporaryDirectory, "customer-product-fixture.js");
  await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import Modal from "./client/src/components/CustomerProductModal";
        const root = createRoot(document.getElementById("root"));
        const renderProduct = (row) => {
          window.__cpSaved = false;
          root.render(<Modal row={row}
            onSaved={() => { window.__cpSaved = true; }}
            onClose={() => { window.__cpClosed = true; }} />);
        };
        window.renderProduct = renderProduct;
        renderProduct({});
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    jsx: "automatic",
    platform: "browser",
    outfile: bundlePath,
    logLevel: "silent",
  });
  const fs = await import("node:fs/promises");
  const fixtureJs = await fs.readFile(bundlePath, "utf8");
  const fixtureCss = await fs.readFile(bundlePath.replace(/\.js$/, ".css"), "utf8");

  currentStep = "load development database API";
  const [{ default: api }, dbModule, schema] = await Promise.all([
    import("../server/routes"),
    import("../server/db"),
    import("../shared/schema"),
  ]);
  database = dbModule;
  customerProductsTable = schema.customer_products;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16mb" }));
  app.use((request, _response, next) => {
    Object.assign(request, {
      user: {
        id: 0,
        username: null,
        display_name: null,
        display_name_ar: null,
        role_id: null,
        role_name: null,
        role_name_ar: null,
        section_id: null,
        permissions: ["manage_customers"],
        must_change_password: false,
      },
      session: {},
    });
    next();
  });
  app.use("/api/customer-products", (request, response, next) => {
    if (request.method === "POST") {
      const json = response.json.bind(response);
      response.json = ((body: Record<string, any>) => {
        if (response.statusCode < 400 && body?.notes === testNotes && Number.isSafeInteger(Number(body.id))) {
          trackedProductIds.add(Number(body.id));
        }
        return json(body);
      }) as typeof response.json;
    }
    next();
  });
  app.use("/api", api);
  app.get("/__cp-check", (_request, response) => {
    const cssUrl = process.env.CUSTOMER_PRODUCT_DEV_CSS_URL || "http://127.0.0.1:5000/src/index.css?direct";
    response.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="${cssUrl}">
      <style>${fixtureCss}</style></head><body><div id="root"></div>
      <script src="/__cp-check.js"></script></body></html>`);
  });
  app.get("/__cp-check.js", (_request, response) => response.type("javascript").send(fixtureJs));
  app.use((error: any, _request: any, response: any, _next: any) => {
    if (response.headersSent) return;
    if (error?.name === "ZodError") {
      return response.status(400).json({ message: "البيانات المدخلة غير صالحة", details: error.issues });
    }
    const status = Number(error?.status) || 500;
    response.status(status).json({
      message: status === 500 ? "حدث خطأ داخلي" : String(error?.message || error),
      ...(typeof error?.code === "string" && error.code ? { code: error.code } : {}),
    });
  });

  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  verify(address && typeof address === "object", "isolated harness bound to loopback");
  const origin = `http://127.0.0.1:${address.port}`;

  currentStep = "load read-only reference options";
  const [customerResult, categoryResult, itemResult, batchResult] = await Promise.all([
    apiJson(origin, "/customers?limit=200&offset=0"),
    apiJson(origin, "/categories?limit=200&offset=0"),
    apiJson(origin, "/items?limit=200&offset=0"),
    apiJson(origin, "/master-batch-colors?limit=200&offset=0"),
  ]);
  verify(customerResult.response.ok && Array.isArray(customerResult.body) && customerResult.body.length > 0,
    "read-only existing customer reference available");
  verify(categoryResult.response.ok && Array.isArray(categoryResult.body), "read-only category references loaded");
  verify(itemResult.response.ok && Array.isArray(itemResult.body), "read-only item references loaded");
  verify(batchResult.response.ok && Array.isArray(batchResult.body), "read-only master-batch references loaded");
  const customer = customerResult.body[0];
  const category = categoryResult.body.find((row: Record<string, any>) =>
    !/سفرة بلاستيكية|table cover/i.test(`${row.name_ar ?? ""} ${row.name ?? ""}`));
  const item = category && itemResult.body.find((row: Record<string, any>) =>
    String(row.category_id) === String(category.id) && (!row.status || row.status === "active"));
  const batch = batchResult.body.find((row: Record<string, any>) => activeBatch(row.is_active));
  const expected = {
    customerId: String(customer.id),
    categoryId: category ? String(category.id) : null,
    itemId: item ? String(item.id) : null,
    batchId: batch ? String(batch.id) : null,
  };
  pass("real API reference reads completed; existing records are read-only");

  currentStep = "launch actual browser and fill modal";
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  page.on("request", (request: any) => {
    const requestUrl = new URL(request.url());
    if (/^\/api\/customer-products(?:\/\d+)?$/.test(requestUrl.pathname) &&
      (request.method() === "POST" || request.method() === "PUT")) {
      uiWrites.push({ method: request.method(), body: request.postDataJSON() });
    }
  });
  page.on("response", (response: any) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.pathname === "/api/customer-products" || /^\/api\/customer-products\/\d+$/.test(responseUrl.pathname)) {
      if (response.request().method() === "POST" || response.request().method() === "PUT") {
        uiWriteStatuses.push(response.status());
      }
    }
  });
  await page.goto(`${origin}/__cp-check`);
  await page.locator("#cp-right").waitFor();
  await page.getByRole("button", { name: "اختر العميل" }).click();
  await page.getByRole("listbox", { name: "العملاء" }).getByRole("option").first().click();
  if (category) await page.locator("#cp-category").selectOption(String(category.id));
  if (item) await page.locator("#cp-item").selectOption(String(item.id));
  await page.locator("#cp-right").selectOption("5");
  await page.locator("#cp-width").selectOption("30");
  await page.locator("#cp-left").selectOption("5");
  await page.locator("#cp-thickness").selectOption("20");
  await page.locator("#cp-density").selectOption("0.95");
  await page.locator("#cp-cylinder").selectOption('20"');
  if (!(await page.locator("#cp-cut-length").isDisabled())) {
    await page.locator("#cp-cut-length").selectOption("51");
  }
  await page.locator("#cp-material").selectOption("HDPE");
  if (batch) {
    await page.locator("#cp-master-batch").click();
    await page.getByRole("listbox", { name: "ألوان الماستر باتش" }).getByRole("option").nth(1).click();
  }
  await page.locator("#cp-cut-unit").selectOption("باكت");
  await page.locator("#cp-unit-weight").selectOption("0.15");
  await page.locator("#cp-unit-quantity").selectOption("25");
  assert.equal(await page.locator("#cp-unit-weight option:checked").innerText(), "150 جرام");
  await page.locator("#cp-status").selectOption("inactive");
  await page.locator("#cp-notes").fill(testNotes);
  await page.getByLabel("رفع تصميم الوجه الأمامي").setInputFiles({
    name: "front-test.png", mimeType: "image/png", buffer: tinyPng(18, 85, 170),
  });
  await page.getByLabel("رفع تصميم الوجه الخلفي").setInputFiles({
    name: "back-test.png", mimeType: "image/png", buffer: tinyPng(205, 52, 239),
  });
  await page.locator(".cp-image-card").nth(0).getByLabel("اختيار لون الوجه الأمامي").fill("#1255aa");
  await page.locator(".cp-image-card").nth(0).getByRole("button", { name: "أضف اللون" }).click();
  await page.locator(".cp-image-card").nth(1).getByLabel("اختيار لون الوجه الخلفي").fill("#cd34ef");
  await page.locator(".cp-image-card").nth(1).getByRole("button", { name: "أضف اللون" }).click();
  await page.locator(".cp-preview img").nth(0).waitFor();
  await page.locator(".cp-preview img").nth(1).waitFor();
  verify(await page.locator(".cp-packaging .cp-readonly").innerText() === "3.75",
    "modal calculates package weight before save");
  verify(await page.locator(".cp-dimensions .cp-readonly").innerText() === "30+5+5X51",
    "modal calculates size caption before save");

  await page.locator("#cp-left").selectOption("4");
  await page.locator(".cp-save").click();
  await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor();
  assert.equal(uiWrites.length, 0);
  assert.equal(await page.evaluate(() => (window as any).__cpSaved), false);
  await page.getByRole("button", { name: "العودة للتعديل" }).click();
  assert.equal(uiWrites.length, 0);
  assert.equal(await page.evaluate(() => (window as any).__cpSaved), false);
  assert.equal(await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).count(), 0);
  await page.locator("#cp-left").selectOption("5");
  pass("unequal-side warning cancel leaves POST unsent and form editable");

  await page.locator(".cp-save").click();
  await page.waitForFunction(() => (window as any).__cpSaved === true);
  verify(trackedProductIds.size === 1, "successful real POST tracked by returned database id");
  const productId = [...trackedProductIds][0];
  const createdPayload = uiWrites.find((write) => write.method === "POST")?.body;
  verify(createdPayload, "actual modal submitted a POST payload");
  currentStep = "verify POST persistence and list retrieval";
  let stored = await fetchProduct(origin, productId);
  assertCoreFields(stored, { ...expected, leftFacing: "5", notes: testNotes });
  pass("actual modal POST persisted editable, image, color, and calculated fields");

  currentStep = "reopen and verify saved fields";
  await page.evaluate((row: Record<string, any>) => (window as any).renderProduct(row), stored);
  await page.locator("#cp-right").waitFor();
  assert.equal(await page.locator("#cp-right").inputValue(), "5");
  assert.equal(await page.locator("#cp-width").inputValue(), "30");
  assert.equal(await page.locator("#cp-left").inputValue(), "5");
  assert.equal(await page.locator("#cp-thickness").inputValue(), "20");
  assert.equal(await page.locator("#cp-density").inputValue(), "0.95");
  assert.equal(await page.locator("#cp-cylinder").inputValue(), '20"');
  assert.equal(await page.locator("#cp-cut-length").inputValue(), "51");
  assert.equal(await page.locator("#cp-material").inputValue(), "HDPE");
  assert.equal(await page.locator("#cp-cut-unit").inputValue(), "باكت");
  assert.equal(await page.locator("#cp-unit-weight").inputValue(), "0.15");
  assert.equal(await page.locator("#cp-unit-quantity").inputValue(), "25");
  assert.equal(await page.locator("#cp-status").inputValue(), "inactive");
  assert.equal(await page.locator("#cp-notes").inputValue(), testNotes);
  assert.equal(await page.locator(".cp-preview img").count(), 2);
  assert.equal(await page.locator(".cp-preview img").nth(0).getAttribute("src"), frontImage);
  assert.equal(await page.locator(".cp-preview img").nth(1).getAttribute("src"), backImage);
  assert.equal(await page.getByText("#1255aa", { exact: true }).count(), 1);
  assert.equal(await page.getByText("#cd34ef", { exact: true }).count(), 1);
  assert.equal(await page.locator("#cp-category").inputValue(), expected.categoryId ?? "");
  assert.equal(await page.locator("#cp-item").inputValue(), expected.itemId ?? "");
  pass("actual modal reopens the GET row with saved editable fields, images, and print colors");

  currentStep = "exercise unequal-side continuation edit";
  const beforeWarningWrites = uiWrites.length;
  await page.locator("#cp-left").selectOption("4");
  await page.locator(".cp-save").click();
  await page.getByRole("alert", { name: "تنبيه اختلاف الجانبين" }).waitFor();
  assert.equal(uiWrites.length, beforeWarningWrites);
  await page.getByRole("button", { name: "الاستمرار في الحفظ" }).click();
  await page.waitForFunction(() => (window as any).__cpSaved === true);
  stored = await fetchProduct(origin, productId);
  assertCoreFields(stored, { ...expected, leftFacing: "4", notes: testNotes });
  verify(uiWrites.at(-1)?.method === "PUT", "continuing after warning sends the real PUT");
  pass("unequal-side continue performs PUT and persists confirmed value");

  currentStep = "save normal edit through modal";
  await page.evaluate((row: Record<string, any>) => (window as any).renderProduct(row), stored);
  await page.locator("#cp-right").waitFor();
  await page.locator("#cp-left").selectOption("5");
  const editedNotes = `${testNotes} edited`;
  await page.locator("#cp-notes").fill(editedNotes);
  await page.locator(".cp-save").click();
  await page.waitForFunction(() => (window as any).__cpSaved === true);
  const editRequest = uiWrites.at(-1);
  verify(editRequest?.method === "PUT", "modal edit used actual PUT endpoint");
  verify(editRequest.body.notes === editedNotes && editRequest.body.left_facing === "5",
    "modal edit sent changed editable fields");
  stored = await fetchProduct(origin, productId);
  assertCoreFields(stored, { ...expected, leftFacing: "5", notes: editedNotes });
  pass("actual modal PUT edit persisted and was retrieved from the API");

  currentStep = "reject blocking edits in the UI";
  const beforeInvalidUi = uiWrites.length;
  await page.locator("#cp-width").selectOption("10");
  await page.locator(".cp-save").click();
  await page.getByRole("alert").filter({ hasText: "مجموع الجانب الأيمن والجانب الأيسر" }).waitFor();
  assert.equal(uiWrites.length, beforeInvalidUi);
  await page.locator("#cp-right").selectOption("6");
  await page.locator(".cp-save").click();
  await page.getByRole("alert").filter({ hasText: "مجموع الجانب الأيمن والجانب الأيسر" }).waitFor();
  assert.equal(uiWrites.length, beforeInvalidUi);
  const afterInvalidUi = await fetchProduct(origin, productId);
  assertCoreFields(afterInvalidUi, { ...expected, leftFacing: "5", notes: editedNotes });
  pass("UI blocks equality and larger facing sums without changing the stored row");

  currentStep = "reject blocking POST and partial PUT requests";
  verify(createdPayload, "original successful form payload remains available for API checks");
  for (const [width, right, left] of [["10", "5", "5"], ["10", "6", "5"]]) {
    const invalidPayload = { ...createdPayload, width, right_facing: right, left_facing: left };
    const post = await apiJson(origin, "/customer-products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(invalidPayload),
    });
    assert.equal(post.response.status, 400);
    assert.match(String(post.body?.message || ""), /مجموع الجانب الأيمن والجانب الأيسر/);
    const put = await apiJson(origin, `/customer-products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ width, right_facing: right, left_facing: left }),
    });
    assert.equal(put.response.status, 400);
    assert.match(String(put.body?.message || ""), /مجموع الجانب الأيمن والجانب الأيسر/);
    const afterRejectedApiWrites = await fetchProduct(origin, productId);
    assertCoreFields(afterRejectedApiWrites, { ...expected, leftFacing: "5", notes: editedNotes });
  }
  pass("API rejects equality and larger sums on POST and partial PUT; failed edits preserve row");

  currentStep = "check browser errors";
  assert.deepEqual(pageErrors, []);
  pass("actual modal completed without browser runtime errors");
} catch (error) {
  const safeField = error instanceof Error && error.message.startsWith("SAFE_FIELD:")
    ? ` (${error.message})` : "";
  const safeStatus = uiWriteStatuses.length && uiWriteStatuses.at(-1)! >= 400
    ? ` (last browser API status ${uiWriteStatuses.at(-1)})` : "";
  console.error(`FAIL: ${currentStep}${safeField}${safeStatus}`);
  process.exitCode = 1;
} finally {
  try {
    currentStep = "clean up test-created database rows";
    await cleanup();
    if (trackedProductIds.size > 0) pass("all tracked test products deleted and cleanup verified");
  } catch {
    console.error("FAIL: cleanup verification");
    process.exitCode = 1;
  }
  await browser?.close().catch(() => {});
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await import("node:fs/promises").then(({ rm }) => rm(temporaryDirectory, { recursive: true, force: true }));
  await database?.pool.end().catch(() => {});
  await database?.sessionPool.end().catch(() => {});
}