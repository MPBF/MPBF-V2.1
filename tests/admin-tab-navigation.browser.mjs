// Read-only browser regression against the running app; every API response is a fixture.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/admin-tab-navigation.browser.mjs
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseURL = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();
const requests = [];
const writes = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const categories = Array.from({ length: 3 }, (_, n) => ({
  id: `CAT${n}`, name: `Category ${n}`, name_ar: `تصنيف ${n}`,
}));
const items = Array.from({ length: 450 }, (_, n) => ({
  id: `ITM${n}`, name: `Item ${n}`, name_ar: `صنف ${n}`, category_id: "CAT0",
}));
const machines = Array.from({ length: 7 }, (_, n) => ({
  id: n + 1, name: `Machine ${n}`, name_ar: `ماكينة ${n}`, type: "extruder",
}));
const fixtures = { "/items": items, "/categories": categories, "/machines": machines };
const snapshot = JSON.stringify(fixtures);
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.slice(4);
  if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
  requests.push({ path, params: Object.fromEntries(url.searchParams) });
  let body = [];
  if (path === "/me") body = { user: { id: 1, username: "navigation-test", permissions: ["admin"] } };
  else if (fixtures[path]) {
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 200);
    const search = url.searchParams.get("search") || "";
    const category = url.searchParams.get("category_id");
    body = fixtures[path].filter((row) =>
      (!search || `${row.name} ${row.name_ar}`.includes(search)) &&
      (!category || row.category_id === category)
    ).slice(offset, offset + limit);
  }
  await route.fulfill({ json: body });
});
const panel = () => page.locator('[role="tabpanel"]');
const waitRows = (count) => page.waitForFunction((expected) =>
  document.querySelectorAll('[role="tabpanel"] table tbody tr').length === expected &&
  !document.querySelector('[role="tabpanel"] [aria-busy="true"]'), count);
const selectTab = async (tab, count) => {
  const start = requests.length;
  await page.locator(`#admin-tab-${tab}`).click();
  await waitRows(count);
  const listRequests = requests.slice(start).filter((r) => r.path === `/${tab}`);
  assert.ok(listRequests.length, `${tab} must load`);
  for (const request of listRequests) {
    assert.equal(request.params.offset, "0", `${tab} must not inherit a page`);
    assert.equal(request.params.search, undefined, `${tab} must not inherit a search`);
    assert.equal(request.params.category_id, undefined, `${tab} must not inherit a category`);
  }
  assert.equal(await page.locator(`#${tab}-search`).inputValue(), "");
};
try {
  await page.goto(`${baseURL}/admin`);
  await selectTab("items", 200);
  await panel().getByRole("button", { name: "التالي", exact: true }).click();
  await waitRows(200);
  assert.equal(requests.at(-1).params.offset, "200");
  await panel().getByRole("button", { name: "التالي", exact: true }).click();
  await waitRows(50);
  assert.equal(requests.at(-1).params.offset, "400");
  await selectTab("categories", 3);
  await selectTab("machines", 7);
  await selectTab("items", 200);
  await page.locator("#items-search").fill("Item");
  await waitRows(200);
  await page.waitForFunction(() => document.querySelector("#items-search").value === "Item");
  await panel().getByRole("button", { name: "التالي", exact: true }).click();
  await waitRows(200);
  await selectTab("machines", 7);
  await page.locator("#machines-search").fill("Machine 6");
  await waitRows(1);
  await selectTab("categories", 3);
  await selectTab("items", 200);
  await page.locator("#items-category-filter").selectOption("CAT0");
  await page.waitForURL("**/admin?categoryId=CAT0");
  await waitRows(200);
  await panel().getByRole("button", { name: "التالي", exact: true }).click();
  await waitRows(200);
  await selectTab("categories", 3);
  await page.waitForURL((url) => url.pathname === "/admin" && !url.searchParams.has("categoryId"));
  await selectTab("items", 200);
  assert.equal(await page.locator("#items-category-filter").inputValue(), "");
  // Changing category within items resets the page too.
  await panel().getByRole("button", { name: "التالي", exact: true }).click();
  await waitRows(200);
  await page.locator("#items-category-filter").selectOption("CAT1");
  await panel().locator(".empty").waitFor();
  const filtered = requests.filter((r) => r.path === "/items" && r.params.category_id === "CAT1");
  assert.ok(filtered.length);
  assert.equal(filtered.at(-1).params.offset, "0");
  await page.locator("#items-category-filter").selectOption("");
  await waitRows(200);
  assert.deepEqual(writes, [], "navigation must never write records");
  assert.equal(JSON.stringify(fixtures), snapshot);
  assert.deepEqual(errors, []);
  console.log("PASS: page/search isolation, category lifecycle, unequal list sizes, no writes");
} finally {
  await browser.close();
}
