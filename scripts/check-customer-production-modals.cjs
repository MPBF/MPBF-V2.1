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
    let nextCustomerNumber = 333;
    const immediateProducts = process.argv.includes("--immediate-products");
    let failProduct = false;
    let failOrder = false;
    const savedProducts = [];
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
        data = failSave ? { message: "فشل الحفظ التجريبي" } : (customer = { ...payload, id: `CID${nextCustomerNumber++}` });
      } else if (/^\/customers\/[^/]+\/detail$/.test(route)) data = { customer, products: [...profileProducts, ...savedProducts] };
      else if (immediateProducts && route === "/orders/next-number") data = { order_number: "O0001" };
      else if (immediateProducts && route === "/customer-products" && request.method === "POST") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        await new Promise(resolve => setTimeout(resolve, 120));
        if (failProduct) { status = 400; data = { message: "تعذر حفظ المنتج." }; }
        else {
          data = { ...payload, id: 1000 + savedProducts.length, category_name_ar: "أكياس بنانة", category_name: "Banana bags", size_caption: "40 × 50" };
          savedProducts.push(data);
        }
      } else if (immediateProducts && route === "/orders/with-items" && request.method === "POST") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        status = failOrder ? 400 : 201;
        data = failOrder ? { message: "تعذر حفظ الطلب." } : { id: 7, ...payload };
      }
      else if (route === "/customers/CID010" && request.method === "PUT") {
        const payload = JSON.parse(request.postData);
        writes.push({ route, method: request.method, payload });
        customer = { ...customer, ...payload };
        data = customer;
      } else if (route === "/customers") data = [customer];
      else if (route === "/categories") data = [{ id: "CAT01", name: "Banana bags", name_ar: "أكياس بنانة" }];
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
      console.error("Browser wait diagnostics", await evaluate("({dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({className:e.className,inert:e.inert,text:e.textContent.slice(0,200)})),active:document.activeElement?.outerHTML.slice(0,250)})"), errors, requests.slice(-5));
      throw new Error(`Timed out: ${expression}`);
    };
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const navigate = async (route) => { await send("Page.navigate", { url: origin + route }); await wait("!!document.querySelector('.shell')"); };
    const click = async (selector) => evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null);if(!e)throw Error('No visible button');e.click();return true})()`);
    const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement:e.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
    const close = async () => { await click('[role="dialog"] header button'); await wait("!document.querySelector('[role=dialog]')"); };
    const openCustomer = async () => {
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة عميل')).click()");
      await wait("!!document.querySelector('#customer-name') && !document.querySelector('.customer-modal-submit').disabled");
    };
    const screenshot = async (name) => {
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element && a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      await fs.mkdir("generated-artifacts/customer-production-checks", { recursive: true });
      const result = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`generated-artifacts/customer-production-checks/${name}.png`, Buffer.from(result.data, "base64"));
    };

    if (immediateProducts) {
      const chooseCustomer = async () => {
        await input("#order-customer", "عميل");
        await wait("!!document.querySelector('#order-customer-list [role=option],.order-customer-options [role=option],[role=listbox] [role=option]')");
        await click('[role=listbox] [role=option]');
        await wait("!document.querySelector('.order-product-mode button:nth-child(2)').disabled");
      };
      const openOrder = async () => {
        await navigate("/orders");
        await wait("[...document.querySelectorAll('button')].some(b=>/إضافة\\s+طلب/.test(b.textContent))");
        await evaluate("[...document.querySelectorAll('button')].find(b=>/إضافة\\s+طلب/.test(b.textContent)).click()");
        await wait("!!document.querySelector('#order-customer')");
        await chooseCustomer();
      };
      for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 });
        await openOrder();
        await click(".order-product-mode button:nth-child(2)");
        await wait("!!document.querySelector('#cp-width')&&!document.querySelector('.cp-save').disabled");
        await input("#cp-category", "CAT01");
        await input("#cp-width", "40");
        await input("#cp-right", "5");
        await input("#cp-left", "5");
        await input("#cp-thickness", "20");
        await input("#cp-notes", `immediate ${width}`);
        verify(`${width}: immediate-save policy is visible`,
          await evaluate("document.querySelector('.cp-footer-note').textContent.includes('حتى عند إلغاء الطلب')"));
        failProduct = true;
        await click(".cp-save");
        await wait("!!document.querySelector('.cp-error')&&!document.querySelector('.cp-save').disabled");
        verify(`${width}: failed product save retains both forms and fields`,
          await evaluate(`!!document.querySelector('.order-create-modal')&&document.querySelector('#cp-notes').value==='immediate ${width}'`));
        failProduct = false;
        const before = writes.filter(write => write.route === "/customer-products").length;
        await evaluate("(()=>{const b=document.querySelector('.cp-save');b.click();b.click()})()");
        await wait("!document.querySelector('.cp-modal')");
        verify(`${width}: double click saves exactly once`,
          writes.filter(write => write.route === "/customer-products").length, before + 1);
        const product = savedProducts.at(-1);
        verify(`${width}: product belongs to selected customer`, product.customer_id, "CID010");
        verify(`${width}: line becomes existing saved product`,
          await evaluate("document.querySelector('.order-product-mode button').getAttribute('aria-pressed')==='true'&&!document.querySelector('.order-product-draft')"));
        await input("#order-quantity-1", "12.5");
        failOrder = true;
        await click(".order-create-save");
        await wait("!!document.querySelector('.order-create-alert[role=alert]')&&!document.querySelector('.order-create-save').disabled");
        failOrder = false;
        await click(".order-create-save");
        await wait("!document.querySelector('.order-create-modal')");
        const orderWrites = writes.filter(write => write.route === "/orders/with-items").slice(-2);
        for (const write of orderWrites) {
          verify(`${width}: order sends saved product ID`, Number(write.payload.items[0].customer_product_id), product.id);
          verify(`${width}: order never sends new_product`, Object.hasOwn(write.payload.items[0], "new_product"), false);
        }
        verify(`${width}: order retry does not recreate product`,
          writes.filter(write => write.route === "/customer-products").length, before + 1);
        await openOrder();
        await click(".order-product-mode button:nth-child(2)");
        await wait("!!document.querySelector('#cp-width')&&!document.querySelector('.cp-save').disabled");
        await input("#cp-category", "CAT01");
        await input("#cp-width", "40");
        await input("#cp-right", "5");
        await input("#cp-left", "5");
        await input("#cp-thickness", "20");
        await input("#cp-notes", `cancelled order ${width}`);
        await click(".cp-save");
        await wait("!document.querySelector('.cp-modal')");
        const productsBeforeCancel = savedProducts.length;
        await click(".order-create-cancel");
        await wait("!document.querySelector('.order-create-modal')");
        await navigate("/customers/CID010");
        await wait(`document.querySelectorAll('main tbody tr').length===${productsBeforeCancel}`);
        verify(`${width}: saved product survives order cancellation`,
          await evaluate(`document.querySelectorAll('main tbody tr').length===${productsBeforeCancel}`));
        await screenshot(`immediate-product-${width}`);
      }
      verify("no unexpected writes", writes.every(write => ["/customer-products", "/orders/with-items"].includes(write.route)));
      verify("no browser runtime errors", errors, []);
      console.log(`Immediate product browser checks passed: ${checks}; fixture APIs only.`);
      return;
    }

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
      verify(`${width}: no customer code input`, await evaluate("!document.querySelector('[role=dialog] input[name=id], [role=dialog] #id') && document.querySelectorAll('[role=dialog] input:not([readonly])').length===6"));
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
    await wait("!!document.querySelector('#cp-category option[value=CAT01]')");
    verify("category displays only its name, retaining ID as value",
      await evaluate("document.querySelector('#cp-category option[value=CAT01]').textContent"), "أكياس بنانة");
    verify("right-facing label has a physical right arrow",
      await evaluate("!!document.querySelector('label[for=cp-right] svg.lucide-arrow-right[aria-hidden=true]')"));
    verify("left-facing label has a physical left arrow",
      await evaluate("!!document.querySelector('label[for=cp-left] svg.lucide-arrow-left[aria-hidden=true]')"));
    verify("new product defaults to kilo",
      await evaluate("document.querySelector('#cp-cut-unit').value"), "كيلو");
    verify("new product defaults to 1000 grams while storing one kilogram",
      await evaluate("document.querySelector('#cp-unit-weight').value==='1'&&document.querySelector('#cp-unit-weight option:checked').textContent==='1000 جرام'"));
    verify("new product defaults packing to 20",
      await evaluate("document.querySelector('#cp-unit-quantity').value"), "20");
    const beforeFacingChecks = writes.length;
    await input("#cp-width", "10");
    for (const side of ["right", "left"]) {
      await input("#cp-right", side === "right" ? "6" : "0");
      await input("#cp-left", side === "left" ? "6" : "0");
      await click(".cp-save");
      await wait("document.querySelector('.cp-error')?.textContent.includes('نصف العرض')");
      verify(`${side} side exceeding half the width is blocked without writes`, writes.length, beforeFacingChecks);
      verify(`${side} invalid side cannot be bypassed with mismatch confirmation`,
        await evaluate("!document.querySelector('.cp-facing-warning')"));
    }
    for (const width of [390, 768, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      verify(`facing labels and arrows fit at ${width}px`, await evaluate("(()=>{const d=document.querySelector('[role=dialog]');return d.scrollWidth<=d.clientWidth+1&&['cp-right','cp-left'].every(id=>{const label=document.querySelector('label[for='+id+']'),r=label.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&label.scrollWidth<=label.clientWidth+1})})()"));
      verify(`left-facing arrow follows Arabic text at ${width}px`,
        await evaluate("(()=>{const l=document.querySelector('label[for=cp-left]');return l.querySelector('svg').getBoundingClientRect().right<=l.querySelector('span').getBoundingClientRect().left})()"));
      verify(`facing controls have half their former width at ${width}px`,
        await evaluate("['cp-right','cp-left'].every(id=>{const c=document.getElementById(id),p=c.closest('.cp-field');return Math.abs(c.getBoundingClientRect().width-p.getBoundingClientRect().width/2)<1})"));
      await evaluate("document.getElementById('cp-right').scrollIntoView({block:'center'})");
      await screenshot(`product-facing-rules-${width}`);
    }
    await input("#cp-width", "30");
    await input("#cp-right", "5");
    await input("#cp-left", "5");
    await input("#cp-unit-weight", "0.25");
    await input("#cp-unit-quantity", "5");
    await input(".cp-modal textarea", "Keep the product draft during customer creation");
    const inlineStart = writes.length;
    const selectedBeforeInline = await evaluate("document.querySelector('#cp-customer').textContent");
    await click("#cp-customer");
    await wait("!!document.querySelector('.cp-customer-menu input')");
    await input(".cp-customer-menu input", "Unregistered inline fixture");
    verify("create action remains available with no matching customers",
      await evaluate("document.querySelectorAll('#cp-customer-options [role=option]').length===0&&[...document.querySelectorAll('.cp-customer-menu button')].some(b=>b.textContent.includes('إضافة عميل جديد'))"));
    verify("create action is outside the selectable customer list",
      await evaluate("![...document.querySelectorAll('.cp-customer-menu button')].find(b=>b.textContent.includes('إضافة عميل جديد')).closest('[role=listbox]')"));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    verify("keyboard reaches add-customer action",
      await evaluate("document.activeElement.textContent.includes('إضافة عميل جديد')"));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await wait("!!document.querySelector('.customer-modal')&&!document.querySelector('.customer-modal-submit').disabled");
    verify("parent product dialog is inert while adding a customer",
      await evaluate("document.querySelector('.cp-modal').inert"));
    for (const width of [390, 768, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      verify(`nested customer dialog fits ${width}px`,
        await evaluate("(()=>{const r=document.querySelector('.customer-modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()"));
      await screenshot(`inline-customer-${width}`);
    }
    await input("#customer-name", "Cancelled inline fixture");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('.customer-modal')&&document.activeElement.id==='cp-customer'");
    verify("Escape cancels only the child, preserving the product and selection",
      await evaluate(`!!document.querySelector('.cp-modal')&&!document.querySelector('.cp-modal').inert&&document.querySelector('#cp-customer').textContent===${JSON.stringify(selectedBeforeInline)}&&document.querySelector('.cp-modal textarea').value==='Keep the product draft during customer creation'`));
    verify("cancelled inline customer causes no writes", writes.length, inlineStart);
    await click("#cp-customer");
    await wait("!!document.querySelector('.cp-customer-menu')");
    await evaluate("[...document.querySelectorAll('.cp-customer-menu button')].find(b=>b.textContent.includes('إضافة عميل جديد')).click()");
    await wait("!!document.querySelector('.customer-modal')&&!document.querySelector('.customer-modal-submit').disabled");
    await input("#customer-name", "Inline saved customer");
    await input("#customer-name-ar", "عميل من القائمة");
    await input("#customer-drawer-letter", "C");
    await input("#customer-drawer-number", "24");
    failSave = true;
    await click(".customer-modal-submit");
    await wait("!!document.querySelector('.customer-modal-save-error')&&!document.querySelector('.customer-modal-submit').disabled");
    verify("inline customer failure keeps both forms and input values",
      await evaluate("!!document.querySelector('.cp-modal')&&document.querySelector('#customer-name').value==='Inline saved customer'&&document.querySelector('#cp-width').value==='30'"));
    failSave = false;
    const beforeInlineSave = writes.length;
    await evaluate("(()=>{const button=document.querySelector('.customer-modal-submit');button.click();button.click()})()");
    await wait("!document.querySelector('.customer-modal')&&document.querySelector('#cp-customer').textContent.includes('عميل من القائمة')");
    verify("inline customer saves once and is automatically selected", writes.length, beforeInlineSave + 1);
    verify("inline customer uses existing API and drawer formatting",
      writes.at(-1).route === "/customers" && writes.at(-1).payload.plate_drawer_code === "C-24");
    verify("all entered product data remains unchanged",
      await evaluate("document.querySelector('#cp-width').value==='30'&&document.querySelector('#cp-right').value==='5'&&document.querySelector('#cp-left').value==='5'&&document.querySelector('#cp-unit-weight').value==='0.25'&&document.querySelector('#cp-unit-quantity').value==='5'&&document.querySelector('.cp-modal textarea').value==='Keep the product draft during customer creation'"));
    await wait("document.activeElement.id==='cp-customer'");
    await click("#cp-customer");
    await wait("!!document.getElementById('cp-customer-option-CID334')");
    verify("saved customer occurs once in the dropdown",
      await evaluate("document.querySelectorAll('#cp-customer-option-CID334').length"), 1);
    await click(".cp-close");
    await wait("!document.querySelector('.cp-modal')");
    verify("customer persists independently after cancelling product",
      customer.id === "CID334" && customer.name === "Inline saved customer");
    verify("inline flow never submits a product or deletes the customer",
      writes.slice(inlineStart).every(write => write.route === "/customers" && write.method === "POST"));
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