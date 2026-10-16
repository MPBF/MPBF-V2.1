// Test the built UI using a read-only static host and isolated API fixtures.
// No real account, authentication bypass, or business database is involved.
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");

(async () => {
  const root = path.resolve("dist/public");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "role-preview-browser-"));
  let language = "ar", originalAdmin = true, selected = null, ordinaryRoleId = 20;
  let failList = false, failMutation = false, deleted = false, roleLists = 0, passed = 0;
  const writes = [], errors = [];
  const choices = [
    { id: 10, name: "Administrator", name_ar: "مدير النظام", permissions: ["admin", "manage_orders"] },
    { id: 20, name: "Film operator", name_ar: "مشغل فيلم", permissions: ["operate_film"] },
    { id: 40, name: "No permissions", name_ar: "بلا صلاحيات", permissions: [] },
    { id: 70, name: "دور عربي فقط", name_ar: "دور عربي فقط", permissions: [] },
  ];
  if (process.argv.includes("--warehouse-only") || process.argv.includes("--warehouse-mobile")) choices.push({
    id: 8, name: "Warehouse Keeper", name_ar: "أمين المستودع",
    permissions: ["view_home", "view_user_dashboard", "view_production_hall", "receive_production",
      "view_finished_inventory", "manage_finished_warehouse", "view_raw_inventory", "manage_raw_materials",
      "view_warehouse", "manage_inventory", "view_inventory", "manage_warehouse"],
  });
  const currentUser = () => {
    const role = choices.find(r => r.id === (originalAdmin ? selected || 10 : ordinaryRoleId));
    return { id: 7, username: "fixture", display_name: "Fixture admin", display_name_ar: "مدير الاختبار",
      role_id: role.id, role_name: deleted ? null : role.name, role_name_ar: deleted ? null : role.name_ar,
      permissions: deleted ? [] : role.permissions, preferred_language: language, must_change_password: false,
      ...(originalAdmin ? { role_preview: { active: selected !== null, role_available: !deleted,
        original_role: { id: 10, name: "Administrator", name_ar: "مدير النظام" } } } : {}),
    };
  };
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.path === "/me") return res.json({ user: currentUser() });
    if (req.path === "/public-branding") return res.json({
      companyNameAr: "مصنع الاختبار", companyNameEn: "Fixture factory", defaultLanguage: language, logoSrc: null,
    });
    if (req.path === "/me/role-preview/roles") {
      roleLists++;
      if (failList) return res.status(503).json({ message: "تعذر تحميل الأدوار", message_en: "Role list unavailable" });
      return res.json({ roles: choices.map(({ id, name, name_ar }) => ({ id, name, name_ar })) });
    }
    if (req.path === "/me/role-preview") {
      writes.push({ method: req.method, body: req.body });
      if (failMutation) return res.status(503).json({ message: "تعذر تغيير الدور", message_en: "Role switch unavailable" });
      selected = req.method === "DELETE" ? null : req.body.role_id;
      deleted = false;
      return res.json({ success: true, user: currentUser() });
    }
    if (req.method !== "GET") {
      errors.push(`Unexpected fixture write ${req.method} ${req.path}`);
      return res.sendStatus(400);
    }
    if (req.path === "/self/attendance") return res.json(null);
    if (req.path.startsWith("/self/")) return res.json([]);
    if (req.path === "/dashboard") return res.json({ customers: 1, orders: 1, production_orders: 1, machines: 1, users: 1 });
    if (req.path === "/production/state") return res.json({
      orders: [], rolls: [], queues: [], machines: [], locations: [], inventory: [], receipts: [], movements: [],
      totals: { orders: 3, receipts: 5, movements: 7, inventory: 4, inventory_kg: "1250" },
    });
    if (req.path === "/production/mixing") return res.json({
      materials: process.argv.includes("--warehouse-mobile") ? [
        { id: 1, item_id: "RAW-TEST", code: "RAW-TEST", name: "Test raw material", name_ar: "خام اختبار", quantity_kg: "42", is_active: true },
      ] : [],
      machines: [], latest_mixes: [], records: [], next_before: null, raw_vouchers: [],
    });
    if (req.path === "/production/delivery-stock" || req.path === "/production/deliveries" || req.path.startsWith("/production/history/")) {
      return res.json({ records: [], next: null, total: 0, total_kg: "0" });
    }
    return res.json([]);
  });
  app.use(express.static(root));
  app.use((_req, res) => res.sendFile(path.join(root, "index.html")));
  const server = app.listen(0, "127.0.0.1");
  let chrome, ws;
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timed out")), 15000);
      chrome.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.once("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let serial = 0, sessionId;
    const pending = new Map();
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const p = pending.get(event.id);
        if (p) { pending.delete(event.id); event.error ? p.reject(Error(JSON.stringify(event.error))) : p.resolve(event.result); }
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      }
    });
    const send = (method, params = {}, attached = sessionId) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(attached ? { sessionId: attached } : {}) }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
    await send("Page.enable");
    await send("Runtime.enable");
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const check = (name, value, expected = true) => { assert.deepEqual(value, expected, name); passed++; console.log(`PASS ${name}`); };
    const open = async () => {
      await send("Page.navigate", { url: origin + "/" });
      await wait("!!document.querySelector('.shell')");
    };

    if (process.argv.includes("--warehouse-mobile")) {
      const routes = ["/warehouse/hall", "/warehouse/finished-inventory", "/warehouse/raw-materials"];
      const screenshotDir = path.resolve("generated-artifacts/warehouse-mobile");
      await fs.mkdir(screenshotDir, { recursive: true });
      for (const lang of ["ar", "en"]) for (const width of [320, 390, 430, 768, 1440]) {
        language = lang; originalAdmin = false; ordinaryRoleId = 8; selected = null;
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        for (const route of routes) {
          const label = `${lang} ${width} ${route}`;
          await evaluate("document.documentElement.dataset.previousFixtureDocument='yes'");
          await send("Page.navigate", { url: origin + route });
          await wait("!!document.documentElement&&!document.documentElement.dataset.previousFixtureDocument&&!!document.querySelector('.prod-view-nav, .raw-ops-nav')");
          await wait("!document.querySelector('.prod-loading, .raw-ops-skeleton')");
          const result = await evaluate(`(() => {
            const nav=document.querySelector('.prod-view-nav, .raw-ops-nav');
            const links=Array.from(nav.querySelectorAll('a'));
            const visible=element=>!!(element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden');
            const metrics=Array.from(document.querySelectorAll('.warehouse-summary .prod-stat'));
            return {
              hrefs:links.map(link=>link.getAttribute('href')),
              labels:links.map(link=>link.textContent.trim()),
              top:links.map(link=>Math.round(link.getBoundingClientRect().top)),
              unclipped:links.every(link=>link.scrollWidth<=link.clientWidth+1),
              minHeight:Math.min(...links.map(link=>link.getBoundingClientRect().height)),
              metrics:metrics.length,visibleMetrics:metrics.filter(visible).length,
              overflow:document.documentElement.scrollWidth>innerWidth+1
            };
          })()`);
          check(`${label} preserves three authorized routes`, result.hrefs, routes);
          if (lang === "ar") check(`${label} requested labels`, result.labels, ["صالة الإنتاج", "المنتجات التامة", "صالة الخام"]);
          check(`${label} no page overflow`, result.overflow, false);
          if (width <= 430) {
            check(`${label} tabs stay on one row`, new Set(result.top).size, 1);
            check(`${label} labels are not clipped`, result.unclipped);
            check(`${label} touch targets remain usable`, result.minHeight >= 43);
            check(`${label} statistics hidden`, result.visibleMetrics, 0);
          } else if (route !== "/warehouse/raw-materials") {
            check(`${label} desktop/tablet summaries retained`, result.metrics > 0 && result.visibleMetrics === result.metrics);
          }
          if (route === "/warehouse/raw-materials") {
            await wait("!!document.querySelector('.raw-stock-card')");
            check(`${label} raw material balance stays visible`, await evaluate(
              "Array.from(document.querySelectorAll('.raw-stock-card')).some(card=>card.innerText.includes('42'))"));
            check(`${label} receipt and issue remain available`, await evaluate(
              "Array.from(document.querySelectorAll('.raw-movement-launch-actions button')).filter(button=>!button.disabled).length>=2"));
          }
          if (width === 390 && lang === "ar") {
            const capture = await send("Page.captureScreenshot", { format: "png" });
            await fs.writeFile(path.join(screenshotDir, `${route.split("/").pop()}-ar-390.png`), Buffer.from(capture.data, "base64"));
          }
          // Exercise the actual links rather than only comparing their hrefs.
          await click(`${route === "/warehouse/raw-materials" ? ".raw-ops-nav" : ".prod-view-nav"} a[href="/warehouse/hall"]`);
          await wait("location.pathname==='/warehouse/hall'&&!!document.querySelector('.prod-view-nav')");
        }
      }
      check("warehouse mobile has no runtime errors or unexpected writes", errors, []);
      console.log(`${passed} warehouse mobile layout checks passed.`);
      return;
    }

    if (process.argv.includes("--warehouse-only")) {
      for (const lang of ["ar", "en"]) for (const width of [390, 1440]) {
        language = lang; originalAdmin = false; ordinaryRoleId = 8; selected = null;
        const label = `${lang} ${width}`;
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        await open();
        const expected = ["/my-dashboard", "/warehouse"];
        check(`${label} exactly two desktop links`, await evaluate(
          "Array.from(document.querySelectorAll('.sidebar .nav a')).map(a=>a.getAttribute('href'))"), expected);
        if (width === 390) {
          await wait("!!document.querySelector('.mobile-navigation-bar a')");
          check(`${label} exactly two mobile links`, await evaluate(
            "Array.from(document.querySelectorAll('.mobile-navigation-bar a')).map(a=>a.getAttribute('href'))"), expected);
        }
        check(`${label} ordinary keeper has no role switcher`, await evaluate("document.querySelectorAll('.rs-root').length"), 0);
        for (const blocked of ["/orders", "/customers", "/admin", "/hr", "/planning", "/production/film", "/production/printing", "/production/cutting", "/production/mixing"]) {
          await send("Page.navigate", { url: origin + blocked });
          await wait("location.pathname==='/my-dashboard'&&!!document.querySelector('.self-page')");
          check(`${label} rejects direct ${blocked}`, await evaluate("location.pathname"), "/my-dashboard");
        }
        for (const allowed of ["/warehouse/hall", "/warehouse/finished-inventory", "/warehouse/raw-materials"]) {
          await send("Page.navigate", { url: origin + allowed });
          await wait("!!document.querySelector('.prod-view-nav, .raw-ops-nav')");
          check(`${label} warehouse tab ${allowed} opens`, await evaluate("location.pathname"), allowed);
          check(`${label} warehouse tabs only`, await evaluate(
            "Array.from(document.querySelectorAll('.prod-view-nav a, .raw-ops-nav a')).every(a=>a.getAttribute('href').startsWith('/warehouse/'))"));
          check(`${label} fits viewport`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        }
        // Real preview UI: switch, enforce effective navigation, restore through the same chooser.
        originalAdmin = true; selected = null;
        await open();
        const placement = width <= 700 ? "mobile" : "sidebar";
        const selector = `.rs-${placement} .rs-trigger`;
        await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
        await click(selector);
        await wait("!!document.querySelector('[data-role-preview-role=\"8\"]')");
        await click('[data-role-preview-role="8"]');
        await wait(`!!document.querySelector(${JSON.stringify(selector + ".is-active")})`);
        check(`${label} preview uses keeper navigation`, await evaluate(
          "Array.from(document.querySelectorAll('.sidebar .nav a')).map(a=>a.getAttribute('href'))"), expected);
        await click(selector);
        await wait("!!document.querySelector('[data-role-preview-action=\"restore\"]:not(:disabled)')");
        await click('[data-role-preview-action="restore"]');
        await wait("!!document.querySelector('.sidebar .nav a[href=\"/admin\"]')");
        check(`${label} original admin restored`, selected, null);
      }
      check("no runtime exceptions or unexpected writes", errors, []);
      console.log(`${passed} warehouse access browser checks passed.`);
      return;
    }

    for (const lang of ["ar", "en"]) for (const width of [320, 390, 768, 1440]) {
      language = lang; originalAdmin = true; selected = null; deleted = false; roleLists = 0;
      const placement = width <= 700 ? "mobile" : "sidebar";
      const selector = `.rs-${placement} .rs-trigger`;
      const label = `${lang} ${width}`;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await open();
      await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
      check(`${label} switcher appears only in accessible placement`, await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().height>=44`));
      check(`${label} list loads only when opened`, roleLists, 0);
      check(`${label} sidebar control is in footer`, await evaluate("!!document.querySelector('.side-foot .rs-sidebar')"));
      await click(selector);
      await wait("!!document.querySelector('[data-role-preview-role=\"20\"]')");
      check(`${label} dialog fits width`, await evaluate("(()=>{const r=document.querySelector('.rs-dialog').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})()"));
      check(`${label} real-data warning is shown`, await evaluate(`document.querySelector('.rs-warning').innerText.includes(${JSON.stringify(lang === "ar" ? "بيانات حقيقية" : "real data")})`));
      check(`${label} original role is not duplicated`, await evaluate("document.querySelectorAll('.rs-option').length"), 4);
      if (lang === "en") check(`${label} missing English role name never falls back to Arabic`,
        await evaluate("document.querySelector('[data-role-preview-role=\"70\"]').innerText"), "Role 70\n›");
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await wait("!document.querySelector('.rs-dialog')");
      check(`${label} closing restores trigger focus`, await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`));
      await click(selector); await wait("!!document.querySelector('[data-role-preview-role=\"20\"]')");
      await click('[data-role-preview-role="20"]');
      await wait(`!!document.querySelector('.rs-${placement} .rs-trigger.is-active')`);
      check(`${label} separate return button is removed`, await evaluate("!document.querySelector('.rs-return')"));
      check(`${label} switch uses role id only`, writes.at(-1), { method: "POST", body: { role_id: 20 } });
      check(`${label} role persists through document reload`, selected, 20);
      check(`${label} admin navigation is removed`, await evaluate("!document.querySelector('.sidebar .nav a[href=\"/admin\"]')"));
      check(`${label} tested role remains visible in the change-role control`, await evaluate(`document.querySelector('.rs-${placement}').innerText.includes(${JSON.stringify(lang === "ar" ? "مشغل فيلم" : "Film operator")})`));
      check(`${label} active control fits viewport`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      await click(selector);
      await wait("!!document.querySelector('[data-role-preview-action=\"restore\"]:not(:disabled)')");
      await click('[data-role-preview-action="restore"]');
      await wait(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector('.rs-return')&&!!document.querySelector('.sidebar .nav a[href="/admin"]')`);
      check(`${label} restore clears preview`, writes.at(-1).method, "DELETE");
      check(`${label} restore returns original permissions`, selected, null);
      originalAdmin = false;
      await open();
      check(`${label} ordinary user never sees switcher`, await evaluate("document.querySelectorAll('.rs-root').length"), 0);
    }

    language = "en"; originalAdmin = true; selected = 40; deleted = false;
    await open(); await wait("!!document.querySelector('.rs-sidebar .rs-trigger.is-active')");
    check("no-permission preview still offers role selection without a separate return button", await evaluate("!!document.querySelector('.rs-sidebar .rs-trigger')&&!document.querySelector('.rs-return')"));
    deleted = true; await open(); await wait("!!document.querySelector('.rs-sidebar .rs-trigger.is-active')");
    check("deleted role fails visibly instead of claiming original permissions", await evaluate("document.querySelector('.rs-sidebar').innerText.includes('Role unavailable')"));
    failMutation = true;
    await click(".rs-sidebar .rs-trigger");
    await wait("!!document.querySelector('[data-role-preview-action=\"restore\"]:not(:disabled)')");
    await click('[data-role-preview-action="restore"]');
    await wait("!!document.querySelector('.rs-dialog [role=\"alert\"]')");
    check("failed return is reported inside the role chooser", await evaluate("document.querySelector('.rs-dialog [role=\"alert\"]').innerText"), "Role switch unavailable");
    failMutation = false;
    await click('[data-role-preview-action="restore"]');
    await wait("!document.querySelector('.rs-dialog')&&!!document.querySelector('.rs-sidebar .rs-trigger:not(.is-active)')");
    failList = true;
    await click(".rs-sidebar .rs-trigger"); await wait("!!document.querySelector('.rs-dialog [role=\"alert\"]')");
    check("role-list failure is explicit and retryable", await evaluate("!!document.querySelector('.rs-retry')"));
    failList = false;
    await click(".rs-retry"); await wait("!!document.querySelector('[data-role-preview-role=\"20\"]')");
    failMutation = true;
    await click('[data-role-preview-role="20"]'); await wait("!!document.querySelector('.rs-dialog [role=\"alert\"]')");
    check("failed switch leaves original role and chooser intact", selected, null);
    check("failed switch has translated English error", await evaluate("document.querySelector('.rs-dialog [role=\"alert\"]').innerText"), "Role switch unavailable");
    failMutation = false;
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait("!document.querySelector('.rs-dialog')");
    await evaluate("document.body.dataset.reloadProbe='before';window.dispatchEvent(new StorageEvent('storage',{key:'mpbf:role-preview-changed',newValue:'changed'}))");
    await wait("!!document.querySelector('.rs-sidebar')&&!document.body.dataset.reloadProbe");
    check("other-tab role change resets the local document", await evaluate("document.body.dataset.reloadProbe===undefined"));
    check("no unexpected business writes or runtime errors", errors, []);
    console.log(`Verified ${passed} role-preview browser assertions against isolated built-UI fixtures.`);
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill("SIGTERM"); await exited;
    }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
