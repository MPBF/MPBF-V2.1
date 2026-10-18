// Real rendered UI, synthetic intercepted API only; no auth bypass in app code.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-browser-"));
  const chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0",
      `--user-data-dir=${temp}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws, session, language = "ar", permission = "manage_production", mode = "normal", failed = false, checks = 0;
  const errors = [], requests = [];
  let delayed;
  const check = (name, actual, expected = true) => {
    assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
  };
  const actor = { id: 7, display_name: "Worker", display_name_ar: "عامل", full_name: "اسم عربي", username: "worker" };
  const operation = { actor, machine_name: "Machine", machine_name_ar: "ماكينة", at: "2026-10-18T09:30:00Z" };
  const production = [
    { id: 11, production_order_number: "JO-11", status: "in_production", stage: "cutting", product_name: "Bag", product_name_ar: "كيس",
      requested_kg: "100.00", planned_kg: "120.00", produced_kg: "35.20", waste_kg: "5.05", roll_count: 3, completed_rolls: 1,
      contributions: ["film", "printing", "cutting"].map((stage, i) => ({ stage, actor, quantity_kg: ["70.25", "50.25", "35.20"][i], roll_count: 1 })) },
    { id: 12, production_order_number: "JO-12", status: "completed", stage: "completed", product_name: "Roll", product_name_ar: "رول",
      requested_kg: "50.00", planned_kg: "60.00", produced_kg: "72.15", waste_kg: "0", roll_count: 1, completed_rolls: 1, contributions: [] },
  ];
  const roll = id => ({ id, roll_number: `R-${id}`, production_order_id: 11, production_order_number: "JO-11",
    stage: "done", weight_kg: "40.25", net_weight_kg: "35.20", waste_kg: "5.05", is_roll_product: false,
    film: operation, printing: operation, cutting: operation });
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
    await new Promise(resolve => ws.once("open", resolve));
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
      const url = new URL(request.url), route = url.pathname.replace(/^\/api/, "");
      requests.push({ route, method: request.method, query: url.search });
      if (request.method !== "GET") throw Error(`Unexpected write ${route}`);
      let body = [];
      if (route === "/me") body = { user: { id: 42, username: "fixture",
        permissions: permission === "manage_production" ? [permission, "view_orders"] : [permission],
        preferred_language: language } };
      else if (route === "/public-branding") body = { companyNameAr: "مصنع الاختبار", companyNameEn: "Fixture factory" };
      else if (/^\/orders\/\d+\/workflow$/.test(route)) {
        const offset = Number(url.searchParams.get("offset") || 0);
        if (!failed && (mode === "failFirst" || mode === "failMore" && offset > 0)) {
          failed = true; return fulfill(requestId, { message: "خطأ اختباري", message_en: "Fixture error" }, 503);
        }
        const empty = mode === "empty" || url.searchParams.get("search") === "NOTFOUND";
        const filtered = url.searchParams.has("stage") || url.searchParams.has("production_order_id");
        body = { order: { id: Number(route.split("/")[2]), order_number: "O0004", created_at: "2026-10-18T10:00:00Z",
          delivery_date: "2026-10-31", status: "in_production", customer_name: "Customer", customer_name_ar: "عميل" },
          production_orders: mode === "empty" ? [] : production, rolls: empty ? [] : offset ? [roll(31)] : filtered ? [roll(1)] : Array.from({ length: 30 }, (_, i) => roll(i + 1)),
          has_more: !empty && !offset && !filtered, next_offset: !empty && !offset && !filtered ? 30 : null };
        if (mode === "slow" && url.searchParams.get("search") === "OLD") {
          delayed = () => fulfill(requestId, { ...body, rolls: [roll(999)] });
          return;
        }
      } else if (/^\/customers\/[^/]+\/detail$/.test(route)) body = {
        customer: { id: "C1", name: "Customer", name_ar: "عميل", is_active: true }, products: [],
      };
      else if (route.endsWith("/order-history")) body = { orders: [{ id: 1, order_number: "O0004", created_at: "2026-10-18", production_orders: [] }], has_more: false, next_offset: null };
      else if (route === "/orders") body = [{ id: 1, order_number: "O0004", customer_id: "C1", customer_name: "Customer", customer_name_ar: "عميل", created_at: "2026-10-18", status: "waiting", production_orders: [] }];
      else if (route === "/orders/counts") body = {};
      await fulfill(requestId, body);
    };
    ws.on("message", raw => {
      const event = JSON.parse(raw);
      if (event.id && pending.has(event.id)) {
        const task = pending.get(event.id); pending.delete(event.id);
        event.error ? task.reject(Error(event.error.message)) : task.resolve(event.result);
      } else if (event.method === "Fetch.requestPaused") intercept(event).catch(error => errors.push(error.message));
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
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
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      throw Error(`Timeout ${expression}`);
    };
    const navigate = async (route = "/orders/1/workflow") => {
      await send("Page.navigate", { url: `http://127.0.0.1:5000${route}` });
      await wait("!!document.querySelector('.workflow-page,.customer-history,.order-number-code')");
    };
    const ready = () => wait("document.querySelectorAll('.workflow-roll').length===30");
    const change = (selector, value, kind = "input") => evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(${kind === "input" ? "HTMLInputElement" : "HTMLSelectElement"}.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event(${JSON.stringify(kind === "input" ? "input" : "change")},{bubbles:true}));
    })()`);
    for (language of ["ar", "en"]) for (const width of [390, 768, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      mode = "normal"; await navigate(); await ready();
      const context = `${language} ${width}`;
      check(`${context} title`, await evaluate("document.querySelector('.workflow-title-row h1').textContent"), language === "ar" ? "سير العمل" : "Order workflow");
      check(`${context} contributions have person names`, await evaluate("document.querySelector('.workflow-contribution strong').textContent"), language === "ar" ? "عامل" : "Worker");
      check(`${context} operation actor name correct`, await evaluate("document.querySelector('.workflow-operation').textContent.includes(" + JSON.stringify(language === "ar" ? "عامل" : "Worker") + ")"));
      check(`${context} date includes operation time`, await evaluate("document.querySelector('.workflow-operation time').textContent.includes(':')"));
      const overflow = await evaluate("document.documentElement.scrollWidth <= innerWidth+1");
      if (!overflow) console.log(await evaluate(`JSON.stringify([...document.querySelectorAll('.workflow-page *')].filter(e=>{
        const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;
      }).slice(0,15).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})))`));
      check(`${context} no overflow`, overflow);
      if (language === "en") check(`${context} strict English`, await evaluate("!/[\\u0600-\\u06ff]/u.test(document.querySelector('.workflow-page').textContent)"));
      const image = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(temp, `${language}-${width}.png`), Buffer.from(image.data, "base64"));
      await evaluate("document.querySelector('.workflow-roll').scrollIntoView({block:'start'})");
      const detailImage = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(temp, `${language}-${width}-rolls.png`), Buffer.from(detailImage.data, "base64"));
      await evaluate("document.querySelector('.workflow-load-more button').click()");
      await wait("document.querySelectorAll('.workflow-roll').length===31");
      check(`${context} last page`, await evaluate("!document.querySelector('.workflow-load-more button')"));
      await change(".workflow-filters select", "11", "select");
      await wait("document.querySelectorAll('.workflow-roll').length===1&&!document.querySelector('.workflow-skeleton')");
      check(`${context} filter retains summary`, await evaluate("document.querySelectorAll('.workflow-po').length"), 2);
    }
    mode = "normal"; await navigate(); await ready();
    await evaluate("document.querySelector('.workflow-search input').focus()");
    await change(".workflow-search input", "NOTFOUND");
    await wait("!!document.querySelector('.workflow-empty--rolls')");
    check("search preserves input and keyboard focus", await evaluate("document.activeElement===document.querySelector('.workflow-search input')"));
    check("no-match keeps full-order summary", await evaluate("document.querySelectorAll('.workflow-po').length"), 2);
    mode = "failFirst"; failed = false; await navigate();
    await wait("!!document.querySelector('.workflow-message[role=alert]')");
    await evaluate("document.querySelector('.workflow-message button').click()"); await ready();
    check("initial error retry succeeds", await evaluate("!document.querySelector('.workflow-message[role=alert]')"));
    mode = "failMore"; failed = false; await navigate(); await ready();
    await evaluate("document.querySelector('.workflow-load-more button').click()");
    await wait("!!document.querySelector('.workflow-more-error')");
    check("later-page error preserves rows", await evaluate("document.querySelectorAll('.workflow-roll').length"), 30);
    await evaluate("document.querySelector('.workflow-more-error button').click()");
    await wait("document.querySelectorAll('.workflow-roll').length===31");
    mode = "slow"; await navigate(); await ready();
    await change(".workflow-search input", "OLD");
    while (!delayed) await new Promise(resolve => setTimeout(resolve, 25));
    await change(".workflow-search input", "NOTFOUND");
    await wait("!!document.querySelector('.workflow-empty--rolls')");
    await delayed(); delayed = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    check("stale search never replaces new result", await evaluate("!document.querySelector('.workflow-roll')"));
    mode = "empty"; await navigate(); await wait("!!document.querySelector('.workflow-empty--rolls')");
    check("empty order summary", await evaluate("document.querySelectorAll('.workflow-po').length"), 0);
    mode = "normal";
    for (permission of ["admin", "manage_production"]) {
      await navigate("/customers/C1"); await wait("!!document.querySelector('.customer-history__workflow-link')");
      await evaluate("document.querySelector('.customer-history__workflow-link').click()"); await ready();
      check(`${permission} history link opens workflow`, await evaluate("location.pathname"), "/orders/1/workflow");
      await navigate("/orders"); await wait("!!document.querySelector('.workflow-order-link')");
      await evaluate("document.querySelector('.workflow-order-link').click()"); await ready();
      check(`${permission} order link opens workflow`, await evaluate("location.pathname"), "/orders/1/workflow");
    }
    for (permission of ["view_orders", "view_production", "operate_film", "*"]) {
      const count = requests.filter(r => r.route.endsWith("/workflow")).length;
      await navigate(); await wait("!!document.querySelector('.workflow-access')");
      check(`${permission} direct route blocked before API`, requests.filter(r => r.route.endsWith("/workflow")).length, count);
    }
    permission = "view_orders"; await navigate("/customers/C1");
    await wait("!!document.querySelector('.customer-history__order-number')");
    check("unauthorized profile has no workflow link", await evaluate("!document.querySelector('.customer-history__workflow-link')"));
    check("no browser exceptions", errors, []);
    check("read-only", requests.every(r => r.method === "GET"));
    console.log(`Workflow passed ${checks} browser checks; screenshots: ${temp}`);
  } finally {
    if (delayed) await delayed().catch(() => {});
    ws?.close(); chrome.kill("SIGTERM");
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
