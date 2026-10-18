// Real customer-profile UI with every API call intercepted. No real sign-in,
// application data reads, or database writes.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "customer-history-browser-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0",
      `--user-data-dir=${temp}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws, session, language = "ar", mode = "normal", failed = false, checks = 0;
  const errors = [], requests = [];
  let pendingOldHistory, oldHistoryResolved;
  const check = (name, value, expected = true) => {
    assert.deepEqual(value, expected, name); checks++; console.log(`PASS ${name}`);
  };
  const order = (id, customer = "C1") => ({
    id, order_number: `${customer}-O${id}`, created_at: `2026-10-${String(22 - id).padStart(2, "0")}T10:00:00`,
    production_orders: id === 1 ? [
      { id: 101, production_order_number: `${customer}-JO1`, requested_kg: "1234.56", produced_kg: "1001.25" },
      { id: 102, production_order_number: `${customer}-JO2`, requested_kg: "500.00", produced_kg: "0" },
    ] : [{ id: 100 + id, production_order_number: `${customer}-JO${id + 1}`, requested_kg: "50.00", produced_kg: "45.10" }],
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.stderr.on("data", chunk => {
        output += String(chunk);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let serial = 0;
    const pending = new Map();
    const send = (method, params = {}, attached = true) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(attached && session ? { sessionId: session } : {}) }));
    });
    const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
      requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    });
    const intercept = async event => {
      const { request, requestId } = event.params;
      const url = new URL(request.url);
      const route = url.pathname.replace(/^\/api/, "");
      requests.push({ route, method: request.method });
      if (request.method !== "GET") throw Error(`Unexpected write: ${request.method} ${route}`);
      let body = [];
      if (route === "/me") body = { user: { id: 42, username: "fixture", display_name_ar: "مستخدم تجريبي",
        display_name: "Fixture user", permissions: ["manage_customers"], preferred_language: language } };
      else if (route === "/public-branding") body = { companyNameAr: "مصنع الاختبار", companyNameEn: "Fixture factory" };
      else if (/^\/customers\/[^/]+\/detail$/.test(route)) {
        const id = route.split("/")[2];
        body = { customer: { id, name_ar: `عميل ${id}`, name: `Customer ${id}`, is_active: true },
          products: [{ id: 1, customer_id: id, item_name_ar: "صنف تجريبي", item_name: "Fixture item",
            name_ar: "صنف تجريبي", name: "Fixture item", category_name_ar: "أكياس", category_name: "Bags",
            width: 30, thickness: 50, status: "active" }] };
      } else if (/^\/customers\/[^/]+\/order-history$/.test(route)) {
        const customer = route.split("/")[2];
        const offset = Number(url.searchParams.get("offset") || 0);
        if (mode === "stale" && customer === "C1") {
          pendingOldHistory = () => fulfill(requestId, { orders: [order(1, "STALE")], has_more: false, next_offset: null });
          return;
        }
        if (!failed && (mode === "failFirst" || mode === "failMore" && offset === 20)) {
          failed = true;
          return fulfill(requestId, { message: "سجل الاختبار غير متاح", message_en: "History temporarily unavailable" }, 503);
        }
        body = mode === "empty" ? { orders: [], has_more: false, next_offset: null }
          : offset === 0
            ? { orders: Array.from({ length: 20 }, (_, i) => order(i + 1, customer)), has_more: true, next_offset: 20 }
            : { orders: [order(21, customer)], has_more: false, next_offset: null };
      }
      await fulfill(requestId, body);
    };
    ws.on("message", raw => {
      const event = JSON.parse(raw);
      if (event.id && pending.has(event.id)) {
        const task = pending.get(event.id); pending.delete(event.id);
        event.error ? task.reject(Error(event.error.message)) : task.resolve(event.result);
      } else if (event.method === "Fetch.requestPaused") {
        intercept(event).catch(error => errors.push(error.message));
      } else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, false);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
    await send("Runtime.enable"); await send("Page.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      throw Error(`Timeout: ${expression}`);
    };
    const navigate = async (customer = "C1") => {
      await send("Page.navigate", { url: `http://127.0.0.1:5000/customers/${customer}` });
      await wait("!!document.querySelector('.customer-history')");
    };
    const ready = () => wait("document.querySelectorAll('.customer-history__table tbody').length===20");
    for (language of ["ar", "en"]) {
      for (const width of [390, 768, 1440]) {
        mode = "normal"; failed = false;
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
        await navigate(); await ready();
        const context = `${language} ${width}px`;
        check(`${context} title is localized`, await evaluate("document.querySelector('#customer-history-title').textContent"),
          language === "ar" ? "سجل طلبات العميل" : "Customer order history");
        check(`${context} appears below product table`, await evaluate(`(() => {
          const h=document.querySelector('.customer-history');
          const p=[...document.querySelectorAll('section.panel')].find(s=>!s.classList.contains('customer-history')&&s.querySelector('table'));
          return !!p && !!(p.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING);
        })()`));
        check(`${context} groups multiple production orders under one customer order`,
          await evaluate("document.querySelector('.customer-history__table tbody th').rowSpan"), 2);
        check(`${context} exact formatted actual quantity, never a target fallback`,
          await evaluate("[...document.querySelectorAll('.customer-history__table tbody:first-of-type .customer-history__actual')].map(e=>e.textContent)"),
          ["1,001.25", "0"]);
        check(`${context} Gregorian order date`, await evaluate("document.querySelector('.customer-history__date').textContent.includes('2026')"));
        check(`${context} no page overflow`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        check(`${context} responsive layout`, await evaluate("getComputedStyle(document.querySelector('.customer-history__mobile')).display==='none'"), width > 1100);
        await evaluate("document.querySelector('.customer-history').scrollIntoView({block:'start'})");
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        await fs.writeFile(path.join(temp, `${language}-${width}.png`), Buffer.from(screenshot.data, "base64"));
        await wait("!!document.querySelector('.customer-history__footer button')");
        await evaluate("document.querySelector('.customer-history__footer button').click()");
        await wait("document.querySelectorAll('.customer-history__table tbody').length===21");
        check(`${context} last page appends and hides load-more`, await evaluate("!document.querySelector('.customer-history__footer button')"));
      }
      mode = "empty"; await navigate();
      await wait("!!document.querySelector('.customer-history__empty')");
      check(`${language} empty state localized`, await evaluate("document.querySelector('.customer-history__empty strong').textContent"),
        language === "ar" ? "لا يوجد سجل طلبات لهذا العميل" : "No order history for this customer");
      mode = "failFirst"; failed = false; await navigate();
      await wait("!!document.querySelector('.customer-history [role=alert]')");
      await evaluate("document.querySelector('.customer-history [role=alert] button').click()");
      await ready();
      check(`${language} initial error can retry without reloading profile`, await evaluate("!!document.querySelector('.customer-summary')"));
      mode = "failMore"; failed = false; await navigate(); await ready();
      await evaluate("document.querySelector('.customer-history__footer button').click()");
      await wait("!!document.querySelector('.customer-history [role=alert]')");
      check(`${language} later-page errors preserve loaded orders`,
        await evaluate("document.querySelectorAll('.customer-history__table tbody').length"), 20);
      await evaluate("document.querySelector('.customer-history [role=alert] button').click()");
      await wait("document.querySelectorAll('.customer-history__table tbody').length===21");
      check(`${language} retry appends once`, await evaluate("!document.querySelector('.customer-history [role=alert]')"));
    }
    mode = "stale"; await navigate();
    await wait("!!document.querySelector('.customer-history [aria-busy=true]')");
    while (!pendingOldHistory) await new Promise(resolve => setTimeout(resolve, 20));
    await evaluate("history.pushState(null,'','/customers/C2');dispatchEvent(new PopStateEvent('popstate'))");
    await wait("!!document.querySelector('.customer-history__table tbody th')&&document.querySelector('.customer-history__table tbody th').textContent==='C2-O1'");
    await pendingOldHistory(); oldHistoryResolved = true;
    await new Promise(resolve => setTimeout(resolve, 100));
    check("slow previous-customer response never replaces current history",
      await evaluate("!document.querySelector('.customer-history').textContent.includes('STALE')&&document.querySelector('.customer-history__table tbody th').textContent==='C2-O1'"));
    check("every history request is customer-scoped and bounded", requests.filter(r => r.route.endsWith("/order-history")).every(r => /^\/customers\/C[12]\/order-history$/.test(r.route)));
    check("no browser exceptions", errors, []);
    check("no data writes", requests.every(r => r.method === "GET"));
    console.log(`Customer history passed ${checks} browser checks; screenshots: ${temp}`);
  } finally {
    // Unblock any deliberately delayed interception before closing Chromium.
    if (pendingOldHistory && !oldHistoryResolved) await pendingOldHistory().catch(() => {});
    ws?.close(); chrome.kill("SIGTERM");
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
