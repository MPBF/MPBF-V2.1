// All API calls are intercepted. No credentials, real data reads, or business writes.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const jsLiteral = value => JSON.stringify(value).replace(/[<>&/\u2028\u2029]/g, char => ({
  "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "/": "\\u002f", "\u2028": "\\u2028", "\u2029": "\\u2029",
})[char]);

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "language-flags-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let checks = 0;
  const dialogsOnly = process.argv.includes("--dialogs-only");
  const saveOnly = process.argv.includes("--save-only");
  const check = (label, value, expected = true) => {
    assert.deepEqual(value, expected, label);
    console.log(`PASS ${label}`);
    checks++;
  };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium did not start")), 20000);
      chrome.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let serial = 0;
    let session;
    let useTouch = false;
    const pending = new Map();
    const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
    });
    let signedIn = false;
    let passwordChange = false;
    let preference = "ar";
    let factoryLanguage = "ar";
    let saveFailure = false;
    let holdSave = false;
    let releaseSave;
    const writes = [];
    const errors = [];
    const customer = { id: "CID010", name: "Example Customer", name_ar: "عميل تجريبي",
      phone: "0501234567", sales_rep_name: "Example Rep", sales_rep_name_ar: "مندوب تجريبي", city: "Riyadh", is_active: true };
    const product = (id, category_id, category_name_ar, category_name) => ({ id, customer_id: customer.id,
      category_id, category_name_ar, category_name, item_id: "ITM001", item_name: "Example Item", item_name_ar: "صنف تجريبي",
      size_caption: "40 × 50", width: 40, thickness: 20, printing_cylinder: 100, cutting_length_cm: 50,
      raw_material: "HDPE", master_batch_name: "White", master_batch_name_ar: "أبيض", status: "active" });
    const products = [product(11, "CATZ", "أكياس", "Z Bags"), product(12, "CATA", "شنط", "A Bags"),
      product(13, "CATZ", "أكياس", "Z Bags"), product(14, "CATR", "رولات", "Rolls"),
      product(15, "CATM", "صنف عربي فقط", null), product(16, null, null, null)];
    const respond = async ({ params: { requestId, request } }) => {
      const route = new URL(request.url).pathname.replace(/^\/api/, "");
      let data = [];
      let status = 200;
      if (route === "/public-branding") data = { companyNameAr: "المصنع التجريبي", companyNameEn: "Example Factory", defaultLanguage: factoryLanguage };
      else if (route === "/me") {
        status = signedIn ? 200 : 401;
        data = signedIn ? { user: { id: 42, username: "fixture", display_name: "Example User",
          display_name_ar: "مستخدم تجريبي", preferred_language: preference, permissions: ["admin"],
          must_change_password: passwordChange } } : { message: "تسجيل الدخول مطلوب" };
      } else if (route === "/me/language" && request.method === "PUT") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, payload });
        if (holdSave) await new Promise((resolve) => { releaseSave = resolve; });
        status = saveFailure ? 503 : 200;
        if (!saveFailure) preference = payload.preferred_language;
        data = saveFailure ? { message: "فشل الحفظ التجريبي" } : { preferred_language: preference };
      } else if (request.method !== "GET") throw Error(`Unexpected business write: ${request.method} ${route}`);
      else if (route === "/dashboard") data = {};
      else if (route === "/customers/CID010/detail") data = { customer, products };
      else if (route === "/customers") data = [customer];
      else if (route === "/customer-products") data = products;
      else if (route === "/customer-products/form-options") data = { printing_cylinders: [] };
      else if (route === "/customers/sales-representatives") data = [];
      else if (route === "/orders") data = [{ id: 7, order_number: "100", customer_id: customer.id,
        customer_name: customer.name, customer_name_ar: customer.name_ar, status: "waiting", production_orders_summary: [] }];
      else if (route === "/production-orders") data = [{ id: 8, production_order_number: "100-01", order_id: 7,
        order_number: "100", customer_product_id: 11, quantity_kg: 100, final_quantity_kg: 105, overrun_percentage: 5,
        status: "pending", customer_name: customer.name, customer_name_ar: customer.name_ar, product_size_caption: "40 × 50" }];
      await send("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(data)).toString("base64") });
    };
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id) {
        const entry = pending.get(message.id);
        if (entry) { pending.delete(message.id); message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result); }
      } else if (message.method === "Fetch.requestPaused") {
        respond(message).catch((error) => { errors.push(error.message); console.error(error); });
      } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, true)).sessionId;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const navigate = async (route) => {
      await send("Page.navigate", { url: origin + route });
      await wait("!!document.querySelector('.flag-language-selector__trigger')");
      await new Promise((resolve) => setTimeout(resolve, 180));
    };
    const click = async (selector) => {
      if (selector === ".flag-language-selector__trigger") {
        await wait("!!document.querySelector('.flag-language-selector__trigger') && !document.querySelector('.flag-language-selector__trigger').disabled");
      } else if (selector.startsWith("[role=menuitemradio]")) {
        await wait(`!!document.querySelector(${jsLiteral(selector)})`);
      }
      const point = await evaluate(`(()=>{const e=[...document.querySelectorAll(${jsLiteral(selector)})].find(e=>e.getClientRects().length);if(!e)throw Error('Not visible: '+${jsLiteral(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      if (useTouch) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
      }
    };
    const key = async (value) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code: value });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: value });
    };
    const choose = async (language) => {
      await click(".flag-language-selector__trigger");
      await wait("!!document.querySelector('[role=menu]')");
      await click(`[role=menuitemradio][data-language='${language}']`);
      await wait(`document.documentElement.lang === '${language}' && !document.querySelector('[role=menu]')`);
    };
    const flag = () => evaluate(`(()=>{const img=document.querySelector('.flag-language-selector__trigger img');const s=img.src;if(!img.complete||!img.naturalWidth)return 'loading';if(s.startsWith('data:')){const body=s.slice(s.indexOf(',')+1);const svg=s.includes(';base64,')?atob(body):decodeURIComponent(body);return svg.includes('United Kingdom')?'en':svg.includes('Saudi Arabia')?'ar':'unknown'}return s.includes('gb')?'en':s.includes('sa')?'ar':'unknown'})()`);
    const bounds = () => evaluate("(()=>{const e=document.querySelector('[role=menu]');const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()");
    const rowOrder = () => evaluate("[...document.querySelectorAll('tbody tr')].map(r=>r.querySelector('td:nth-child(2)')?.textContent.trim())");
    const uiArabic = () => evaluate("(()=>{const nodes=[...document.querySelectorAll('.topbar h1, .nav a, .mobile-nav a, .page-hero .eyebrow, .page-hero h2, th, label, button, [role=tab], [role=dialog] h2, [role=dialog] h3, .order-line-title')];return nodes.filter(e=>e.getClientRects().length&&/[\\u0600-\\u06ff]/.test(e.textContent)).map(e=>e.textContent.trim())})()");
    const capture = async (name) => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await fs.mkdir("screenshots/language-flags", { recursive: true });
      const result = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`screenshots/language-flags/${name}.png`, Buffer.from(result.data, "base64"));
    };
    for (const width of dialogsOnly || saveOnly ? [] : [390, 768, 1280]) {
      useTouch = width < 700;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      signedIn = false;
      const writesBeforePublic = writes.length;
      await navigate("/");
      check(`Arabic login direction at ${width}`, await evaluate("document.documentElement.dir"), "rtl");
      await click(".flag-language-selector__trigger");
      await wait("!!document.querySelector('[role=menu]')");
      check(`public menu has two choices at ${width}`, await evaluate("document.querySelectorAll('[role=menuitemradio]').length"), 2);
      check(`public menu fits viewport at ${width}`, await bounds());
      await key("Escape");
      await wait("!document.querySelector('[role=menu]')");
      check(`Escape returns focus at ${width}`, await evaluate("document.activeElement.classList.contains('flag-language-selector__trigger')"));
      if (width === 390) {
        await key("ArrowDown");
        await wait("document.activeElement?.getAttribute('data-language') === 'ar'");
        await key("ArrowDown");
        await key("Enter");
        await wait("document.documentElement.lang === 'en' && !document.querySelector('[role=menu]')");
        check("keyboard arrow navigation and Enter select English", await evaluate("document.documentElement.lang"), "en");
      } else await choose("en");
      check(`English login labels at ${width}`, await uiArabic(), []);
      check(`English login direction at ${width}`, await evaluate("document.body.dir"), "ltr");
      check(`English flag at ${width}`, await flag(), "en");
      await capture(`login-en-${width}`);
      await choose("ar");
      check(`Arabic flag at ${width}`, await flag(), "ar");
      check(`public switching makes no writes at ${width}`, writes.length, writesBeforePublic);
      signedIn = true;
      preference = "ar";
      await navigate("/customers/CID010");
      await wait("document.querySelectorAll('tbody tr').length===6");
      check(`Arabic profile numbering at ${width}`, await evaluate("[...document.querySelectorAll('tbody tr')].map(r=>r.cells[0].textContent.trim())"), ["1", "2", "3", "4", "5", "6"]);
      check(`Arabic category ordering at ${width}`, await rowOrder(), ["أكياسصنف تجريبي", "أكياسصنف تجريبي", "رولاتصنف تجريبي", "شنطصنف تجريبي", "صنف عربي فقطصنف تجريبي", "—صنف تجريبي"]);
      await choose("en");
      check(`English profile category ordering at ${width}`, await rowOrder(), ["A BagsExample Item", "RollsExample Item", "Z BagsExample Item", "Z BagsExample Item", "CATMExample Item", "—Example Item"]);
      check(`English profile labels at ${width}`, await uiArabic(), []);
      check(`English user name at ${width}`, await evaluate("document.querySelector('.user-chip span').textContent"), "Example User");
      await click(".flag-language-selector__trigger");
      await wait("!!document.querySelector('[role=menu]')");
      check(`authenticated menu has default option at ${width}`, await evaluate("document.querySelectorAll('[role=menuitemradio]').length"), 3);
      check(`authenticated menu fits viewport at ${width}`, await bounds());
      await capture(`profile-en-menu-${width}`);
      await key("Escape");
      check(`no horizontal viewport overflow at ${width}`, await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
      await navigate("/customers/CID010");
      check(`saved English survives reload at ${width}`, await evaluate("document.documentElement.lang"), "en");
      await choose("ar");
      check(`Arabic user name preserved at ${width}`, await evaluate("document.querySelector('.user-chip span').textContent"), "مستخدم تجريبي");
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    signedIn = true;
    for (const width of saveOnly ? [] : [390, 768, 1280]) {
    useTouch = width < 700;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    for (const language of ["en", "ar"]) {
      preference = language;
      for (const route of dialogsOnly ? [] : ["/", "/customers", "/customers/CID010", "/orders", "/orders?tab=production", "/admin"]) {
        await navigate(route);
        check(`${language} renders ${route} at ${width}`, await evaluate("!!document.querySelector('.shell')"));
        if (language === "en") check(`English interface labels ${route} at ${width}`, await uiArabic(), []);
        check(`${language} document direction ${route} at ${width}`, await evaluate("document.documentElement.dir"), language === "ar" ? "rtl" : "ltr");
      }
      await navigate("/customers");
      await evaluate(`([...document.querySelectorAll('button')].find(e=>${language === "ar" ? "e.textContent.trim()==='إضافة عميل'" : "/Add.*customer/i.test(e.textContent)"})).click()`);
      await wait("!!document.querySelector('#customer-name')");
      if (language === "en") check("English customer dialog labels", await uiArabic(), []);
      await capture(`customer-dialog-${language}`);
      await navigate("/customers/CID010");
      await wait("document.querySelectorAll('tbody tr').length===6");
      await evaluate(`([...document.querySelectorAll('button')].find(e=>${language === "ar" ? "e.textContent.trim()==='إضافة منتج'" : "/Add.*product/i.test(e.textContent)"})).click()`);
      await wait("!!document.querySelector('.cp-modal') && !document.querySelector('.cp-loading')");
      if (language === "en") check(`English new-product dialog at ${width}`, await uiArabic(), []);
      await navigate("/customers/CID010");
      await wait("document.querySelectorAll('tbody tr').length===6");
      await evaluate("([...document.querySelectorAll('.content button')].find(e=>e.getClientRects().length && /^(Edit|تعديل)/.test((e.getAttribute('aria-label')||e.title||e.textContent).trim()))).click()");
      await wait("!!document.querySelector('.cp-modal') && !document.querySelector('.cp-loading')");
      if (language === "en") check(`English edit-product dialog at ${width}`, await uiArabic(), []);
      await navigate("/orders");
      await evaluate(`([...document.querySelectorAll('button')].find(e=>${language === "ar" ? "e.textContent.trim()==='إضافة طلب'" : "/Add.*order/i.test(e.textContent)"})).click()`);
      await wait("!!document.querySelector('.order-line-card')");
      if (language === "en") check(`English new-order dialog at ${width}`, await uiArabic(), []);
      await navigate("/orders?tab=production");
      await wait("document.querySelectorAll('tbody tr').length===1");
      await evaluate("([...document.querySelectorAll('.content button')].find(e=>e.getClientRects().length && /^(Edit|تعديل)/.test((e.getAttribute('aria-label')||e.title||e.textContent).trim()))).click()");
      await wait("!!document.querySelector('#production-order-quantity')");
      if (language === "en") check(`English production edit dialog at ${width}`, await uiArabic(), []);
    }
    }
    preference = "en";
    factoryLanguage = "ar";
    await navigate("/customers/CID010");
    saveFailure = true;
    await click(".flag-language-selector__trigger");
    await click("[role=menuitemradio][data-language=ar]");
    await wait("!!document.querySelector('.language-error')");
    check("failed save keeps English and flag", await evaluate("document.documentElement.lang === 'en'") && await flag() === "en");
    check("failed save error translated", await evaluate("!/[\\u0600-\\u06ff]/.test(document.querySelector('.language-error').textContent)"));
    saveFailure = false;
    holdSave = true;
    await click(".flag-language-selector__trigger");
    await click("[role=menuitemradio][data-language=ar]");
    await wait("document.querySelector('.flag-language-selector__trigger').disabled");
    check("selector disabled during save", await evaluate("document.querySelector('.flag-language-selector__trigger').disabled"));
    holdSave = false;
    while (!releaseSave) await new Promise((resolve) => setTimeout(resolve, 20));
    releaseSave();
    await wait("document.documentElement.lang === 'ar' && !document.querySelector('.flag-language-selector__trigger').disabled");
    await click(".flag-language-selector__trigger");
    await click("[role=menuitemradio][data-language=default]");
    await wait("!document.querySelector('[role=menu]')");
    check("factory default stored as null", preference, null);
    factoryLanguage = "en";
    await navigate("/customers/CID010");
    check("effective flag follows changed factory default", await flag(), "en");
    passwordChange = true;
    await navigate("/");
    check("password-change page has flag selector", await evaluate("!!document.querySelector('#new-password')"));
    await choose("ar");
    check("password-change language switch works", await evaluate("document.documentElement.dir"), "rtl");
    check("no business writes", writes.every((write) => write.route === "/me/language"));
    check("no browser exceptions", errors, []);
    console.log(`Passed ${checks} bilingual/flag checks with intercepted APIs.`);
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