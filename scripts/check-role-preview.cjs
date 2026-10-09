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
  let language = "ar", originalAdmin = true, selected = null;
  let failList = false, failMutation = false, deleted = false, roleLists = 0, passed = 0;
  const writes = [], errors = [];
  const choices = [
    { id: 10, name: "Administrator", name_ar: "مدير النظام", permissions: ["admin", "manage_orders"] },
    { id: 20, name: "Film operator", name_ar: "مشغل فيلم", permissions: ["operate_film"] },
    { id: 40, name: "No permissions", name_ar: "بلا صلاحيات", permissions: [] },
    { id: 70, name: "دور عربي فقط", name_ar: "دور عربي فقط", permissions: [] },
  ];
  const currentUser = () => {
    const role = choices.find(r => r.id === (originalAdmin ? selected || 10 : 20));
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
      await wait(`!!document.querySelector('.rs-${placement} .rs-return')`);
      check(`${label} switch uses role id only`, writes.at(-1), { method: "POST", body: { role_id: 20 } });
      check(`${label} role persists through document reload`, selected, 20);
      check(`${label} admin navigation is removed`, await evaluate("!document.querySelector('.sidebar .nav a[href=\"/admin\"]')"));
      check(`${label} tested role and return remain visible`, await evaluate(`document.querySelector('.rs-${placement}').innerText.includes(${JSON.stringify(lang === "ar" ? "مشغل فيلم" : "Film operator")})`));
      check(`${label} active control fits viewport`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      await click(`.rs-${placement} .rs-return`);
      await wait(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector('.rs-return')&&!!document.querySelector('.sidebar .nav a[href="/admin"]')`);
      check(`${label} restore clears preview`, writes.at(-1).method, "DELETE");
      check(`${label} restore returns original permissions`, selected, null);
      originalAdmin = false;
      await open();
      check(`${label} ordinary user never sees switcher`, await evaluate("document.querySelectorAll('.rs-root').length"), 0);
    }

    language = "en"; originalAdmin = true; selected = 40; deleted = false;
    await open(); await wait("!!document.querySelector('.rs-sidebar .rs-return')");
    check("no-permission preview still offers a return", await evaluate("!!document.querySelector('.rs-sidebar .rs-return')"));
    deleted = true; await open(); await wait("!!document.querySelector('.rs-sidebar .rs-return')");
    check("deleted role fails visibly instead of claiming original permissions", await evaluate("document.querySelector('.rs-sidebar').innerText.includes('Role unavailable')"));
    failMutation = true;
    await click(".rs-sidebar .rs-return"); await wait("!!document.querySelector('.rs-sidebar [role=\"alert\"]')");
    check("failed direct return is visible without opening dialog", await evaluate("document.querySelector('.rs-sidebar [role=\"alert\"]').innerText"), "Role switch unavailable");
    failMutation = false;
    await click(".rs-sidebar .rs-return"); await wait("!document.querySelector('.rs-return')&&!!document.querySelector('.rs-sidebar')");
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
