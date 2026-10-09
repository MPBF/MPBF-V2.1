// Runs against the real frontend, intercepting every /api request with fixtures.
// Never authenticates as a real user or writes to the database.
// Requires Chromium and Poppler's pdftotext to verify the generated PDF pages.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const outputDir = path.join("screenshots", "order-signatures");
const releaseOnly = process.argv.includes("--production-release-only");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "order-actions-browser-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let passed = 0;
  const check = (name, value, expected = true) => { assert.deepEqual(value, expected, name); console.log(`PASS ${name}`); passed++; };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
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
    const pending = new Map();
    let session;
    const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    let permissions = ["view_orders"];
    let detailStatus = 200;
    let large = false;
    let largeRowCount = 38;
    let noLines = false;
    let language = "ar";
    let anonymous = false;
    const publicKey = "F".repeat(43);
    const publicPath = `/shared/orders/7/print?key=${publicKey}`;
    const requests = [];
    const errors = [];
    let releaseLoad, failRelease = false;
    const releaseWrites = [];
    const order = { id: 7, order_number: "ORD123", customer_id: "CID010", status: "in_production",
      previous_status: "waiting", notes: "تعليمات الطلب التجريبي", created_by: 42,
      created_at: "2026-10-02T22:30:00.000Z", delivery_date: "2026-10-18", delivery_days: 15 };
    const product = { id: 11, customer_id: "CID010", category_id: "CAT01", item_id: "ITM01",
      size_caption: "28.4+7.5+7.5X41.49", width: "28.40", left_facing: "7.50", right_facing: "7.50", thickness: "10",
      universal_thickness: "25.40", density: "0.95", bag_weight_grams: "4.85", bags_per_kilo: "206",
      printing_cylinder: "16.5", cutting_length_cm: 41, raw_material: "HDPE", master_batch_id: "PT01",
      is_printed: true, cutting_unit: "kg", punching: "بنانة", unit_weight_kg: "1.00", unit_quantity: 20,
      package_weight_kg: "20.00", cliche_front_design: null, cliche_back_design: null,
      front_print_colors: ["أزرق"], back_print_colors: [], notes: "تعليمات المنتج التجريبي",
      status: "active", created_at: "2026-08-03T06:00:00.000Z",
      category: { id: "CAT01", code: "CB", name_ar: "أكياس", name: "Bags" },
      item: { id: "ITM01", code: "S-CB", name_ar: "بنانة - S", name: "Banana S" },
      color: { id: "PT01", name_ar: "أبيض", name: "White", brand: "Test", color_hex: "#ffffff" } };
    const first = { id: 9, order_id: 7, production_order_number: "ORD123-01", customer_product_id: 11,
      quantity_kg: "300.00", final_quantity_kg: "330.00", overrun_percentage: "10.00", status: "active",
      previous_status: "pending", batch_number: "BATCH01", created_at: "2026-10-03T06:00:00.000Z", product };
    const palette = [
      { id: "PT02", name_ar: "شفاف", name: "Transparent", color_hex: "#ffffff", text_color: "#000000", is_active: true },
      { id: "PT01", name_ar: "أبيض", name: "White", color_hex: "#ffffff", text_color: "#000000", is_active: true },
    ];
    const paletteProducts = () => palette.map((color, index) => ({
      ...product, id: 11 + index, master_batch_id: color.id, master_batch_name_ar: color.name_ar,
      master_batch_name: color.name, master_batch_color_hex: color.color_hex,
      category_name_ar: "أكياس", category_name: "Bags", item_name_ar: "بنانة - S", item_name: "Banana S",
    }));
    const detail = () => {
      const lines = noLines ? [] : large ? Array.from({ length: largeRowCount }, (_, i) => ({
        ...first, id: 100 + i, production_order_number: `ORD123-${i + 1}`,
        product: { ...product, notes: `تعليمات المنتج ${i + 1}: بيانات اختبار لتأكيد تكرار رأس الجدول وعدم قص الصفوف عند الطباعة` },
      })) : [first, { ...first, id: 10, product: null, customer_product_id: null, production_order_number: "ORD123-02",
        quantity_kg: "100.50", final_quantity_kg: "105.53", overrun_percentage: "5", status: "pending", batch_number: null }];
      return { order,
        customer: { id: "CID010", name_ar: "عميل تجريبي", name: "Test Customer", plate_drawer_code: "C-24",
          sales_rep_id: 8, phone: "0501234567", city: "مدينة تجريبية", tax_number: "7000000000", is_active: true,
          address: null, code: null, user_id: null, commercial_name: null, unified_number: null,
          unique_customer_number: null, created_at: "2026-08-03T06:00:00.000Z" },
        creator: { id: 42, display_name_ar: "منشئ تجريبي", display_name: "Creator", full_name: null, username: "creator" },
        sales_representative: { id: 8, display_name_ar: "مندوب تجريبي", display_name: "Representative", full_name: null, username: "rep" },
        production_orders: lines,
        totals: { requested_kg: noLines ? "0.00" : large ? String(largeRowCount * 300) : "400.50",
          planned_kg: noLines ? "0.00" : large ? String(largeRowCount * 330) : "435.53", production_order_count: lines.length,
          by_status: large ? { active: largeRowCount } : { active: 1, pending: 1 } },
        actual_production: { available: false, message: "لا توجد سجلات إنتاج فعلي. الكميات المعروضة مخططة." } };
    };
    const intercept = async (event) => {
      const { request, requestId } = event.params;
      const route = new URL(request.url).pathname.replace(/^\/api/, "");
      requests.push({ route, method: request.method });
      if (request.method !== "GET" && !(releaseOnly && /^\/orders\/\d+\/release-production$/.test(route))) throw Error(`Unexpected write ${request.method} ${route}`);
      let body = [];
      let status = 200;
      if (request.method === "POST" && releaseOnly) {
        const input=JSON.parse(request.postData);
        releaseWrites.push(input);
        if(failRelease){failRelease=false;status=409;body={message:"تغيرت حالة الطلب؛ حدّث البيانات قبل تحويله إلى الإنتاج."};}
        else {order.previous_status=order.status;order.status="for_production";body={order};}
      }
      else if (route === "/me") {
        if(anonymous){status=401;body={message:"Unauthorized"};}
        else body = { user: { id: 42, display_name_ar: "مستخدم تجريبي", username: "test", preferred_language: language, permissions } };
      }
      else if (route === "/public-branding") body = { companyNameAr: "مصنع أكياس البلاستيك الحديث", companyNameEn: "Modern Plastic Bags Factory",
        logoSrc: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70"><rect width="70" height="70" rx="12" fill="#167a6d"/><text x="35" y="43" fill="white" font-size="20" text-anchor="middle">MPBF</text></svg>') };
      else if (/^\/orders\/\d+\/print-link$/.test(route)) body = {path:publicPath};
      else if (/^\/public\/orders\/\d+\/print$/.test(route)) {
        status=route==="/public/orders/7/print"&&new URL(request.url).searchParams.get("key")===publicKey?200:404;
        body=status===200?{...detail(),public_print_path:publicPath}:{message:"الطلب غير موجود",message_en:"Order not found."};
      }
      else if (route === "/orders") body = [{ ...order, customer_name_ar: "عميل تجريبي", production_orders_summary: [] }];
      else if (route === "/orders/display-folders") body = { counts: { new: 1, production: 0, urgent: 0, archive: 0 }, total: 1 };
      else if (route === "/master-batch-colors") body = palette;
      else if (route === "/customer-products") body = paletteProducts();
      else if (route === "/customers") body = [detail().customer];
      else if (route === "/categories") body = [product.category];
      else if (route === "/items") body = [{ ...product.item, category_id: product.category_id, status: "active" }];
      else if (route === "/customer-products/form-options") body = { printing_cylinders: ["16.5"] };
      else if (route === "/customers/CID010/detail") body = { customer: detail().customer, products: paletteProducts() };
      else if (/^\/orders\/\d+\/details$/.test(route)) {
        status = route.includes("/999/") ? 404 : detailStatus;
        body = status === 200 ? detail() : { message: status === 404 ? "الطلب غير موجود" : "تعذر التحميل التجريبي" };
      }
      await send("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") }, event.sessionId);
    };
    ws.on("message", (raw) => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const handler = pending.get(event.id);
        if (!handler) return;
        pending.delete(event.id);
        if (event.error) handler.reject(Error(event.error.message)); else handler.resolve(event.result);
      } else if (event.method === "Page.loadEventFired") releaseLoad?.();
      else if (event.method === "Fetch.requestPaused") intercept(event).catch((e) => errors.push(e.message));
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, null);
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, null)).sessionId;
    const enable = async (s = session) => {
      await send("Page.enable", {}, s); await send("Runtime.enable", {}, s);
      await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] }, s);
    };
    await enable();
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const navigate = async (route) => { await send("Page.navigate", { url: origin + route }); };
    const click = (selector) => evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null);if(!e)throw Error('No visible control: '+${JSON.stringify(selector)});e.click();})()`);
    const capture = async (name) => {
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element&&a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      await fs.mkdir(outputDir, { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(outputDir, `${name}.png`), Buffer.from(shot.data, "base64"));
    };
    if (releaseOnly) {
      const open = async (details = false) => {
        const loaded = new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error("Release navigation timeout")),15000);
          releaseLoad=()=>{clearTimeout(timer);releaseLoad=undefined;resolve();};
        });
        await navigate(`/orders${details?`?viewOrder=${order.id}`:""}`);await loaded;
        await wait(details ? "!!document.querySelector('.odm-summary-strip')" : "!!document.querySelector('.entity-table tbody tr,.entity-card')");
      };
      for(const lang of ["ar","en"]){
        language=lang;permissions=["manage_orders"];
        for(const width of [390,768,1440]){
          order.status="waiting";await send("Emulation.setDeviceMetricsOverride",{width,height:950,deviceScaleFactor:1,mobile:width<500});
          await open(true);
          check(`${lang} ${width} release control in details`,await evaluate("!!document.querySelector('.odm-head-actions .order-release-button')"));
          check(`${lang} ${width} release layout fits`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.odm-dialog').scrollWidth<=document.querySelector('.odm-dialog').clientWidth+1"));
          if(lang==="ar"&&width===390){
            const shot=await send("Page.captureScreenshot",{format:"png"});
            await fs.writeFile(path.join(profile,"order-release-mobile.png"),Buffer.from(shot.data,"base64"));
            failRelease=true;await click(".odm-head-actions .order-release-button");
            await wait("!!document.querySelector('.odm-head-actions [role=alert]')");
            check("release conflict shown without changing order",order.status,"waiting");
          }
          const before=releaseWrites.length;
          await evaluate("(()=>{const b=document.querySelector('.odm-head-actions .order-release-button');b.click();b.click()})()");
          await wait("!!document.querySelector('.odm-summary-strip')&&!document.querySelector('.odm-head-actions .order-release-button')");
          check(`${lang} ${width} details action sends one status-only request`,releaseWrites.slice(before),[{expected_status:"waiting"}]);
          check(`${lang} ${width} details reflects ready status`,order.status,"for_production");
          order.status="waiting";await open();
          check(`${lang} ${width} release control in list`,await evaluate("[...document.querySelectorAll('.order-release-button')].some(b=>b.offsetParent!==null)"));
          check(`${lang} ${width} list fits viewport`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
          const beforeList=releaseWrites.length;await click(".order-release-button");
          await wait("!document.querySelector('.order-release-button')&&!!document.querySelector('.entity-table tbody tr,.entity-card')");
          check(`${lang} ${width} list action sends one request`,releaseWrites.length,beforeList+1);
        }
        permissions=["view_orders"];order.status="waiting";await open(true);
        check(`${lang} read-only user has no release control`,await evaluate("!document.querySelector('.order-release-button')"));
      }
      permissions=["admin"];
      for(const status of ["cancelled","completed","delivered","archived","for_production","in_production"]){
        order.status=status;await open(true);
        check(`${status} cannot be reopened from UI`,await evaluate("!document.querySelector('.order-release-button')"));
      }
      check("release browser has no runtime errors",errors,[]);
      console.log(`Verified ${passed} isolated order-release browser checks.`);return;
    }
    const pdf = async (name, printBackground = true) => {
      await evaluate(`(async()=>{
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.opp-sheet img')].map(img=>img.decode()));
      })()`);
      const result = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground, displayHeaderFooter: false });
      await fs.mkdir(outputDir, { recursive: true });
      const file = path.join(outputDir, `${name}.pdf`);
      await fs.writeFile(file, Buffer.from(result.data, "base64"));
      // Inspect the actual paginated PDF, not just the continuous print-media DOM.
      // Poppler's bbox output reverses Arabic words into their visual order.
      const xml = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      const pages = [...xml.matchAll(/<page width="([^"]+)" height="([^"]+)">([\s\S]*?)<\/page>/g)].map((match) => ({
        width: Number(match[1]), height: Number(match[2]),
        words: [...match[3].matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g)]
          .map((word) => ({ x: (Number(word[1]) + Number(word[3])) / 2, y: Number(word[2]), bottom: Number(word[4]), text: word[5] })),
      }));
      check(`${name}: all pages are A4 landscape and nonempty`, pages.length > 0 && pages.every(
        (page) => Math.abs(page.width - 841.89) < 1 && Math.abs(page.height - 595.28) < 1 && page.words.length > 0
      ));
      const signatureMarkers = language === "en" ? ["Manager", "Approved", "Created"] : ["ريدملا", "دامتعلاا", "ءاشنلإا"];
      const signaturePages = signatureMarkers.map((marker) => pages.findIndex((page) => page.words.some((word) => word.text === marker)));
      const stampPages = pages.flatMap((page, index) => page.words.some(
        (word) => word.text === (language === "en" ? "SYSTEM" : "دنتسم")
      ) ? [index] : []);
      check(`${name}: all signatures and the sole generation stamp share the last page`,
        signaturePages.every((index) => index === pages.length - 1) && stampPages.length === 1 && stampPages[0] === pages.length - 1);
      check(`${name}: generation time follows signatures without clipping`, pages.at(-1).words.some(
        (word) => /\d+:\d{2}:\d{2}/.test(word.text) && word.y > Math.max(...pages.at(-1).words.filter(
          (word) => signatureMarkers.includes(word.text)
        ).map((word) => word.bottom)) && word.bottom < pages.at(-1).height - 19
      ));
      const rowNumbers = [];
      for (const [index, page] of pages.entries()) {
        const header = page.words.find((word) => word.text === "#");
        const quantities = page.words.filter((word) => word.text === "kg");
        if (!header) {
          check(`${name} page ${index + 1}: no production rows without a repeated header`, quantities.length === 0);
          continue;
        }
        const rows = page.words.filter((word) => /^\d+$/.test(word.text) && word.y > header.bottom && Math.abs(word.x - header.x) < 7);
        rowNumbers.push(...rows.map((word) => Number(word.text)));
        if (rows.length) {
          check(`${name} page ${index + 1}: header and complete quantity cells accompany every row`,
            page.words.some((word) => word.text === (language === "en" ? "Item" : "فنصلا")) &&
            quantities.filter((word) => word.y > header.bottom).length === rows.length);
        }
      }
      const expectedCount = noLines ? 0 : large ? largeRowCount : 2;
      check(`${name}: every row prints exactly once, in order`, rowNumbers, Array.from({ length: expectedCount }, (_, i) => i + 1));
      if (large && largeRowCount === 38) check(`${name}: no seventh footer-only page`, pages.length <= 6);
      console.log(`PDF ${name}: ${expectedCount} rows, ${pages.length} pages`);
    };
    const checkSignatures = async (context) => {
      check(`${context}: complete localized signature titles`, await evaluate(
        "[...document.querySelectorAll('.opp-signatures > div > strong')].map(e=>e.textContent.trim())"
      ), language === "en" ? ["Manager", "Approved By", "Created By"] : ["المدير", "تم الاعتماد بواسطة", "تم الإنشاء بواسطة"]);
      check(`${context}: titles have no line background or clipping`, await evaluate(`(()=>{
        const titles=[...document.querySelectorAll('.opp-signatures .opp-bilingual')];
        return titles.length===3&&titles.every(e=>{
          const style=getComputedStyle(e), rect=e.getBoundingClientRect();
          return style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.marginTop==='0px'
            &&rect.height>=27&&e.scrollHeight<=e.clientHeight&&e.scrollWidth<=e.clientWidth;
        });
      })()`));
      check(`${context}: three signature lines retain width, color and bottom position`, await evaluate(`(()=>{
        const lines=[...document.querySelectorAll('.opp-signatures > div > span')];
        return lines.length===3&&lines.every(e=>{
          const style=getComputedStyle(e), rect=e.getBoundingClientRect(), parent=e.parentElement.getBoundingClientRect();
          return style.backgroundColor==='rgb(64, 75, 70)'&&rect.height===1
            &&Math.abs(rect.width-parent.width*.68)<1&&Math.abs(rect.bottom-parent.bottom)<1
            &&rect.top>=e.parentElement.querySelector('strong').getBoundingClientRect().bottom;
        });
      })()`));
      check(`${context}: creator name remains above its signature line`, await evaluate(`(()=>{
        const name=document.querySelector('.opp-signatures b'), line=name.nextElementSibling;
        return name.textContent.trim()==='منشئ تجريبي'
          &&name.getBoundingClientRect().bottom<=line.getBoundingClientRect().top;
      })()`));
    };
    const checkPrintSignatures = async (context) => {
      await send("Emulation.setEmulatedMedia", { media: "print" });
      try {
        await checkSignatures(`${context} A4 landscape`);
        check(`${context}: signatures and footer form one unbreakable closing block`, await evaluate(`(()=>{
          const closing=document.querySelector('.opp-closing'), style=getComputedStyle(closing);
          return closing.contains(document.querySelector('.opp-signatures'))
            &&closing.contains(document.querySelector('.opp-generated'))
            &&style.breakInside==='avoid'&&style.pageBreakInside==='avoid'
            &&!!document.querySelector('.opp-generated time');
        })()`));
      }
      finally { await send("Emulation.setEmulatedMedia", { media: "" }); }
    };

    if (process.argv.includes("--public-print-only")) {
      anonymous=true;
      for(const width of [390,768,1280]){
        await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<700});
        const before=requests.length;
        await navigate(publicPath);
        await wait("!!document.querySelector('.opp-sheet')");
        check(`${width}: anonymous QR opens print copy, not login`,await evaluate("!!document.querySelector('.opp-sheet')&&!document.querySelector('input[type=password]')&&!document.querySelector('.shell')"));
        check(`${width}: approved customer contact and creator are printed`,await evaluate("document.querySelector('.opp-sheet').textContent.includes('0501234567')&&document.querySelector('.opp-sheet').textContent.includes('منشئ تجريبي')"));
        check(`${width}: public page uses only anonymous print API`,!requests.slice(before).some(r=>r.route.endsWith("/details")||r.route.endsWith("/print-link")));
        check(`${width}: public preview fits viewport`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        check(`${width}: public page has QR and printable document`,await evaluate("!!document.querySelector('.opp-qr')&&!!document.querySelector('.opp-print-action')&&document.querySelectorAll('.opp-spec-row').length===2"));
        if(width===1280){
          await capture("public-order-print-anonymous");
          await pdf("public-order-print-a4");
          await evaluate("window.__prints=0;window.print=()=>{window.__prints++;window.dispatchEvent(new Event('afterprint'))}");
          await click(".opp-print-action");
          await wait("window.__prints===1");
        }
      }
      for(const route of ["/shared/orders/7/print","/shared/orders/7/print?key=invalid",`/shared/orders/8/print?key=${publicKey}`]){
        await navigate(route); await wait("!!document.querySelector('.opp-page-error')");
        check(`invalid link ${route.split("?")[0]} reveals no document`,await evaluate("!document.querySelector('.opp-sheet')&&!document.querySelector('input[type=password]')"));
      }
      await navigate("/orders/7/print");await wait("!!document.querySelector('input[type=password]')");
      check("internal print route still requires login",await evaluate("!document.querySelector('.opp-sheet')"));
      await navigate("/orders");await wait("!!document.querySelector('input[type=password]')");
      check("normal order pages still require login",await evaluate("!document.querySelector('.opp-sheet')"));
      check("public preview makes no writes",requests.every(r=>r.method==="GET"));
      check("public browser has no exceptions",errors,[]);
      console.log(`Verified ${passed} anonymous public-print browser checks.`);
      return;
    }
    if (!process.argv.includes("--header-transparent-only")) {
    for (const width of (process.argv.includes("--print-only") ? [1280] : [390, 768, 1280])) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await navigate("/orders?tab=orders");
      await wait("!!document.querySelector('[aria-label=\"عرض الطلب\"]')");
      check(`${width}: read-only user has view and print, no edit`, await evaluate("!!document.querySelector('[aria-label=\"طباعة الطلب\"]')&&!document.querySelector('[aria-label=\"تعديل طلب\"]')"));
      check(`${width}: print uses an independent protected tab`, await evaluate("(()=>{const a=document.querySelector('[aria-label=\"طباعة الطلب\"]');return a.target==='_blank'&&a.getAttribute('href')==='/orders/7/print'&&a.rel.includes('noopener')})()"));
      await click('[aria-label="عرض الطلب"]');
      await wait("!!document.querySelector('.odm-summary-strip')");
      check(`${width}: creator and all production orders shown`, await evaluate("document.querySelector('[role=dialog]').textContent.includes('منشئ تجريبي')&&document.querySelectorAll('.odm-production-card').length===2"));
      check(`${width}: view read-only and fits viewport`, await evaluate("!document.querySelector('[role=dialog] input,[role=dialog] select')&&document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth&&document.documentElement.scrollWidth<=innerWidth"));
      await click(".odm-production-toggle");
      check(`${width}: complete product and production specifications available`, await evaluate("document.querySelector('.odm-production-body').textContent.includes('تعليمات المنتج التجريبي')&&document.querySelector('.odm-production-body').textContent.includes('السماكة العامة')&&document.querySelector('.odm-production-body').textContent.includes('BATCH01')"));
      await capture(`order-details-${width}`);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait("!document.querySelector('[role=dialog]')");
      await navigate("/orders/7/print");
      await wait("!!document.querySelector('.opp-sheet')");
      check(`${width}: print is standalone, not the app shell`, await evaluate("!document.querySelector('.shell')"));
      check(`${width}: bilingual 12-column document and creator signature`, await evaluate("document.querySelectorAll('.opp-spec-table thead th').length===12&&document.querySelector('.opp-signatures').textContent.includes('منشئ تجريبي')&&document.querySelector('.opp-sheet').textContent.includes('PRODUCTION ORDER')"));
      await capture(`order-print-${width}`);
      check(`${width}: correct universal thickness, logo, QR and localized Riyadh date`, await evaluate("({thickness:document.querySelector('.opp-sheet').textContent.includes('25 MIC'),logo:!!document.querySelector('.opp-logo'),qr:!!document.querySelector('.opp-qr'),date:document.querySelector('.opp-order-id div:nth-child(2) span').textContent.trim()===new Intl.DateTimeFormat('ar-SA-u-nu-latn',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Riyadh'}).format(new Date('2026-10-02T22:30:00.000Z')).replace(/[\\u061c\\u200e\\u200f]/g,'')})"), { thickness: true, logo: true, qr: true, date: true });
      check(`${width}: larger logo and QR, bilingual names centered beside logo`, await evaluate(`(()=>{
        const logo=document.querySelector('.opp-logo'),qr=document.querySelector('.opp-qr'),names=document.querySelector('.opp-brand-names');
        const ar=names.querySelector('h1'),en=names.querySelector('p'),l=logo.getBoundingClientRect(),n=names.getBoundingClientRect();
        return l.width===80&&l.height===80&&qr.getBoundingClientRect().width===88
          &&getComputedStyle(ar).textAlign==='center'&&getComputedStyle(en).textAlign==='center'
          &&ar.lang==='ar'&&ar.dir==='rtl'&&en.lang==='en'&&en.dir==='ltr'
          &&ar.getBoundingClientRect().bottom<=en.getBoundingClientRect().top
          &&Math.min(l.bottom,n.bottom)>Math.max(l.top,n.top)
          &&names.scrollWidth<=names.clientWidth+1;
      })()`));
      check(`${width}: header columns do not overlap`, await evaluate(`(()=>{
        const rects=[...document.querySelector('.opp-sheet-header').children].map(e=>e.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
        return rects.every((r,i)=>!i||r.left>=rects[i-1].right-1);
      })()`));
      check(`${width}: one rounded total uses the original planned sum`, await evaluate("document.querySelectorAll('.opp-total-cell strong').length===1&&document.querySelector('.opp-total-cell').textContent.trim()==='436 كجم'"));
      check(`${width}: rounded planned quantities, including missing-product rows`, await evaluate("[...document.querySelectorAll('.opp-spec-row')].map(r=>r.cells[10].textContent.trim())"), ["330 kg", "106 kg"]);
      check(`${width}: item cell contains only Arabic and English names`, await evaluate("[...document.querySelector('.opp-item-cell').children].map(e=>e.textContent.trim())"), ["بنانة - S", "Banana S"]);
      check(`${width}: both item names are centered`, await evaluate("[...document.querySelectorAll('.opp-item-cell,.opp-item-cell strong,.opp-item-cell small')].every(e=>getComputedStyle(e).textAlign==='center')"));
      check(`${width}: dimensions, thickness and cylinder are rounded`, await evaluate("(()=>{const c=document.querySelector('.opp-spec-row').cells;return [c[2],c[3],c[4],c[8]].map(e=>e.textContent.trim())})()"), ["28+8+8X41","41 cm","25 MIC","17″"]);
      check(`${width}: color circle enlarged without supplier, while color code retained`, await evaluate("(()=>{const c=document.querySelector('.opp-color-cell'),s=c.querySelector('.opp-color-swatch').getBoundingClientRect();return s.width>=32&&s.width===s.height&&!c.textContent.includes('Test')&&c.textContent.includes('#PT01')})()"));
      check(`${width}: customer field wider and drawer field compact`, await evaluate("(()=>{const t=document.querySelector('.opp-overview'),c=t.rows[0].cells;return c[1].getBoundingClientRect().width>=t.getBoundingClientRect().width*.25&&c[1].getBoundingClientRect().width>=c[3].getBoundingClientRect().width*3})()"));
      check(`${width}: missing product does not substitute order/category metadata`, await evaluate("document.querySelectorAll('.opp-item-cell')[1].textContent"), "——");
      check(`${width}: independent product and order notes are preserved`, await evaluate("document.querySelector('.opp-notes').textContent==='تعليمات المنتج التجريبي'&&document.querySelector('.opp-order-notes').textContent.includes('تعليمات الطلب التجريبي')"));
      await checkSignatures(`Arabic ${width} preview`);
      check(`${width}: horizontal scrolling stays inside paper preview`, await evaluate("document.documentElement.scrollWidth<=innerWidth"));
      if (width === 1280) {
        await evaluate("window.__prints=0;window.print=()=>{window.__prints++;window.dispatchEvent(new Event('afterprint'))}");
        await click(".opp-print-action");
        await wait("window.__prints===1");
        check("print button invokes native print when document is ready", await evaluate("window.__prints"), 1);
        await evaluate("Object.defineProperty(document.querySelector('.opp-sheet img'),'naturalWidth',{value:0,configurable:true});void 0");
        await click(".opp-print-action");
        await wait("!!document.querySelector('.opp-print-error')");
        check("missing logo reports an error rather than silently printing", await evaluate("window.__prints===1&&!document.querySelector('.opp-print-action').disabled"));
        await evaluate("delete document.querySelector('.opp-sheet img').naturalWidth;window.__blockedPrints=0;window.print=()=>{window.__blockedPrints++;throw Error('Printing unavailable')}");
        await click(".opp-print-action");
        await wait("window.__blockedPrints===1&&!!document.querySelector('.opp-print-error')");
        check("unavailable native printing reports an error and permits retry", await evaluate("window.__blockedPrints===1&&!document.querySelector('.opp-print-action').disabled"));
        await evaluate("window.print=()=>{window.__prints++;window.dispatchEvent(new Event('afterprint'))}");
        await click(".opp-print-action");
        await wait("window.__prints===2&&!document.querySelector('.opp-print-error')");
        await checkPrintSignatures("Arabic");
        await pdf("order-print-a4");
      }
    }
    await navigate("/orders?tab=orders&viewOrder=7");
    await wait("!!document.querySelector('.odm-summary-strip')");
    check("QR/deep link opens the requested authenticated order", await evaluate("document.querySelector('#odm-title').textContent.includes('ORD123')"));
    await click('[aria-label="إغلاق التفاصيل"]');
    await wait("!document.querySelector('[role=dialog]')");
    check("closing deep-linked view clears viewOrder without changing tab", await evaluate("!new URLSearchParams(location.search).has('viewOrder')&&new URLSearchParams(location.search).get('tab')==='orders'"));
    detailStatus = 503;
    await click('[aria-label="عرض الطلب"]');
    await wait("!!document.querySelector('.odm-retry')");
    check("failed detail load disables printing and offers retry", await evaluate("document.querySelector('.odm-print-button').disabled"));
    detailStatus = 200;
    await click(".odm-retry");
    await wait("!!document.querySelector('.odm-summary-strip')");
    await evaluate("window.__orderOpenCalls=[];window.open=(...args)=>{window.__orderOpenCalls.push(args);return null}");
    await click(".odm-print-button");
    check("modal print action opens the correct new tab with opener protection", await evaluate("window.__orderOpenCalls[0]"), ["/orders/7/print", "_blank", "noopener,noreferrer"]);
    await click('[aria-label="إغلاق التفاصيل"]');
    await navigate("/orders/999/print");
    await wait("!!document.querySelector('.opp-page-error')");
    check("missing order cannot print", await evaluate("document.querySelector('.opp-page-error').textContent.includes('الطلب غير موجود')&&!document.querySelector('.opp-print-action')"));
    detailStatus = 503;
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-page-error button')");
    detailStatus = 200;
    await click(".opp-page-error button");
    await wait("!!document.querySelector('.opp-sheet')");
    language = "en";
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet') && document.documentElement.lang==='en'");
    check("English preview retains both item names", await evaluate("[...document.querySelector('.opp-item-cell').children].map(e=>e.textContent.trim())"), ["بنانة - S", "Banana S"]);
    check("English preview has one rounded planned total", await evaluate("document.querySelector('.opp-total-cell').textContent.trim()"), "436 kg");
    check("English preview quantity remains rounded planned-only", await evaluate("[...document.querySelectorAll('.opp-spec-row')].map(r=>r.cells[10].textContent.trim())"), ["330 kg", "106 kg"]);
    await checkSignatures("English preview");
    await checkPrintSignatures("English");
    await capture("order-print-en");
    await pdf("order-print-a4-en");
    language = "ar";
    const originalItem = product.item;
    product.item = { ...originalItem, name: "" };
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet')");
    check("missing English item name shows dash without substituting Arabic", await evaluate("[...document.querySelector('.opp-item-cell').children].map(e=>e.textContent.trim())"), ["بنانة - S", "—"]);
    product.item = { ...originalItem, name_ar: "", name: "Banana S" };
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet')");
    check("missing Arabic name shows dash without substituting English", await evaluate("[...document.querySelector('.opp-item-cell').children].map(e=>e.textContent.trim())"), ["—", "Banana S"]);
    product.item = { ...originalItem, name: "اسم عربي في الحقل الإنجليزي" };
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet')");
    check("Arabic-filled English field is not displayed as an English name", await evaluate("document.querySelector('.opp-item-cell small').textContent"), "—");
    product.item = null;
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet')");
    check("missing item does not substitute category names", await evaluate("document.querySelector('.opp-item-cell').textContent"), "——");
    product.item = originalItem;
    const originalPlanned = first.final_quantity_kg;
    first.final_quantity_kg = "0.00";
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-sheet')");
    check("zero planned quantity does not fall back to requested quantity", await evaluate("document.querySelector('.opp-spec-row').cells[10].textContent.trim()"), "0 kg");
    first.final_quantity_kg = originalPlanned;
    noLines = true;
    await navigate("/orders/7/print");
    await wait("!!document.querySelector('.opp-no-rows')");
    check("empty order is explicit, not invented production rows", await evaluate("document.querySelectorAll('.opp-spec-row').length"), 0);
    check("empty order has one zero total", await evaluate("document.querySelector('.opp-total-cell').textContent.trim()"), "0 كجم");
    noLines = false;
    large = true;
    await navigate("/orders/7/print");
    await wait("document.querySelectorAll('.opp-spec-row').length===38");
    await checkSignatures("Arabic multipage preview");
    await checkPrintSignatures("Arabic multipage");
    await pdf("order-print-a4-multipage");
    check("large orders render all linked production lines", await evaluate("document.querySelectorAll('.opp-spec-row').length"), 38);
    check("large order planned total includes every line and groups thousands", await evaluate("document.querySelector('.opp-total-cell').textContent.trim()"), "12,540 كجم");
    language = "en";
    await navigate("/orders/7/print");
    await wait("document.querySelectorAll('.opp-spec-row').length===38&&document.documentElement.lang==='en'");
    await checkSignatures("English multipage preview");
    await checkPrintSignatures("English multipage");
    check("English multipage quantities and item names remain correct", await evaluate(`({
      total:document.querySelector('.opp-total-cell').textContent.trim(),
      rows:[...document.querySelectorAll('.opp-spec-row')].every(r=>r.cells[10].textContent.trim()==='330 kg'),
      items:[...document.querySelectorAll('.opp-item-cell')].every(e=>e.textContent==='بنانة - SBanana S')
    })`), { total: "12,540 kg", rows: true, items: true });
    await pdf("order-print-a4-multipage-en");
    // Include empty/small orders and row counts near page boundaries in both directions.
    for (const selectedLanguage of ["ar", "en"]) {
      language = selectedLanguage;
      for (const count of [0, 1, 5, 6, 7, 8, 9, 12, 20, 37, 39]) {
        largeRowCount = count;
        await navigate("/orders/7/print");
        await wait(`document.querySelectorAll('.opp-spec-row').length===${count}&&!!document.querySelector('.opp-sheet')&&document.documentElement.lang==='${language}'`);
        await checkPrintSignatures(`${language} ${count} rows`);
        await pdf(`order-print-a4-${count}-rows-${language}`);
      }
    }
    }
    large = false;
    noLines = false;
    const originalColor = product.color;
    const originalBatch = product.master_batch_id;
    const stripeCheck = async (context, selector) => check(context, await evaluate(`(()=>{
      const swatch=document.querySelector(${JSON.stringify(selector)});
      const pattern=swatch?.querySelector('pattern');
      return !!swatch&&swatch.dataset.transparent==='true'
        &&pattern?.querySelector('rect')?.getAttribute('fill')==='#ffffff'
        &&pattern?.querySelector('path')?.getAttribute('stroke')==='#000000'
        &&swatch.querySelector('circle')?.getAttribute('fill')==='url(#'+pattern.id+')';
    })()`));
    product.color = palette[0];
    product.master_batch_id = "PT02";
    for (const selectedLanguage of ["ar", "en"]) {
      language = selectedLanguage;
      permissions = ["view_orders"];
      await navigate("/orders/7/print");
      await wait(`!!document.querySelector('.opp-sheet')&&document.documentElement.lang==='${language}'`);
      await stripeCheck(`${language}: order printing has white circle with black SVG stripes`, ".opp-color-swatch");
      check(`${language}: all four header labels remain visible, including literal-colon date labels`, await evaluate(
        "[...document.querySelectorAll('.opp-order-id b')].length===4&&[...document.querySelectorAll('.opp-order-id b')].every(e=>e.textContent.trim().length>0)"
      ));
      check(`${language}: centered Arabic/English factory names remain unchanged`, await evaluate(
        "[...document.querySelectorAll('.opp-brand-names h1,.opp-brand-names p')].map(e=>e.textContent)"
      ), ["مصنع أكياس البلاستيك الحديث", "Modern Plastic Bags Factory"]);
      if (language === "ar") {
        await capture("order-print-striped-header");
        await pdf("order-print-transparent-no-background", false);
      }
      await navigate("/orders?viewOrder=7");
      await wait("!!document.querySelector('.odm-production-toggle')");
      await click(".odm-production-toggle");
      await stripeCheck(`${language}: order-details sample uses the same striped circle`, ".odm-color-chip");
    }
    product.color = originalColor;
    product.master_batch_id = originalBatch;
    language = "ar";
    permissions = ["manage_customers"];
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await navigate("/customers?tab=products");
    await wait("!!document.querySelector('.color-stack .master-batch-swatch')");
    await stripeCheck("product list uses the shared striped swatch", ".color-stack .master-batch-swatch[data-transparent=true]");
    check("solid white product remains a plain white circle", await evaluate(
      "!!document.querySelector('.color-stack .master-batch-swatch[data-transparent=false] circle[fill=\"#ffffff\"]')&&!document.querySelector('.color-stack .master-batch-swatch[data-transparent=false] pattern')"
    ));
    await click('[aria-label="تعديل منتج"]');
    await wait("!!document.querySelector('#cp-master-batch')");
    await stripeCheck("selected customer-product color uses black stripes", "#cp-master-batch .master-batch-swatch");
    await click("#cp-master-batch");
    await wait("!!document.querySelector('.cp-color-menu')");
    await stripeCheck("color chooser options use black stripes", ".cp-color-menu .master-batch-swatch[data-transparent=true]");
    check("mobile color selector does not overflow the page", await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
    await capture("transparent-color-selector-390");
    await navigate("/customers/CID010");
    await wait("!!document.querySelector('.color-stack .master-batch-swatch')");
    await stripeCheck("customer profile also uses the shared striped swatch", ".color-stack .master-batch-swatch[data-transparent=true]");
    permissions = ["manage_master_batch"];
    await navigate("/admin");
    await wait("!!document.querySelector('.color-cell .master-batch-swatch')");
    await stripeCheck("color definitions use black stripes", ".color-cell .master-batch-swatch[data-transparent=true]");
    await click('[aria-label="تعديل لون"]');
    await wait("!!document.querySelector('.color-preview.master-batch-swatch')");
    await stripeCheck("color-definition edit preview uses black stripes", ".color-preview.master-batch-swatch");
    check("all currently rendered pattern IDs are unique", await evaluate("(()=>{const ids=[...document.querySelectorAll('.master-batch-swatch pattern')].map(e=>e.id);return new Set(ids).size===ids.length})()"));
    permissions = ["manage_customers"];
    const priorDetails = requests.filter((r) => r.route.endsWith("/details")).length;
    await navigate("/orders/7/print");
    await wait("document.body?.textContent?.includes('لا تملك صلاحية عرض أو طباعة الطلب')");
    check("unauthorized preview never requests private order details", requests.filter((r) => r.route.endsWith("/details")).length, priorDetails);
    check("no mutations or users directory requests", requests.every((r) => r.method === "GET" && !["/users", "/roles"].includes(r.route)));
    check("no browser exceptions", errors, []);
    console.log(`Order actions passed ${passed} browser checks; PDFs and screenshots saved using fixtures only.`);
  } finally {
    if (ws) ws.close();
    await new Promise((resolve) => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("close", resolve); chrome.kill("SIGKILL");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });