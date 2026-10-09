// Browser/API fixtures only. No real role or production records are changed.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const keys = ["view_finished_inventory", "receive_production", "manage_finished_warehouse"];
const labels = {
  ar: ["عرض مخزون الإنتاج التام", "استلام الإنتاج التام", "إدارة مواقع الإنتاج التام"],
  en: ["View finished production inventory", "Receive finished production", "Manage finished production storage locations"],
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  try {
    for (const language of ["ar", "en"]) {
      for (const width of [1280, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        const writes = [];
        let permissions = ["admin"];
        const legacy = { id: 8, name: "Warehouse Keeper", name_ar: "أمين المستودع", permissions: ["manage_warehouse", "view_inventory", "manage_production_hall", "legacy_unknown"] };
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/api/**", async route => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          let body = [];
          if (request.method() !== "GET") {
            assert.match(path, /^\/api\/roles(?:\/8)?$/);
            assert(permissions.includes("admin"), "Fixture must reject unauthorized role writes");
            writes.push({ method: request.method(), body: request.postDataJSON() });
            body = { id: 100, ...request.postDataJSON() };
          } else if (path === "/api/me") {
            body = { user: { id: 83, username: "fixture", display_name: "Test Admin", display_name_ar: "مسؤول تجريبي", permissions, preferred_language: language } };
          } else if (path === "/api/roles") body = [legacy];
          else if (path === "/api/company-profile") body = { name: "Test Factory", name_ar: "مصنع تجريبي" };
          else if (path === "/api/production/state") body = { orders: [], rolls: [], queues: [], machines: [], locations: [], inventory: [], receipts: [], movements: [], totals: { orders: 0, rolls: 0, receipts: 0, movements: 0, inventory: 0, inventory_kg: "0" } };
          else if (path.startsWith("/api/production/history/")) body = { records: [], next: null, total: 0, total_kg: "0" };
          await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        });
        await page.goto(`${origin}/admin`);
        await page.locator("#admin-tab-roles").click();
        const addName = language === "ar" ? "إضافة دور" : "Add role";
        const saveName = language === "ar" ? "حفظ الدور" : "Save role";
        for (let index = 0; index < keys.length; index++) {
          await page.getByRole("button", { name: addName, exact: true }).click();
          const dialog = page.getByRole("dialog");
          await dialog.locator("#role-name").fill(`minimal-${keys[index]}`);
          const box = dialog.getByRole("checkbox", { name: new RegExp(`^${labels[language][index]}`) });
          await box.check();
          assert.equal(await dialog.locator('input[type="checkbox"]:checked').count(), 1);
          const descriptionId = await box.getAttribute("aria-describedby");
          const description = await dialog.locator(`#${descriptionId}`).innerText();
          assert(description.length > 30);
          if (language === "en") assert(!/[\u0600-\u06ff]/.test(description));
          await dialog.getByRole("button", { name: saveName, exact: true }).click();
          await dialog.waitFor({ state: "hidden" });
          assert.deepEqual(writes.at(-1).body.permissions, [keys[index]]);
          assert.equal(writes.at(-1).method, "POST");
        }
        // Opening and saving an existing legacy role never adds the new grants.
        await page.locator(".role-card").first().getByRole("button").first().click();
        await page.getByRole("dialog").getByRole("button", { name: saveName, exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.deepEqual(writes.at(-1).body.permissions, legacy.permissions);
        assert.equal(writes.at(-1).method, "PUT");
        // Selecting this group must not select the unrelated legacy warehouse group.
        await page.getByRole("button", { name: addName, exact: true }).click();
        const group = page.locator(".permission-group").filter({ has: page.locator(".permission-group-head strong", { hasText: language === "ar" ? "الاستلام والمخزون التام" : "Receiving and finished inventory" }) });
        await group.getByRole("button").click();
        assert.equal(await page.getByRole("dialog").locator('input[type="checkbox"]:checked').count(), 3);
        await group.getByRole("button").click();
        assert.equal(await page.getByRole("dialog").locator('input[type="checkbox"]:checked').count(), 0);
        await page.keyboard.press("Escape");
        // A role editor without these grants cannot grant them.
        permissions = ["manage_roles"];
        await page.reload();
        await page.locator("#admin-tab-roles").click();
        await page.getByRole("button", { name: addName, exact: true }).click();
        for (const label of labels[language]) assert(await page.getByRole("checkbox", { name: new RegExp(`^${label}`) }).isDisabled());
        await page.keyboard.press("Escape");
        // Minimum roles open their production pages, without manufacturing tabs.
        for (const key of keys) {
          permissions = [key];
          await page.goto(`${origin}/production/${key === "receive_production" ? "hall" : "warehouse"}`);
          await page.locator(".prod-view-nav").waitFor();
          const hrefs = await page.locator(".prod-view-nav a").evaluateAll(links => links.map(link => link.getAttribute("href")));
          assert.deepEqual(hrefs, key === "receive_production" ? ["/production/hall", "/production/warehouse"] : ["/production/warehouse"]);
        }
        assert.deepEqual(errors, []);
        console.log(`PASS role create/edit/grant boundaries and minimum navigation: ${language}, ${width}px`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
