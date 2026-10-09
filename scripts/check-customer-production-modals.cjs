// Isolated browser regression check. Every API request is intercepted:
// no login credentials, database reads, or real writes are performed.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "customer-production-browser-"));
  const chromePath = process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  const chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let checks = 0;
  const verify = (label, actual, expected = true) => {
    assert.deepEqual(actual, expected, label);
    console.log(`PASS ${label}`);
    checks++;
  };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chromium did not start")), 20000);
      chrome.stderr.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let serial = 0;
    let session;
    const pending = new Map();
    const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
    });
    const writes = [];
    const requests = [];
    const errors = [];
    let permissions = ["manage_customers", "manage_orders", "manage_production", "view_production"];
    let failReps = false;
    let failSave = false;
    let staleProduction = false;
    let profileProducts = [];
    let customer = { id: "CID010", name: "Existing Customer", name_ar: "عميل تجريبي", phone: "0501234567",
      sales_rep_id: 7, sales_rep_name_ar: "مندوب تجريبي", is_active: true };
    let production = { id: 8, production_order_number: "123-01", order_id: 7, order_number: "123",
      customer_product_id: 11, customer_name_ar: "عميل تجريبي", product_size_caption: "أكياس 40 × 50",
      quantity_kg: "100.00", final_quantity_kg: "105.00", overrun_percentage: "5.00", status: "pending",
      batch_number: null, previous_status: null, created_at: "2026-10-03T06:00:00.000Z" };
    const reps = [{ id: 7, display_name: "Test Representative", display_name_ar: "مندوب تجريبي" }];
    const respond = async (event) => {
      const { requestId, request } = event.params;
      const url = new URL(request.url);
      const route = url.pathname.replace(/^\/api/, "");
      requests.push({ route, method: request.method });
      let data = [];
      let status = 200;
      if (route === "/me") data = { user: { id: 42, username: "test", display_name_ar: "مستخدم تجريبي", permissions } };
      else if (route === "/public-branding") data = {};
      else if (route === "/customers/sales-representatives") {
        data = failReps ? { message: "فشل تحميل المندوبين التجريبي" } : reps;
        if (failReps) status = 503;
      } else if (route === "/customers" && request.method === "POST") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        status = failSave ? 400 : 201;
        data = failSave ? { message: "فشل الحفظ التجريبي" } : (customer = { ...payload, id: "CID333" });
      } else if (/^\/customers\/[^/]+\/detail$/.test(route)) data = { customer, products: profileProducts };
      else if (route === "/customers/CID010" && request.method === "PUT") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        customer = { ...customer, ...payload };
        data = customer;
      } else if (route === "/customers") data = [customer];
      else if (route === "/production-orders/8" && request.method === "PUT") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        status = staleProduction ? 409 : 200;
        data = staleProduction ? { message: "تغيرت الحالة ولا يمكن تغيير الكمية" } :
          (production = { ...production, ...payload, final_quantity_kg: (Number(payload.quantity_kg) * 1.05).toFixed(2) });
      } else if (route === "/production-orders") data = [production];
      else if (route === "/customer-products/form-options") data = { printing_cylinders: [] };
      else if (request.method !== "GET") throw new Error(`Unexpected write ${request.method} ${route}`);
      await send("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(data)).toString("base64") });
    };
    ws.on("message", (raw) => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const handler = pending.get(event.id);
        if (!handler) return;
        pending.delete(event.id);
        if (event.error) handler.reject(new Error(event.error.message));
        else handler.resolve(event.result);
      } else if (event.method === "Fetch.requestPaused") respond(event).catch((error) => errors.push(error.message));
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, true)).sessionId;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const navigate = async (route) => { await send("Page.navigate", { url: origin + route }); await wait("!!document.querySelector('.shell')"); };
    const click = async (selector) => evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null);if(!e)throw Error('No visible button');e.click();return true})()`);
    const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
    const close = async () => { await click('[role="dialog"] header button'); await wait("!document.querySelector('[role=dialog]')"); };
    const openCustomer = async () => {
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة عميل')).click()");
      await wait("!!document.querySelector('#customer-name') && !document.querySelector('.customer-modal-submit').disabled");
    };
    const screenshot = async (name) => {
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element && a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      await fs.mkdir("screenshots", { recursive: true });
      const result = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`screenshots/${name}.png`, Buffer.from(result.data, "base64"));
    };

    if (process.argv.includes("--capture-only")) {
      for (const width of [390, 768, 1024]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
        await navigate("/customers");
        await openCustomer();
        await screenshot(`customer-form-${width}`);
        await close();
        await navigate("/orders?tab=production");
        await wait("!!document.querySelector('[aria-label=\"عرض أمر الإنتاج\"]')");
        await click('[aria-label="عرض أمر الإنتاج"]');
        await wait("!!document.querySelector('.production-order-details')");
        await screenshot(`production-view-${width}`);
        await close();
      }
      console.log("Captured settled customer and production dialogs at 390/768/1024px.");
      return;
    }

    for (const width of [390, 768, 1024]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await navigate("/customers");
      await openCustomer();
      verify(`${width}: no customer code input`, await evaluate("!document.querySelector('[role=dialog] input[name=id], [role=dialog] #id') && document.querySelectorAll('[role=dialog] input').length===6"));
      verify(`${width}: only representatives endpoint choices`, await evaluate("document.querySelector('#customer-sales-rep').options.length"), 2);
      verify(`${width}: modal/page do not overflow`, await evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth"));
      if (width > 700) {
        verify(`${width}: names in one row`, await evaluate("Math.abs(document.querySelector('#customer-name').getBoundingClientRect().top-document.querySelector('#customer-name-ar').getBoundingClientRect().top)<2"));
        verify(`${width}: three contact fields in one row`, await evaluate("(()=>{const ys=['#customer-tax-number','#customer-phone','#customer-sales-rep'].map(s=>document.querySelector(s).getBoundingClientRect().top);return Math.max(...ys)-Math.min(...ys)<2})()"));
      }
      await screenshot(`customer-form-${width}`);
      await close();
      await navigate("/orders?tab=production");
      await wait("!!document.querySelector('[aria-label=\"عرض أمر الإنتاج\"]')");
      await click('[aria-label="عرض أمر الإنتاج"]');
      await wait("!!document.querySelector('.production-order-details')");
      verify(`${width}: view is read-only`, await evaluate("document.querySelectorAll('[role=dialog] input,[role=dialog] select,[role=dialog] textarea,[role=dialog] form').length"), 0);
      verify(`${width}: view shows order and customer`, await evaluate("document.querySelector('[role=dialog]').textContent.includes('123-01')&&document.querySelector('[role=dialog]').textContent.includes('عميل تجريبي')"));
      verify(`${width}: view fits viewport`, await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth"));
      await screenshot(`production-view-${width}`);
      await close();
      await click('[aria-label="تعديل أمر إنتاج"]');
      await wait("!!document.querySelector('#production-order-quantity')");
      verify(`${width}: edit has exactly one quantity input`, await evaluate("document.querySelectorAll('[role=dialog] input,[role=dialog] select,[role=dialog] textarea').length"), 1);
      await close();
    }

    await navigate("/customers");
    await openCustomer();
    await input("#customer-name", "  New Customer  ");
    await input("#customer-name-ar", "  عميل جديد  ");
    await input("#customer-sales-rep", "7");
    failSave = true;
    await click(".customer-modal-submit");
    await wait("!!document.querySelector('.customer-modal-save-error')");
    verify("failed customer save stays open without redirect", await evaluate("location.pathname==='/customers' && !!document.querySelector('[role=dialog]')"));
    failSave = false;
    await click(".customer-modal-submit");
    await wait("location.pathname==='/customers/CID333' && document.body.textContent.includes('منتجات العميل')");
    verify("customer save redirects with add product available", await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('إضافة منتج'))"));
    const creation = writes.find((r) => r.route === "/customers" && r.method === "POST");
    verify("create has no id and integer sales representative", !("id" in creation.payload) && creation.payload.sales_rep_id === 7);
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة منتج')).click()");
    await wait("!!document.querySelector('[role=dialog]')");
    verify("product editor can open after creation", await evaluate("document.querySelector('[role=dialog]').textContent.includes('منتج')"));
    await navigate("/customers");
    failReps = true;
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة عميل')).click()");
    await wait("!!document.querySelector('.customer-modal-retry')");
    verify("lookup failure disables saving", await evaluate("document.querySelector('.customer-modal-submit').disabled"));
    failReps = false;
    await click(".customer-modal-retry");
    await wait("!document.querySelector('.customer-modal-submit').disabled");
    verify("representative retry recovers", await evaluate("!document.querySelector('.customer-modal-alert')"));
    await close();

    await navigate("/orders?tab=production");
    await wait("!!document.querySelector('[aria-label=\"تعديل أمر إنتاج\"]')");
    await click('[aria-label="تعديل أمر إنتاج"]');
    await wait("!!document.querySelector('#production-order-quantity')");
    await input("#production-order-quantity", "120.50");
    staleProduction = true;
    await click(".production-order-submit");
    await wait("!!document.querySelector('.production-order-error')");
    verify("stale quantity save preserves modal and reports conflict", await evaluate("!!document.querySelector('[role=dialog]') && document.querySelector('.production-order-error').textContent.includes('تغيرت الحالة')"));
    staleProduction = false;
    await click(".production-order-submit");
    await wait("!document.querySelector('[role=dialog]')");
    verify("quantity save payload has no other fields", writes.filter((r) => r.route === "/production-orders/8").every((r) => JSON.stringify(Object.keys(r.payload)) === '["quantity_kg"]'));
    verify("final quantity recomputed by response", production.final_quantity_kg, "126.53");
    production = { ...production, status: "active" };
    await navigate("/orders?tab=production");
    await wait("!!document.querySelector('[aria-label=\"تعديل أمر إنتاج\"]')");
    await click('[aria-label="تعديل أمر إنتاج"]');
    await wait("!!document.querySelector('#production-order-quantity')");
    verify("started order keeps quantity protected", await evaluate("document.querySelector('#production-order-quantity').disabled && document.querySelector('.production-order-submit').disabled"));
    await close();
    permissions = ["view_production"];
    await navigate("/orders?tab=production");
    await wait("!!document.querySelector('[aria-label=\"عرض أمر الإنتاج\"]')");
    verify("read-only user gets view but no edit", await evaluate("!document.querySelector('[aria-label=\"تعديل أمر إنتاج\"]')"));
    await click('[aria-label="عرض أمر الإنتاج"]');
    await wait("!!document.querySelector('.production-order-details')");
    verify("read-only user's dialog has no write actions", await evaluate("!document.querySelector('[role=dialog] input,[role=dialog] .production-order-submit')"));
    await close();
    permissions = ["view_orders"];
    const profileProduct = (id, categoryId, categoryName, size) => ({
      id, customer_id: customer.id, category_id: categoryId, category_name_ar: categoryName,
      item_name_ar: "صنف تجريبي", size_caption: size, width: "20", thickness: "30",
      printing_cylinder: "بدون طباعة", cutting_length_cm: "30", raw_material: "LDPE",
    });
    profileProducts = [
      profileProduct(11, "CAT01", "شنط", "منتج الشنط"),
      profileProduct(12, null, null, "منتج غير مصنف"),
      profileProduct(13, "CAT02", "أكياس", "أكياس أول"),
      profileProduct(14, "CAT03", "رولات", "منتج الرولات"),
      profileProduct(15, "CAT02", "أكياس", "أكياس ثان"),
    ];
    const expectedSizes = ["أكياس أول", "أكياس ثان", "منتج الرولات", "منتج الشنط", "منتج غير مصنف"];
    for (const width of [390, 768, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await navigate("/customers/CID010");
      await wait("document.querySelectorAll('tbody tr').length===5");
      const shown = await evaluate(`(()=>{const table=document.querySelector('tbody');const sizes=[...table.querySelectorAll('tr')].map(r=>r.querySelectorAll('td')[2].textContent);const sequence=[...table.querySelectorAll('tr')].map(r=>r.querySelector('td').textContent);const cards=[...document.querySelectorAll('.entity-card')].map(c=>[...c.querySelectorAll('.card-line')].find(l=>l.querySelector('span').textContent==='وصف المقاس').querySelector('b').textContent);return {sizes,sequence,cards,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      verify(`${width}: profile table sorts alphabetically and places unclassified last`, shown.sizes, expectedSizes);
      verify(`${width}: mobile cards have the same category order`, shown.cards, expectedSizes);
      verify(`${width}: row numbers follow the displayed order`, shown.sequence, ["1", "2", "3", "4", "5"]);
      verify(`${width}: no page-width overflow`, !shown.overflow);
      await screenshot(`customer-category-sort-${width}`);
    }
    verify("no users/roles endpoint exposed by either form", !requests.some((r) => ["/users", "/roles"].includes(r.route)));
    verify("no unexpected browser errors", errors, []);
    console.log(`Browser regression passed: ${checks} checks; all API calls used fixtures.`);
  } finally {
    if (ws) ws.close();
    await new Promise((resolve) => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("close", resolve);
      chrome.kill("SIGKILL");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });