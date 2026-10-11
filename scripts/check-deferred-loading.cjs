// Test the actual production chunks with a fixture-only HTTP server.
// No account credentials, application database access, or real business writes.
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const XLSX = require("xlsx");
const { collectInitialAssets, assertLoginAssets } = require("./lib/initial-load-budget.cjs");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "deferred-loading-"));
  const root = path.resolve("dist/public");
  const initialAssets = collectInitialAssets(root);
  const initialCss = (await Promise.all(initialAssets.filter(file => file.endsWith(".css"))
    .map(file => fs.readFile(path.join(root, file), "utf8")))).join("\n");
  assert.ok(!initialCss.includes(".order-status--new"), "Order table feature CSS must not enter the initial bundle");
  let language = "ar", signedIn = false, permissions = ["admin"], failChunk = false;
  let productionBinding, roleName = "Administrator";
  const filmRole = { id: 891, name: "Night team", name_ar: "فريق الليل",
    permissions: ["view_production", "view_film_dashboard"],
    production_role_binding: { mode: "operator", stages: ["film"] } };
  const assets = [], apiRequests = [], errors = [];
  const employee = { id: 42, username: "fixture", display_name: "Fixture Employee",
    display_name_ar: "موظف تجريبي", section_id: "S1", section_name: "Fixture Section" };
  const customer = { id: "CID010", name: "Fixture Customer", name_ar: "عميل تجريبي", phone: null, plate_drawer_code: null };
  const order = { id: 7, order_number: "ORD123", customer_id: customer.id, status: "waiting",
    notes: "", created_at: "2026-10-02T06:00:00Z", delivery_date: "2026-10-18", delivery_days: 16 };
  const product = { id: 11, customer_id: customer.id, category_id: "CAT01", item_id: "ITM01",
    size_caption: "40 × 50", width: "40", left_facing: null, right_facing: null,
    cutting_length_cm: 50, universal_thickness: "25", raw_material: "HDPE", printing_cylinder: "100",
    punching: null, is_printed: false, front_print_colors: [], back_print_colors: [], notes: "",
    cliche_front_design: null, cliche_back_design: null, color: null,
    item: { name: "Fixture Item", name_ar: "صنف تجريبي" } };
  const publicPath = `/shared/orders/7/print?key=${"F".repeat(43)}`;
  const details = { order, customer, creator: null, sales_representative: null,
    production_orders: [{ id: 8, quantity_kg: "100.00", final_quantity_kg: "105.00", product }],
    totals: { requested_kg: "100.00", planned_kg: "105.00", production_order_count: 1, by_status: {} },
    actual_production: { available: false, message: "" }, public_print_path: publicPath };
  const state = { orders: [], rolls: [], machines: [], queues: [], locations: [], inventory: [], movements: [], receipts: [] };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture.test");
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
        assert.equal(request.method, "GET", "No business writes permitted in this fixture");
        let data = [], status = 200;
        if (url.pathname === "/api/me") {
          status = signedIn ? 200 : 401;
          data = signedIn ? { user: { ...employee, preferred_language: language, permissions,
            role_name: roleName, production_role_binding: productionBinding } } : { message: "Sign in required" };
        } else if (url.pathname === "/api/public-branding") data = { companyNameAr: "مصنع تجريبي", companyNameEn: "Fixture Factory", defaultLanguage: language };
        else if (url.pathname === "/api/dashboard") data = {};
        else if (url.pathname === "/api/roles") data = [filmRole];
        else if (url.pathname === "/api/hr/data") data = { shifts: [], users: [employee], history: [] };
        else if (url.pathname === "/api/hr/attendance-summary") data = { rows: [{ ...employee, workedMinutes: 480,
          daysWorked: 1, absentDays: 2, overtimeMinutes: 30, incompleteDays: 3 }] };
        else if (url.pathname === "/api/hr/self-service-admin") data = { requests: [], users: [employee] };
        else if (url.pathname === "/api/production/state") data = state;
        else if (url.pathname.startsWith("/api/production/history/")) data = {
          records: url.pathname.endsWith("/inventory") ? [{
            id: 1, production_order_number: "PO-FIXTURE", quantity_kg: "100",
            location_name: "Fixture Location", location_name_ar: "موقع تجريبي", product,
            unit_balances: [{ id: 1, unit: "carton", method: "unit_weight", unit_quantity: "20",
              unit_weight_kg: "5", quantity_kg: "100" }],
          }] : [], next: null,
        };
        else if (url.pathname === "/api/customers") data = [customer];
        else if (url.pathname === "/api/customer-products") data = [product];
        else if (url.pathname === "/api/orders") data = [{ ...order, production_orders_summary: [] }];
        else if (url.pathname === "/api/orders/7/details" || url.pathname === "/api/public/orders/7/print") data = details;
        else if (url.pathname === "/api/orders/7/print-link") data = { path: publicPath };
        else if (url.pathname === "/api/self/attendance") data = {
          events: [], status: "out", month: "2026-10", daysPresent: 0, activeShift: null,
          withinShiftWindow: false, serverNow: "2026-10-09T06:00:00Z",
          workedSeconds: 0, sessionStartedAt: null, actionTimes: {},
        };
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(data));
        return;
      }
      const file = url.pathname.startsWith("/assets/") ? path.join(root, url.pathname) : path.join(root, "index.html");
      assert.ok(file.startsWith(root + path.sep));
      if (url.pathname.startsWith("/assets/")) {
        assets.push(url.pathname);
        if (failChunk && /HumanResources-.*\.js$/.test(url.pathname)) {
          response.writeHead(503); response.end("Fixture chunk failure"); return;
        }
        // Make the loading state observable on first navigation.
        if (/HumanResources-.*\.js$/.test(url.pathname)) await new Promise(resolve => setTimeout(resolve, 350));
      }
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(await fs.readFile(file));
    } catch (error) {
      errors.push(error.message);
      response.writeHead(500); response.end("Fixture failure");
    }
  });
  let chrome, ws, session, serial = 0, checks = 0;
  const pending = new Map();
  const check = (name, actual, expected = true) => {
    assert.deepEqual(actual, expected, name); console.log(`PASS ${name}`); checks++;
  };
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}/profile`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 20000);
      chrome.stderr.on("data", chunk => {
        output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const entry = pending.get(event.id);
        if (entry) { pending.delete(event.id); event.error ? entry.reject(Error(event.error.message)) : entry.resolve(event.result); }
      } else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, null);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, null)).sessionId;
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: temp }, null);
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async (expression, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const open = async route => { assets.length = 0; await send("Page.navigate", { url: origin + route }); };
    const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const deferred = /(?:HumanResources|UserDashboard|ProductionPage|OrderPrintPage|OrderCreateModal|CustomerProductModal|CustomerModal|ProductionOrderModal|OrderDetailsModal|OrderWorkspaceControls|xlsx|jspdf|html2canvas)[-.]/;
    const download = async extension => {
      for (let attempt = 0; attempt < 400; attempt++) {
        const file = (await fs.readdir(temp)).find(name => name.endsWith(extension) && !name.endsWith("-order.pdf"));
        if (file) return path.join(temp, file);
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw Error(`Missing ${extension} download`);
    };
    for (const lang of ["ar", "en"]) {
      language = lang; signedIn = false;
      await open("/"); await wait("!!document.querySelector('.login-box input')");
      // Observe idle time too: a late prefetch must not escape the login check.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const loginAssets = assertLoginAssets(root, assets, initialAssets);
      console.log(`${lang} login network: ${loginAssets.join(", ")}`);
      check(`${lang} login network matches budgeted initial assets`, loginAssets.length, initialAssets.length);
      check(`${lang} login has no page, modal, Excel or PDF chunks`, assets.filter(value => deferred.test(value)), []);
      check(`${lang} document direction`, await evaluate("document.documentElement.dir"), lang === "ar" ? "rtl" : "ltr");
      signedIn = true;
      await open("/customers"); await wait("!!document.querySelector('a[href=\"/hr\"]')");
      await click('a[href="/hr"]');
      await wait("!!document.querySelector('[role=\"status\"][aria-busy=\"true\"]')");
      check(`${lang} translated loading state`, await evaluate("document.querySelector('[role=\"status\"]').textContent"), lang === "ar" ? "جارٍ التحميل…" : "Loading…");
      await wait("!!document.querySelector('.hr-tabs')");
      check(`${lang} HR chunk requested on navigation`, assets.some(value => /HumanResources-.*\.js/.test(value)));
      await click('.hr-tabs button:nth-child(3)'); await wait("document.querySelectorAll('.hr-report-sheet tbody tr').length===1");
      check(`${lang} report does not preload export engines`, assets.filter(value => /(?:xlsx|jspdf|html2canvas)/.test(value)), []);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Excel').click()");
      const excel = await download(".xlsx");
      const workbook = XLSX.readFile(excel);
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      check(`${lang} Excel has all seven columns`, rows[0].length, 7);
      check(`${lang} Excel names and attendance values`, rows[1], [
        "موظف تجريبي\nFixture Employee", "Fixture Section", lang === "ar" ? "8 س 00 د" : "8 h 00 min", 1, 2, 3, lang === "ar" ? "0 س 30 د" : "0 h 30 min",
      ]);
      check(`${lang} Excel headers localized`, rows[0][0], lang === "ar" ? "اسم المستخدم" : "Username");
      await fs.unlink(excel);
      check(`${lang} Excel engine now requested`, assets.some(value => /xlsx-/.test(value)));
      check(`${lang} Excel does not load PDF engines`, assets.some(value => /(?:jspdf|html2canvas)/.test(value)), false);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='PDF').click()");
      const pdf = await download(".pdf");
      check(`${lang} PDF download valid`, (await fs.readFile(pdf)).subarray(0, 5).toString(), "%PDF-");
      const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
      check(`${lang} PDF uses landscape A4`, /841\.89 x 595\.28/.test(info));
      await fs.unlink(pdf);
      check(`${lang} PDF engines requested`, ["jspdf", "html2canvas"].every(name => assets.some(value => value.includes(name))));
      // Replace only the browser popup during testing, not application code.
      await evaluate(`window.printFixture=null;window.open=()=>{let html="";return{
        document:{write:s=>html+=s,close:()=>window.printFixture=html},focus:()=>{},print:()=>window.fixturePrinted=true}}`);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===" + JSON.stringify(lang === "ar" ? "طباعة الكل" : "Print all") + ").click()");
      await wait("!!window.printFixture && !!window.fixturePrinted");
      check(`${lang} attendance print contains employee and direction`, await evaluate(`window.printFixture.includes("Fixture Employee") && window.printFixture.includes('dir="${lang === "ar" ? "rtl" : "ltr"}"')`));
      await click('a[href="/orders"]'); await wait("!!document.querySelector('.order-workspace')");
      check(`${lang} orders navigation loads controls on demand`, assets.some(value => /OrderWorkspaceControls-.*\.js/.test(value)));
      await wait("!!document.querySelector('table .order-status--new')");
      check(`${lang} order CSS requested on navigation`, assets.some(value => /OrderWorkspaceControls-.*\.css/.test(value)));
      check(`${lang} order status retains its color`, await evaluate("getComputedStyle(document.querySelector('table .order-status--new')).backgroundColor"), "rgb(225, 242, 232)");
      check(`${lang} order table retains separate rows`, await evaluate("getComputedStyle(document.querySelector('table:has(.order-number-column)')).borderSpacing"), "0px 8px");
      permissions = ["view_orders"];
      await open("/orders"); await wait("!!document.querySelector('table .order-status--new')");
      check(`${lang} fresh read-only order list loads feature CSS`, await evaluate("getComputedStyle(document.querySelector('table .order-row-tools')).display"), "grid");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      check(`${lang} mobile order cards remain visible`, await evaluate("getComputedStyle(document.querySelector('.mobile-cards')).display"), "grid");
      check(`${lang} mobile status retains sizing`, await evaluate("getComputedStyle(document.querySelector('.mobile-cards .order-status')).minHeight"), "28px");
      check(`${lang} mobile order rows retain two action lines`, await evaluate("getComputedStyle(document.querySelector('.mobile-cards .order-row-tools')).gridTemplateRows.split(' ').length"), 2);
      await send("Emulation.clearDeviceMetricsOverride");
      permissions = ["admin"];
      await open("/planning"); await wait("!!document.querySelector('.planning-page .prod-grid')");
      check(`${lang} planning layout and navigation render`, await evaluate("getComputedStyle(document.querySelector('.planning-header')).display === 'flex' && !!document.querySelector('.planning-nav a[aria-current=\"page\"]')"));
      await click('a[href="/warehouse"]'); await wait("!!document.querySelector('.warehouse-hall-section')");
      check(`${lang} warehouse hall navigation renders`, await evaluate("!!document.querySelector('.prod-view-nav a[aria-current=\"page\"]')"));
      await click('.prod-view-nav a[href="/warehouse/finished-inventory"]');
      await wait("!!document.querySelector('.warehouse-inventory-card')");
      check(`${lang} finished inventory loads its cards and styles`, await evaluate("getComputedStyle(document.querySelector('.warehouse-inventory-card')).display !== 'inline' && document.querySelector('.warehouse-inventory-card').textContent.includes('PO-FIXTURE')"));
      check(`${lang} stock unit quantities remain visible`, await evaluate("document.querySelector('.warehouse-balance-spec strong').textContent.includes('20')"));
      check(`${lang} planning and warehouse show no loading error`, await evaluate("document.querySelectorAll('.prod-error').length"), 0);
      await open("/production/film"); await wait("!!document.querySelector('.production-app')");
      check(`${lang} production page chunk loads`, assets.some(value => /ProductionPage-.*\.js/.test(value)));
      await open("/orders/7/print"); await wait("!!document.querySelector('.opp-sheet')");
      check(`${lang} private print chunk loads`, assets.some(value => /OrderPrintPage-.*\.js/.test(value)));
      await evaluate("window.print=()=>window.printCalled=true");
      await click(".opp-print-action"); await wait("window.printCalled===true");
      const printed = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const printedFile = path.join(temp, `${lang}-order.pdf`);
      await fs.writeFile(printedFile, Buffer.from(printed.data, "base64"));
      const text = execFileSync("pdftotext", ["-layout", printedFile, "-"], { encoding: "utf8" });
      check(`${lang} printed order preserves identifier and planned quantity`, text.includes("ORD123") && text.includes("105"));
      signedIn = false;
      const beforePublic = apiRequests.length;
      await open(publicPath); await wait("!!document.querySelector('.opp-sheet')");
      check(`${lang} public print does not request authentication`, apiRequests.slice(beforePublic).includes("/api/me"), false);
      check(`${lang} public print requests only its scoped endpoint`, apiRequests.slice(beforePublic).includes("/api/public/orders/7/print"));
      signedIn = true; permissions = ["view_orders"];
      await open("/orders/7/print"); await wait("!!document.querySelector('.opp-sheet')");
      check(`${lang} read-only user can still print`, await evaluate("!!document.querySelector('.opp-print-action')"));
      permissions = [];
      await open("/orders/7/print"); await wait("!!document.querySelector('[role=\"alert\"]')");
      check(`${lang} forbidden print never loads print chunk`, assets.some(value => /OrderPrintPage-.*\.js/.test(value)), false);
      permissions = ["admin"];
      await open("/my-dashboard"); await wait("!!document.querySelector('.self-page') && !document.querySelector('.self-alert-error')");
      check(`${lang} personal dashboard loads on demand`, assets.some(value => /UserDashboard-.*\.js/.test(value)));
      await open("/customers"); await wait("!!document.querySelector('.page-heading .btn-primary')");
      check(`${lang} customer editor not loaded by list`, assets.some(value => /CustomerModal-.*\.js/.test(value)), false);
      await click(".page-heading .btn-primary"); await wait("!!document.querySelector('.customer-modal')");
      check(`${lang} customer editor loaded by create action`, assets.some(value => /CustomerModal-.*\.js/.test(value)));
      await open("/admin"); await wait("!!document.querySelector('#admin-tab-roles')");
      await click("#admin-tab-roles"); await wait("!!document.querySelector('.role-card button')");
      await click(".role-card button"); await wait("!!document.querySelector('#production-role-mode')");
      check(`${lang} renamed role editor retains operator binding`, await evaluate("document.querySelector('#production-role-mode').value"), "operator");
      check(`${lang} role editor shows selected stages without adding write grants`,
        await evaluate("[...document.querySelectorAll('fieldset input')].map(input=>input.checked)"), [true, false, false]);
      check(`${lang} role binding fieldset is translated`,
        await evaluate("document.querySelector('fieldset legend').textContent"), lang === "ar" ? "تخصيص لوحة الإنتاج للدور" : "Role production navigation");
      check(`${lang} role binding stage labels are translated`,
        await evaluate("[...document.querySelectorAll('fieldset .permission span')].map(span=>span.textContent)"),
        lang === "ar" ? ["الفيلم", "الطباعة", "القص"] : ["Film", "Printing", "Cutting"]);
      await click("fieldset .permission:nth-child(3) input");
      check(`${lang} editor supports multiple stages`, await evaluate("[...document.querySelectorAll('fieldset input')].map(input=>input.checked)"), [true, false, true]);
      await click(".role-modal footer button[type=button]");
      check(`${lang} cancelling never changes stored role binding`, filmRole.production_role_binding.stages, ["film"]);
      permissions = [...filmRole.permissions]; productionBinding = filmRole.production_role_binding; roleName = filmRole.name;
      await open("/production"); await wait("!!document.querySelector('.prod-view-nav')");
      check(`${lang} renamed operator lands on Film`, await evaluate("location.pathname"), "/production/film");
      check(`${lang} renamed operator has only Film tab`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(a=>a.getAttribute('href'))"), ["/production/film"]);
      permissions = ["view_production"];
      const beforeRevocation = apiRequests.length;
      await open("/production/film"); await wait("!!document.querySelector('.production-app .prod-empty')");
      check(`${lang} revocation removes every production tab`, await evaluate("document.querySelectorAll('.prod-view-nav a').length"), 0);
      check(`${lang} revoked Film route never requests production data`, apiRequests.slice(beforeRevocation).includes("/api/production/state"), false);
      permissions = ["admin"]; productionBinding = undefined; roleName = "Administrator";
    }
    check("No unexpected browser or fixture errors", errors, []);
    // A fresh document clears the React.lazy cache so failure/retry is real.
    language = "en"; signedIn = true; failChunk = true;
    await open("/hr"); await wait("!!document.querySelector('[role=\"alert\"] button')");
    check("Failed chunk shows translated retry instead of blank screen", await evaluate("document.querySelector('[role=\"alert\"] button').textContent"), "Try again");
    failChunk = false;
    await click('[role="alert"] button'); await wait("!!document.querySelector('.hr-tabs')");
    check("Retry reloads the failed chunk successfully", await evaluate("!!document.querySelector('.hr-tabs')"));
    console.log(`Verified ${checks} production-build checks. Temporary files: ${temp}`);
  } finally {
    if (ws) ws.close();
    if (chrome) chrome.kill("SIGKILL");
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
