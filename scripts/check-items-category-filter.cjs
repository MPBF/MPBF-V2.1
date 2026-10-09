// Real app browser checks with intercepted APIs; never reads or writes business data.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "items-category-"));
  let chrome, ws, session, serial = 0, failCategories = false, slow = false, fixtureLanguage = "ar", fixturePermissions = ["manage_items", "manage_categories"];
  const pending = new Map(), errors = [], requests = [];
  const categories = Array.from({ length: 201 }, (_, i) => ({
    id: `CAT${String(i + 1).padStart(3, "0")}`, name: `Category ${i + 1}`, name_ar: `تصنيف ${i + 1}`,
  }));
  const items = Array.from({ length: 250 }, (_, i) => ({
    id: `ITM${i + 1}`, category_id: i < 220 ? "CAT001" : "CAT002",
    name: i === 219 ? "Needle" : `Item ${i + 1}`, name_ar: i === 219 ? "Needle" : `صنف ${i + 1}`,
    category_name: i < 220 ? "Category 1" : "Category 2",
    category_name_ar: i < 220 ? "تصنيف 1" : "تصنيف 2", status: "active",
  }));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.on("error", reject);
      chrome.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}, sid = session) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const p = pending.get(event.id);
        if (p) { pending.delete(event.id); event.error ? p.reject(Error(JSON.stringify(event.error))) : p.resolve(event.result); }
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      } else if (event.method === "Fetch.requestPaused") void (async () => {
        const { requestId, request } = event.params, url = new URL(request.url);
        assert.equal(request.method, "GET", "No business writes allowed");
        let body = [], status = 200;
        const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 200);
        if (url.pathname === "/api/me") body = { user: { id: 42, username: "fixture", display_name_ar: "مستخدم تجريبي", preferred_language: fixtureLanguage, permissions: fixturePermissions } };
        if (url.pathname === "/api/public-branding") body = { companyNameAr: "مصنع تجريبي", companyNameEn: "Test Factory", logoSrc: "" };
        if (url.pathname === "/api/categories" && !fixturePermissions.some(p => ["admin", "manage_categories"].includes(p))) {
          status = 403; body = { message: "لا تملك صلاحية تنفيذ هذا الإجراء" };
        }
        if (url.pathname === "/api/items/category-options") {
          if (failCategories) { failCategories = false; status = 500; body = { message: "تعذر تحميل التصنيفات" }; }
          else body = categories.slice(offset, offset + limit);
        }
        if (url.pathname === "/api/items") {
          requests.push(Object.fromEntries(url.searchParams));
          const category = url.searchParams.get("category_id"), search = (url.searchParams.get("search") || "").toLowerCase();
          body = items.filter(item => (!category || item.category_id === category) &&
            (!search || `${item.name} ${item.name_ar} ${item.id}`.toLowerCase().includes(search))).slice(offset, offset + limit);
          if (slow && category === "CAT001") await sleep(300);
        }
        await send("Fetch.fulfillRequest", { requestId, responseCode: status,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") }, event.sessionId);
      })().catch(error => errors.push(error.stack));
    });
    const targetId = (await send("Target.createTarget", { url: "about:blank" }, null)).targetId;
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, null)).sessionId;
    await send("Page.enable"); await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await sleep(100); }
      throw Error(`Timed out: ${expression}`);
    };
    const set = (selector, value) => evaluate(`(()=>{
      const e=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const openItems = async () => {
      await evaluate("window.__categoryFixtureNavigating=true");
      await send("Page.navigate", { url: `${origin}/admin` });
      await wait("!window.__categoryFixtureNavigating&&!!document.querySelector('#admin-tab-items')");
      await evaluate("document.querySelector('#admin-tab-items').click()");
      await wait("!!document.querySelector('#items-category-filter')");
    };
    const loaded = count => wait(`document.querySelectorAll('tbody tr').length===${count}&&!document.querySelector('.panel .skeleton')`);
    for (const width of [390, 768, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await openItems();
      await wait("document.querySelector('#items-category-filter').options.length===202&&!document.querySelector('#items-category-filter').disabled");
      await loaded(200);
      assert.equal(await evaluate("document.querySelector('#items-category-filter').value"), "");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, `${width}: viewport fit`);
      assert.equal(await evaluate("(()=>{const r=document.querySelector('#items-category-filter').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"), true);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='التالي').click()");
      await loaded(50);
      await set("#items-category-filter", "CAT001"); await loaded(200);
      assert.equal(requests.at(-1).offset, "0"); assert.equal(requests.at(-1).category_id, "CAT001");
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='التالي').click()");
      await loaded(20);
      assert.equal(requests.at(-1).offset, "200"); assert.equal(requests.at(-1).category_id, "CAT001");
      await set("#items-search", "Needle"); await loaded(1);
      assert.equal(requests.at(-1).search, "Needle"); assert.equal(requests.at(-1).category_id, "CAT001");
      assert.equal(requests.at(-1).offset, "0");
      await set("#items-search", ""); await loaded(200);
      await set("#items-category-filter", "CAT201"); await loaded(0);
      assert.equal(await evaluate("!!document.querySelector('.empty')"), true);
      await set("#items-category-filter", ""); await loaded(200);
      assert.equal(requests.at(-1).category_id, undefined);
      console.log(`PASS ${width}: complete category list, layout, category/search intersection, pagination reset, empty category and all categories`);
    }
    slow = true;
    await set("#items-category-filter", "CAT001"); await sleep(50);
    await set("#items-category-filter", "CAT002"); await loaded(30); await sleep(450);
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), 30);
    assert.equal(await evaluate("document.querySelector('tbody').textContent.includes('صنف 221')"), true);
    slow = false;
    // Previously this role could open Items but its filter was disabled by the
    // category-management endpoint's 403. Exercise the least-privileged path.
    fixturePermissions = ["manage_items"];
    await openItems();
    await wait("document.querySelector('#items-category-filter').options.length===202&&!document.querySelector('#items-category-filter').disabled");
    await set("#items-category-filter", "CAT002"); await loaded(30);
    assert.equal(requests.at(-1).category_id, "CAT002");
    assert.equal(await evaluate("!!document.querySelector('#admin-tab-categories')"), false);
    console.log("PASS item-only role: working classification filter without category-management access");
    fixturePermissions = ["admin"];
    await openItems(); await loaded(200);
    await wait("document.querySelector('#items-category-filter').options.length===202&&!document.querySelector('#items-category-filter').disabled");
    await set("#items-category-filter", "CAT002"); await loaded(30);
    assert.equal(requests.at(-1).category_id, "CAT002");
    assert.equal(await evaluate("document.querySelector('#admin-tab-items').getAttribute('aria-selected')"), "true");
    console.log("PASS admin role: selection stays on Items and filters the displayed records");
    await evaluate("document.querySelector('#admin-tab-categories').click()");
    await wait("!document.querySelector('#items-category-filter')");
    failCategories = true;
    await evaluate("document.querySelector('#admin-tab-items').click()");
    await wait("!!document.querySelector('.entity-category-error')");
    await evaluate("document.querySelector('.entity-category-error button').click()");
    await wait("!document.querySelector('.entity-category-error')&&document.querySelector('#items-category-filter').options.length===202&&!document.querySelector('#items-category-filter').disabled");
    fixtureLanguage = "en";
    for (const width of [1440, 768, 390]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await openItems(); await loaded(200);
      await wait("document.querySelector('#items-category-filter').options.length===202");
      assert.equal(await evaluate("document.querySelector('#items-category-filter').options[0].textContent"), "All categories");
      assert.equal(await evaluate("document.querySelector('#items-category-filter').options[201].textContent"), "Category 201");
      assert.equal(await evaluate("document.documentElement.dir"), "ltr");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
      console.log(`PASS en ${width}: translated filter and viewport fit`);
    }
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(profile, "items-category-filter.png"), Buffer.from(screenshot.data, "base64"));
    assert.deepEqual(errors, []);
    console.log("PASS stale-response protection, scoped filter, lookup failure/retry and no browser exceptions/business writes");
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => chrome.kill("SIGKILL"), 5000);
      chrome.once("exit", () => { clearTimeout(timer); resolve(); }); chrome.kill("SIGTERM");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
