// Isolated browser regression check. Every API request is intercepted:
// no login credentials, database reads, or real writes are performed.
// --mobile-keyboard-only runs only CustomerModal/ProductionOrderModal checks.
// Keyboard coverage uses real viewport resizing, not an emulated OS keyboard
// or a mocked VisualViewport; visual-only keyboard panning needs a real device.
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
    const cancelledNetworkRequests = new Set();
    const fixtureResponses = new Set();
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
      } else if (event.method === "Network.loadingFailed" && event.params.canceled) {
        cancelledNetworkRequests.add(event.params.requestId);
      } else if (event.method === "Fetch.requestPaused") {
        const response = respond(event).catch(async (error) => {
        // Closing a dialog/navigation can abort a fixture lookup before CDP
        // fulfills it. Ignore only a confirmed network cancellation, never an
        // unexpected interception error or a failed application request.
        if (error.message === "Invalid InterceptionId." && event.params.networkId) {
          for (let attempt = 0; attempt < 20; attempt++) {
            if (cancelledNetworkRequests.has(event.params.networkId)) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
        errors.push(error.message);
        });
        fixtureResponses.add(response);
        response.finally(() => fixtureResponses.delete(response));
      }
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, true)).sessionId;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
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
    // DOM .click() bypasses occlusion. Use hit testing and real pointer events
    // for the layering regression, scrolling each control into view first.
    const pointerClick = async (selector) => {
      await evaluate(`(()=>{
        const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null);
        if(!e)throw Error('No visible control: '+${JSON.stringify(selector)});
        e.scrollIntoView({block:"center",behavior:"instant"});
      })()`);
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element && a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      const point = await evaluate(`(()=>{
        const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null),r=e.getBoundingClientRect();
        const x=r.left+r.width/2,y=r.top+r.height/2;
        return {x,y,reachable:x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))};
      })()`);
      verify(`pointer reaches ${selector}`, point.reachable);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    };
    const checkNavigationCovered = async (width, backdrop) => {
      if (width !== 390) return;
      verify(`${width}: ${backdrop} covers the navigation hit area`, await evaluate(`(()=>{
        const bar=document.querySelector('.mobile-navigation-bar'),r=bar.getBoundingClientRect();
        return r.height>0&&[.1,.5,.9].every(part=>{
          const hit=document.elementFromPoint(r.left+r.width*part,r.top+r.height/2);
          return !!hit?.closest(${JSON.stringify(backdrop)});
        });
      })()`));
    };
    const pressEscape = async () => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    };

    if (!immediateProducts && !process.argv.includes("--capture-only")) {
      const originalCustomer = { ...customer };
      const originalProduction = { ...production };
      const startWrites = writes.length;
      let safeAreaSupported = true;
      try {
        await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
      } catch (error) {
        // Only an absent experimental CDP command is a supported skip.
        if (!/wasn't found|not found|not supported/i.test(error.message)) throw error;
        safeAreaSupported = false;
        console.log("SKIP safe-area emulation: this Chromium lacks the CDP command.");
      }
      const customerFields = ["#customer-name-ar", "#customer-name", "#customer-tax-number",
        "#customer-phone", "#customer-sales-rep", "#customer-city", "#customer-active",
        "#customer-drawer-letter", "#customer-drawer-number", "#customer-drawer-code"];
      const resize = async (label, width, height, landscape = false) => {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true,
          screenOrientation: { type: landscape ? "landscapePrimary" : "portraitPrimary", angle: landscape ? 90 : 0 } });
        await wait(`innerWidth===${width}&&innerHeight===${height}&&Math.abs(visualViewport.height-${height})<1`);
        verify(`${label}: real layout and visual viewport resized`, await evaluate(`innerHeight===${height}&&visualViewport.height<=${height}+1`));
      };
      const probe = async (label, modal, fields, actions) => {
        await wait(`!!document.querySelector(${JSON.stringify(modal)})?.contains(document.activeElement)`);
        verify(`${label}: dialog remains within viewport width`, await evaluate(`(()=>{
          const d=document.querySelector(${JSON.stringify(modal)}),r=d.getBoundingClientRect();
          return document.documentElement.scrollWidth<=innerWidth&&r.left>=0&&r.right<=innerWidth+1;
        })()`));
        for (const selector of [...fields, ...actions]) {
          // Hit-test actions without activating them yet.
          if (actions.includes(selector)) {
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
            verify(`${label}: action hit point ${selector}`, await evaluate(`(()=>{
              const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();
              const x=r.left+r.width/2,y=r.top+r.height/2;
              return !e.disabled&&x>=0&&x<innerWidth&&y>=0&&y<visualViewport.height&&e.contains(document.elementFromPoint(x,y));
            })()`));
          } else {
            await pointerClick(selector);
            verify(`${label}: field receives focus ${selector}`, await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`));
            if (/sales-rep|drawer-letter|drawer-number/.test(selector)) await pointerClick("#customer-drawer-code");
          }
        }
      };
      const checkScroll = async (label, modal) => {
        const point = await evaluate(`(()=>{
          const d=document.querySelector(${JSON.stringify(modal)});
          d.scrollTop=0;const r=d.getBoundingClientRect();
          const x=r.left+r.width/2,y=Math.max(0,r.top)+Math.min(r.height,innerHeight)/2;
          return {x,y,overflow:d.scrollHeight>d.clientHeight+1,reachable:d.contains(document.elementFromPoint(x,y))};
        })()`);
        verify(`${label}: scroll target is overflowing and unobscured`, point.overflow && point.reachable);
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 10000 });
        await wait(`document.querySelector(${JSON.stringify(modal)}).scrollTop>0`);
        verify(`${label}: browser scroll input moves dialog down`, await evaluate(`document.querySelector(${JSON.stringify(modal)}).scrollTop>0`));
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -10000 });
        await wait(`document.querySelector(${JSON.stringify(modal)}).scrollTop===0`);
        verify(`${label}: browser scroll input returns dialog to top`, await evaluate(`document.querySelector(${JSON.stringify(modal)}).scrollTop===0`));
      };
      const openProduction = async (mode) => {
        const selector = mode === "view" ? '[aria-label="عرض أمر الإنتاج"]' : '[aria-label="تعديل أمر إنتاج"]';
        await wait(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.offsetParent!==null)`);
        await pointerClick(selector);
        await wait(mode === "view" ? "!!document.querySelector('.production-order-details')" : "!!document.querySelector('#production-order-quantity')");
      };
      // Load the app's viewport meta before enabling mobile metrics; about:blank
      // otherwise uses Chromium's 980px fallback layout viewport.
      await navigate("/customers");
      for (const phone of [
        { name: "small-phone", width: 320, height: 480, keyboard: 260, rotatedWidth: 480, rotatedHeight: 240 },
        { name: "phone", width: 390, height: 640, keyboard: 300, rotatedWidth: 640, rotatedHeight: 260 },
      ]) {
        const label = phone.name;
        await resize(label, phone.width, phone.height);
        await navigate("/customers");
        await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('إضافة عميل'))");
        await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة عميل')).focus()");
        await openCustomer();
        await pointerClick("#customer-name-ar");
        await input("#customer-name-ar", "عميل لوحة المفاتيح");
        await input("#customer-name", "Keyboard fixture");
        await resize(`${label} keyboard open`, phone.width, phone.keyboard);
        verify(`${label}: customer focus survives keyboard resize`, await evaluate("document.activeElement.id==='customer-name-ar'"));
        await probe(label, ".customer-modal", customerFields,
          [".customer-modal-submit", ".customer-modal-footer button[type=button]"]);
        await checkScroll(label, ".customer-modal");
        await screenshot(`keyboard-${label}-customer-portrait`);
        await resize(`${label} rotate with keyboard`, phone.rotatedWidth, phone.rotatedHeight, true);
        if (safeAreaSupported) {
          await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 44, right: 44, bottom: 21 } });
          verify(`${label}: nonzero safe-area environment is active`, await evaluate(`(()=>{
            const e=document.createElement('div');e.style.padding='env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
            document.body.append(e);const s=getComputedStyle(e);
            const ok=s.paddingLeft==='44px'&&s.paddingRight==='44px'&&s.paddingBottom==='21px';e.remove();return ok;
          })()`));
        }
        await probe(`${label} landscape`, ".customer-modal", customerFields,
          [".customer-modal-submit", ".customer-modal-footer button[type=button]"]);
        verify(`${label}: customer draft survives rotation`, await evaluate("document.querySelector('#customer-name-ar').value==='عميل لوحة المفاتيح'&&document.querySelector('#customer-name').value==='Keyboard fixture'"));
        await screenshot(`keyboard-${label}-customer-landscape`);
        await resize(`${label} customer keyboard dismissed while open`, phone.width, phone.height);
        if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        await probe(`${label} customer restored`, ".customer-modal", ["#customer-name-ar", "#customer-drawer-code"],
          [".customer-modal-submit", ".customer-modal-footer button[type=button]"]);
        await resize(`${label} customer keyboard reopened`, phone.rotatedWidth, phone.rotatedHeight, true);
        failSave = true;
        const customerBefore = writes.length;
        await pointerClick(".customer-modal-submit");
        await wait("!!document.querySelector('.customer-modal-save-error')&&!document.querySelector('.customer-modal-submit').disabled");
        verify(`${label}: customer save reaches isolated API`, writes.length, customerBefore + 1);
        verify(`${label}: failed save preserves customer draft`, await evaluate("document.querySelector('#customer-name').value==='Keyboard fixture'"));
        failSave = false;
        await pointerClick(".customer-modal-footer button[type=button]");
        await wait("!document.querySelector('.customer-modal')");
        verify(`${label}: customer cancel restores opener focus`, await evaluate("document.activeElement.textContent.includes('إضافة عميل')"));
        verify(`${label}: cancel does not write`, writes.length, customerBefore + 1);
        await openCustomer();
        await pressEscape();
        await wait("!document.querySelector('.customer-modal')");
        verify(`${label}: customer Escape restores opener focus`, await evaluate("document.activeElement.textContent.includes('إضافة عميل')"));
        await openCustomer();
        await input("#customer-name", "Keyboard saved fixture");
        await pointerClick(".customer-modal-submit");
        await wait("location.pathname.startsWith('/customers/CID3')&&!document.querySelector('.customer-modal')");
        verify(`${label}: customer save redirects to fixture profile`, await evaluate("location.pathname"), `/customers/${customer.id}`);
        verify(`${label}: customer save succeeds in short landscape`, writes.at(-1).payload.name, "Keyboard saved fixture");

        await resize(`${label} keyboard dismissed`, phone.width, phone.height);
        if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        await navigate("/orders?tab=production");
        await openProduction("edit");
        await pointerClick("#production-order-quantity");
        await input("#production-order-quantity", "135.25");
        await resize(`${label} production keyboard`, phone.width, phone.keyboard);
        verify(`${label}: production focus survives keyboard resize`, await evaluate("document.activeElement.id==='production-order-quantity'"));
        await probe(label, ".production-order-modal", ["#production-order-quantity"],
          [".production-order-submit", ".production-order-modal footer button[type=button]"]);
        await resize(`${label} production rotate`, phone.rotatedWidth, phone.rotatedHeight, true);
        if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 44, right: 44, bottom: 21 } });
        await probe(`${label} landscape`, ".production-order-modal", ["#production-order-quantity"],
          [".production-order-submit", ".production-order-modal footer button[type=button]"]);
        verify(`${label}: quantity survives rotation`, await evaluate("document.querySelector('#production-order-quantity').value"), "135.25");
        await screenshot(`keyboard-${label}-production-landscape`);
        await resize(`${label} production keyboard dismissed while open`, phone.width, phone.height);
        if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        await probe(`${label} production restored`, ".production-order-modal", ["#production-order-quantity"],
          [".production-order-submit", ".production-order-modal footer button[type=button]"]);
        await resize(`${label} production keyboard reopened`, phone.rotatedWidth, phone.rotatedHeight, true);
        const productionBefore = writes.length;
        await pointerClick(".production-order-modal footer button[type=button]");
        await wait("!document.querySelector('.production-order-modal')");
        verify(`${label}: production cancel restores focus`, await evaluate("document.activeElement.getAttribute('aria-label')==='تعديل أمر إنتاج'"));
        verify(`${label}: production cancel does not write`, writes.length, productionBefore);
        await openProduction("edit");
        await input("#production-order-quantity", "135.25");
        staleProduction = true;
        await pointerClick(".production-order-submit");
        await wait("!!document.querySelector('.production-order-error')&&!document.querySelector('.production-order-submit').disabled");
        verify(`${label}: rejected production save preserves quantity`, await evaluate("document.querySelector('#production-order-quantity').value"), "135.25");
        staleProduction = false;
        await pointerClick(".production-order-submit");
        await wait("!document.querySelector('.production-order-modal')");
        verify(`${label}: production saved by pointer after isolated rejection`, writes.length, productionBefore + 2);
        verify(`${label}: production save payload`, writes.at(-1).payload, { quantity_kg: "135.25" });
        // Successful save refreshes/remounts the list; opener focus recovery
        // across that refresh is separate from cancel/Escape restoration.
        await openProduction("edit");
        await pressEscape();
        await wait("!document.querySelector('.production-order-modal')");
        verify(`${label}: production Escape restores focus`, await evaluate("document.activeElement.getAttribute('aria-label')==='تعديل أمر إنتاج'"));
        await openProduction("view");
        await checkScroll(`${label} read-only details`, ".production-order-modal");
        await pointerClick(".production-order-modal footer button[type=button]");
        await wait("!document.querySelector('.production-order-modal')");
        verify(`${label}: view close restores focus`, await evaluate("document.activeElement.getAttribute('aria-label')==='عرض أمر الإنتاج'"));
        await resize(`${label} portrait restored`, phone.width, phone.height);
        if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
        await openProduction("edit");
        await probe(`${label} restored`, ".production-order-modal", ["#production-order-quantity"],
          [".production-order-submit", ".production-order-modal footer button[type=button]"]);
        await screenshot(`keyboard-${label}-restored`);
        await pressEscape();
        await wait("!document.querySelector('.production-order-modal')");
        customer = { ...originalCustomer };
        production = { ...originalProduction };
      }
      verify("keyboard checks use only customer and production fixture writes",
        writes.slice(startWrites).every(w => (w.route === "/customers" && w.method === "POST") ||
          (w.route === "/production-orders/8" && w.method === "PUT")));
      verify("keyboard checks never open the standalone product editor", await evaluate("!document.querySelector('.cp-modal')"));
      await Promise.all([...fixtureResponses]);
      verify("keyboard checks have no browser runtime errors", errors, []);
      if (safeAreaSupported) await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
      nextCustomerNumber = 333;
      writes.splice(startWrites);
      if (process.argv.includes("--mobile-keyboard-only")) {
        console.log(`Mobile keyboard regression passed: ${checks} checks; fixture APIs only. OS keyboard/visual-only pan not emulated.`);
        return;
      }
    }

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
      await Promise.all([...fixtureResponses]);
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

    for (const width of [390, 768, 1024, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await navigate("/customers");
      await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('إضافة عميل'))");
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('إضافة عميل')).focus()");
      await openCustomer();
      await checkNavigationCovered(width, ".customer-modal-backdrop");
      for (const selector of ["#customer-name-ar", "#customer-name", "#customer-tax-number", "#customer-phone", "#customer-sales-rep", "#customer-city", "#customer-active", "#customer-drawer-letter", "#customer-drawer-number", "#customer-drawer-code"]) {
        await pointerClick(selector);
        // Close any native select popup without closing the dialog.
        if (selector.includes("sales-rep") || selector.includes("drawer-letter") || selector.includes("drawer-number")) {
          await pointerClick("#customer-drawer-code");
        }
      }
      const beforeEmptySave = writes.length;
      await pointerClick(".customer-modal-submit");
      await wait("!!document.querySelector('.customer-modal-save-error')");
      verify(`${width}: reachable save validates without writing`, writes.length, beforeEmptySave);
      verify(`${width}: no customer code input`, await evaluate("!document.querySelector('[role=dialog] input[name=id], [role=dialog] #id') && document.querySelectorAll('[role=dialog] input:not([readonly])').length===6"));
      verify(`${width}: only representatives endpoint choices`, await evaluate("document.querySelector('#customer-sales-rep').options.length"), 2);
      verify(`${width}: modal/page do not overflow`, await evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth"));
      if (width > 700) {
        verify(`${width}: names in one row`, await evaluate("Math.abs(document.querySelector('#customer-name').getBoundingClientRect().top-document.querySelector('#customer-name-ar').getBoundingClientRect().top)<2"));
        verify(`${width}: three contact fields in one row`, await evaluate("(()=>{const ys=['#customer-tax-number','#customer-phone','#customer-sales-rep'].map(s=>document.querySelector(s).getBoundingClientRect().top);return Math.max(...ys)-Math.min(...ys)<2})()"));
      }
      await screenshot(`customer-form-${width}`);
      await pointerClick(".customer-modal-footer button[type=button]");
      await wait("!document.querySelector('.customer-modal')");
      verify(`${width}: customer cancel restores opener focus`, await evaluate("document.activeElement.textContent.includes('إضافة عميل')"));
      const navSelector = width === 390 ? ".mobile-navigation-bar a" : ".sidebar .nav a";
      const navPath = await evaluate(`new URL(document.querySelector(${JSON.stringify(navSelector)}).href).pathname`);
      await pointerClick(navSelector);
      await wait(`location.pathname===${JSON.stringify(navPath)}&&!document.querySelector('[role=dialog]')`);
      verify(`${width}: navigation works after cancel`, await evaluate(`location.pathname===${JSON.stringify(navPath)}`));
      await navigate("/orders?tab=production");
      await wait("!!document.querySelector('[aria-label=\"عرض أمر الإنتاج\"]')");
      await click('[aria-label="عرض أمر الإنتاج"]');
      await wait("!!document.querySelector('.production-order-details')");
      await checkNavigationCovered(width, ".production-order-modal-backdrop");
      verify(`${width}: view is read-only`, await evaluate("document.querySelectorAll('[role=dialog] input,[role=dialog] select,[role=dialog] textarea,[role=dialog] form').length"), 0);
      verify(`${width}: view shows order and customer`, await evaluate("document.querySelector('[role=dialog]').textContent.includes('123-01')&&document.querySelector('[role=dialog]').textContent.includes('عميل تجريبي')"));
      verify(`${width}: view fits viewport`, await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth"));
      await screenshot(`production-view-${width}`);
      await close();
      await evaluate("[...document.querySelectorAll('[aria-label=\"تعديل أمر إنتاج\"]')].find(e=>e.offsetParent!==null).focus()");
      await click('[aria-label="تعديل أمر إنتاج"]');
      await wait("!!document.querySelector('#production-order-quantity')");
      await checkNavigationCovered(width, ".production-order-modal-backdrop");
      await pointerClick("#production-order-quantity");
      await input("#production-order-quantity", "");
      const beforeEmptyQuantity = writes.length;
      await pointerClick(".production-order-submit");
      await wait("!!document.querySelector('.production-order-error')");
      verify(`${width}: reachable production save validates without writing`, writes.length, beforeEmptyQuantity);
      verify(`${width}: edit has exactly one quantity input`, await evaluate("document.querySelectorAll('[role=dialog] input,[role=dialog] select,[role=dialog] textarea').length"), 1);
      await pointerClick(".production-order-modal footer button[type=button]");
      await wait("!document.querySelector('.production-order-modal')");
      verify(`${width}: production cancel restores opener focus`, await evaluate("document.activeElement.getAttribute('aria-label')==='تعديل أمر إنتاج'"));
      await click('[aria-label="تعديل أمر إنتاج"]');
      await wait("!!document.querySelector('.production-order-modal')?.contains(document.activeElement)");
      await pressEscape();
      await wait("!document.querySelector('.production-order-modal')");
      verify(`${width}: Escape restores production opener focus`, await evaluate("document.activeElement.getAttribute('aria-label')==='تعديل أمر إنتاج'"));
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
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      verify(`nested customer dialog fits ${width}px`,
        await evaluate("(()=>{const r=document.querySelector('.customer-modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth})()"));
      await checkNavigationCovered(width, ".customer-modal-backdrop");
      await pointerClick("#customer-name");
      await pointerClick(".customer-modal-submit");
      await wait("!!document.querySelector('.customer-modal-save-error')");
      verify(`${width}: child save is reachable without writing`, writes.length, inlineStart);
      await screenshot(`inline-customer-${width}`);
      await pointerClick(".customer-modal-footer button[type=button]");
      await wait("!document.querySelector('.customer-modal')&&document.activeElement.id==='cp-customer'");
      verify(`${width}: child cancel restores parent and its values`,
        await evaluate("!document.querySelector('.cp-modal').inert&&document.querySelector('#cp-width').value==='30'&&document.querySelector('.cp-modal textarea').value==='Keep the product draft during customer creation'"));
      await pointerClick("#cp-customer");
      await wait("!!document.querySelector('.cp-customer-menu')");
      await pointerClick(".cp-customer-create");
      await wait("!!document.querySelector('.customer-modal')&&!document.querySelector('.customer-modal-submit').disabled");
      await pressEscape();
      await wait("!document.querySelector('.customer-modal')&&document.activeElement.id==='cp-customer'");
      verify(`${width}: child Escape leaves parent open`, await evaluate("!!document.querySelector('.cp-modal')&&!document.querySelector('.cp-modal').inert"));
      await pointerClick("#cp-customer");
      await wait("!!document.querySelector('.cp-customer-menu')");
      await pointerClick(".cp-customer-create");
      await wait("!!document.querySelector('.customer-modal')&&!document.querySelector('.customer-modal-submit').disabled");
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
    await Promise.all([...fixtureResponses]);
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