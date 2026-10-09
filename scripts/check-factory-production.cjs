// Browser-only fixtures intercept EVERY API request. No real auth or business writes.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const jsLiteral = value => JSON.stringify(value).replace(/[<>&/\u2028\u2029]/g, char => ({
  "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "/": "\\u002f", "\u2028": "\\u2028", "\u2029": "\\u2029",
})[char]);
const QRCode = require("qrcode");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "factory-browser-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws, session, onLoad, serial = 0, language = "en", permissions = ["admin"], failure = false, failWrite = false, historyFailure = false, passed = 0;
  const filmReadyOnly = process.argv.includes("--film-ready-only");
   const operatorLayoutOnly = process.argv.includes("--operator-layout-only");
  const operatorNavigationOnly = process.argv.includes("--operator-navigation-only");
  const compactControlsOnly = process.argv.includes("--compact-controls-only");
  const warehouseNavigationOnly = process.argv.includes("--warehouse-navigation-only");
  let roleMetadata = {};
  let failStart = false;
  const pending = new Map(), errors = [], writes = [], committed = new Map(), historyCalls = [], stateScopes = [];
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); console.log(`PASS ${name}`); passed++; };
  const product = { id: 1, item_id: "ITM01", name: "Plastic bag", name_ar: "كيس بلاستيك", customer_name: "Fixture customer", customer_name_ar: "عميل الاختبار",
     width: "28", left_facing: "7", right_facing: "7", universal_thickness: "25", cutting_length_cm: 41, raw_material: "HDPE", printing_cylinder: '16"', punching: "بنانة", notes: null, front_print_colors: ["Red"], back_print_colors: [],
     size_caption:"28 + 7 + 7 cm",plate_drawer_code:"D-12",master_batch:{id:"BLUE",name:"Blue",name_ar:"أزرق",color_hex:"#2463EB"} };
  const duration = (machine_id = "F1", changes = {}) => ({
    machine_id, machine_name: machine_id === "F1" ? "Film One" : "Film Two",
    machine_name_ar: machine_id === "F1" ? "فيلم واحد" : "فيلم اثنان",
    roll_count: 2, first_roll_at: "2026-10-01T20:59:59Z", last_roll_at: "2026-10-03T02:00:02Z",
    duration_seconds: 104403, ...changes,
  });
  const order = (id, changes = {}) => ({ id, order_id: id, order_number: `ORDER-${id}`, production_order_number: `PO-${id}`, customer_product_id: 1,
    quantity_kg: "100.00", final_quantity_kg: "110.00", status: "active", order_status: "in_production", batch_number: null, product,
    started_at: "2026-10-03T05:00:00Z", film_closed_at: null, completed_at: null, is_printed: true, is_roll_product: false, stage: "film",
    produced_kg: "10.00", ready_kg: "0.00", received_kg: "0.00", remaining_kg: "0.00", waste_kg: "0.00", roll_count: id === 2 ? 3 : 1,
    film_durations: id === 1 || id === 6 ? [] : id === 2 ? [duration(), duration("F2", {roll_count:1,duration_seconds:null,
      first_roll_at:"2026-10-02T12:00:00Z",last_roll_at:"2026-10-02T12:00:00Z"})] :
      id === 3 ? [duration("F1", {duration_seconds:0,last_roll_at:"2026-10-01T20:59:59Z"})] : [duration()],
    ...changes });
  const roll = (id, po, changes = {}) => ({ id, production_order_id: po, production_order_number: `PO-${po}`, roll_number: `PO-${po}-R001`, weight_kg: "10.00",
    stage: "film", film_machine_id: "F1", created_by: 42, created_actor:{id:42,display_name:"Creator Person",display_name_ar:"منشئ الرول",full_name:"Creator Full Name",username:"creator"}, created_at: "2026-10-03T05:30:00Z", production_minutes: 10, is_last_roll: false,
    printing_machine_id: null, printed_by: null, printed_at: null, cutting_machine_id: null, cut_by: null, cut_completed_at: null, net_weight_kg: null,
    waste_kg: "0.00", product, is_printed: true, is_roll_product: false, ...changes });
  const state = { orders: [order(1, { status: "pending", started_at: null }), order(2), order(3, { is_printed: false }),
    order(4, { is_printed: false, is_roll_product: true, ready_kg: "10.00", remaining_kg: "7.00", received_kg: "3.00" }),
    order(5, { is_roll_product: true }), order(6, { started_at: null, status: "completed", order_status: "completed" }), order(7, { order_status: "paused" }),
    order(8,{order_id:2,order_number:"ORDER-2",final_quantity_kg:"110.49",produced_kg:"10.51",
      product:{...product,size_caption:"28.5 + 7.25 + 7.25 cm",universal_thickness:"25.6",
        master_batch:{id:"TRANS",name:"Transparent",name_ar:"شفاف",color_hex:"#FFFFFF"}}}),
    order(9,{order_id:2,order_number:"ORDER-2",produced_kg:"120.00",
      product:{...product,name:"Special plastic bag with a long product name for a busy factory operator",
        name_ar:"كيس بلاستيك خاص باسم صنف طويل وواضح لعامل الإنتاج في المصنع",
        master_batch:{id:"WHITE",name:"White",name_ar:"أبيض",color_hex:"#FFFFFF"}}})],
    rolls: [roll(2, 2), roll(3, 3, { is_printed: false }), roll(4, 4, { is_printed: false, is_roll_product: true, stage: "done" }),
      roll(5, 5, { is_roll_product: true }), roll(7, 7)], machines: [
      { id: "F1", name: "Film One", name_ar: "فيلم واحد", type: "extruder", status: "active", inline_printer_id: "P1" },
      { id: "F2", name: "Film Two", name_ar: "فيلم اثنان", type: "extruder", status: "active", inline_printer_id: null },
      { id: "P1", name: "Printer One", name_ar: "طابعة", type: "Printer", status: "active" },
      { id: "C1", name: "Cutter One", name_ar: "قصاصة", type: "cutting", status: "active" }],
    queues: [{ id: 1, production_order_id: 2, stage: "film", machine_id: "F1", position: 1 }, { id: 2, production_order_id: 3, stage: "film", machine_id: "F1", position: 2 }],
    locations: [{ id: 1, name: "Hall A", name_ar: "الموقع أ", is_active: true }], receipts: [{
      id: 1, voucher_number: "FR-00000001", created_at: "2026-10-03T06:00:00Z", created_by: 42, notes: "Fixture receipt", items: [
        { id: 1, production_order_id: 4, production_order_number: "PO-4", customer_product_id: 1, item_id: "ITM01", location_id: 1, quantity_kg: "1.00", packaging: null },
        { id: 2, production_order_id: 2, production_order_number: "PO-2", customer_product_id: 1, item_id: "ITM01", location_id: 1, quantity_kg: "2.00", packaging: null }] }],
    inventory: [{ id: 1, production_order_id: 4, customer_product_id: 1, item_id: "ITM01", location_id: 1, quantity_kg: "3.00",
      production_order_number: "PO-4", batch_number: null, product, location_name: "Hall A", location_name_ar: "الموقع أ" }],
    movements: [{ id: 1, receipt_id: 1, receipt_item_id: 1, quantity_kg: "3.00", created_at: "2026-10-03T06:00:00Z", voucher_number: "FR-00000001", production_order_id: 4, location_id: 1 }] };
  // Independent downstream work arrives while film remains in progress.
  state.rolls.push(roll(8,8,{weight_kg:"12.34",product:state.orders.find(order=>order.id===8).product}),
    roll(9,9,{stage:"printing",printed_at:"2026-10-03T06:00:00Z",product:state.orders.find(order=>order.id===9).product}),
    roll(12,2,{weight_kg:"0.26",roll_number:"PO-2-R002"}));
  if (operatorLayoutOnly) state.rolls.push(roll(13,3,{is_printed:false,roll_number:"PO-3-R002"}));
  const archives = {
    orders: [...state.orders, ...Array.from({length:121}, (_, index) => order(index+100, { status:"completed", order_status:"completed",
      completed_at:"2026-10-03T06:00:00Z",film_closed_at:"2026-10-03T06:00:00Z",roll_count:121,ready_kg:"1000",received_kg:"999",remaining_kg:"1" }))],
    rolls: [...state.rolls,...Array.from({length:121},(_,index)=>roll(index+100,2,{roll_number:`HISTORY-R-${index+100}`,stage:"done"}))],
    receipts: [...state.receipts,...Array.from({length:121},(_,index)=>({...state.receipts[0],id:index+100,voucher_number:`HISTORY-V-${index+100}`}))],
    inventory: state.inventory, movements: state.movements.map(item=>({...item,production_order_number:"PO-4"})),
  };
  state.totals={orders:archives.orders.length,rolls:archives.rolls.length,receipts:archives.receipts.length,movements:archives.movements.length,inventory:state.inventory.length,inventory_kg:"3.00"};
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.stderr.on("data", chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) { const p = pending.get(event.id); if (p) { pending.delete(event.id); event.error ? p.reject(Error(JSON.stringify(event.error))) : p.resolve(event.result); } }
      else if (event.method === "Page.loadEventFired") onLoad?.();
      else if (event.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true });
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      else if (event.method === "Fetch.requestPaused") void (async () => {
        const { request, requestId } = event.params;
        const route = new URL(request.url).pathname.replace(/^\/api/, "");
        let body = [], status = 200;
        if (route === "/me") body = { user: { id: 42, username: "fixture", display_name: "Fixture user", display_name_ar: "مستخدم الاختبار", permissions, preferred_language: language, ...roleMetadata } };
        else if (route === "/public-branding") body = { companyNameEn: "MPBF Factory", companyNameAr: "مصنع MPBF", logoSrc: null };
        else if (request.method !== "GET") {
          const input = JSON.parse(request.postData || "{}");
          writes.push({ route, input });
          const previous = committed.get(input.request_id);
          if (previous) {
            assert.deepEqual(input, previous.input, "idempotent replay must preserve its payload");
            body = previous.body;
          } else {
            if (filmReadyOnly && /^\/production\/orders\/\d+\/start$/.test(route)) {
              if (failStart) {
                failStart=false; status=409;
                body={message:"تغيرت حالة الطلب؛ حدّث البيانات.",message_en:"Order state changed. Refresh and retry."};
              } else {
                const target=state.orders.find(order=>order.id===Number(route.split("/")[3]));
                target.started_at="2026-10-05T09:00:00Z";target.status="active";target.order_status="in_production";target.stage="film";
              }
            }
            if (route === "/production/queues/reorder") {
              const first = state.queues.find(q=>q.id===input.first_id), second = state.queues.find(q=>q.id===input.second_id);
              if (!first || !second || first.position!==input.first_position || second.position!==input.second_position) {
                status=409;body={message:"تغير ترتيب الطابور",message_en:"Queue positions changed."};
              } else [first.position,second.position]=[second.position,first.position];
            }
            if(status===200){
              body={id:99+committed.size,voucher_number:"FR-00000099",items:input.items||[]};
              committed.set(input.request_id,{route,input:structuredClone(input),body});
            }
          }
          if(failWrite&&status===200){
            failWrite=false;
            // The save has committed, but the response is lost in transit.
            await send("Fetch.failRequest",{requestId,errorReason:"ConnectionClosed"},event.sessionId);
            return;
          }
         } else if (route === "/production/labels") {
           body = {records:state.rolls,next:null};
         } else if (route === "/production/state") {
          const scope=new URL(request.url).searchParams.get("scope");
          stateScopes.push(scope);
          if (failure) { status = 500; body = { message: "خطأ تحميل تجريبي", message_en: "Fixture loading failure" }; }
           else body = {...state,receipts:[],inventory:[],movements:[],rolls:scope==="film"?state.rolls:state.rolls.filter(roll=>roll.stage!=="done"),
            orders:scope==="warehouse"?[]:scope==="hall"?state.orders.filter(order=>Number(order.remaining_kg)>0):state.orders.filter(order=>order.id!==6)};
        } else if (route.startsWith("/production/history/")) {
          const url=new URL(request.url), kind=route.split("/").pop(), params=url.searchParams;
          historyCalls.push({kind,params:Object.fromEntries(params)});
          if(historyFailure){historyFailure=false;status=500;body={message:"تعذر تحميل التاريخ",message_en:"Fixture history failure"};}
          else {
            let records=archives[kind]||[];
            if(params.get("order_id"))records=records.filter(record=>record.production_order_id===Number(params.get("order_id")));
            if(params.get("before"))records=records.filter(record=>record.id<Number(params.get("before")));
            if(params.get("status"))records=records.filter(record=>(kind==="rolls"?record.stage:record.status)===params.get("status"));
            if(params.get("search"))records=records.filter(record=>JSON.stringify(record).toLowerCase().includes(params.get("search").toLowerCase()));
            records=[...records].sort((a,b)=>b.id-a.id);
            const limit=Number(params.get("limit")||50), more=records.length>limit;
            records=records.slice(0,limit);body={records,next:more?records.at(-1).id:null};
          }
        } else if (/\/production\/rolls\/\d+\/qr$/.test(route)) {
          const rollId = route.split("/").at(-2);
          const url = new URL(`/production/rolls/${rollId}`, request.url).href;
          body = { url, image: await QRCode.toDataURL(url) };
        } else if (/\/production\/rolls\/\d+$/.test(route)) {
          const record = state.rolls.find(r => r.id === Number(route.split("/").pop()));
          body = {...record,film_duration:state.orders.find(order=>order.id===record.production_order_id)
            .film_durations.find(group=>group.machine_id===record.film_machine_id),
            created_actor:{id:42,display_name:"Creator Person",display_name_ar:"منشئ الرول",full_name:"Creator Full Name",username:"creator"},
            printed_actor:record.id===2?{id:43,display_name:"Printer Person",display_name_ar:"عامل الطباعة",full_name:"Printer Full Name",username:"printer"}:null,
            cut_actor:record.id===2?{id:44,display_name:"Cutter Person",display_name_ar:"عامل القص",full_name:"Cutter Full Name",username:"cutter"}:null,
            ...(record.id===2?{stage:"done",printed_by:43,cut_by:44,printed_at:"2026-10-03T06:10:11Z",
              cut_completed_at:"2026-10-03T06:30:31Z",net_weight_kg:"9.00"}:{})};
        }
        await send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") }, event.sessionId);
      })().catch(error => errors.push(error.message));
    });
    const target = (await send("Target.createTarget", { url: "about:blank" }, null)).targetId;
    session = (await send("Target.attachToTarget", { targetId: target, flatten: true }, null)).sessionId;
    for (const method of ["Page.enable", "Runtime.enable"]) await send(method);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error(`Timed out: ${expression}`); };
    const origin = process.env.FACTORY_BROWSER_ORIGIN || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
    const navigate = async route => {
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Navigation timeout ${route}`)), 15000);
        onLoad = () => { clearTimeout(timer); resolve(); onLoad = undefined; };
      });
      await send("Page.navigate", { url: origin + route }); await loaded;
      await wait("!!document.querySelector('.production-app')");
      await wait("!document.querySelector('.prod-loading')");
       if (operatorNavigationOnly || warehouseNavigationOnly) return;
       if(["/production/film","/production/printing","/production/cutting"].includes(route)){
         check(`${language} ${route}: all orders initially collapsed`,await evaluate("document.querySelectorAll('[data-film-order-id][aria-expanded=\"true\"],[data-operator-order-id][aria-expanded=\"true\"]').length"),0);
       }
      if(route==="/production/film")await openFilmOrder(filmReadyOnly?1:2);
      if(route==="/production/printing")await openStageOrder(2);
      if(route==="/production/cutting")await openStageOrder(3);
       if(!filmReadyOnly && ["/production/film","/production/printing","/production/cutting"].includes(route)){
         check(`${language} ${route}: rolls show creator name`,await evaluate(`(()=>{const nodes=[...document.querySelectorAll('[data-roll-author]')];return nodes.length>0&&nodes.every(node=>node.innerText.includes(${jsLiteral(language==="en"?"Creator Person":"منشئ الرول")}))})()`));
         check(`${language} ${route}: roll dates omit time`,await evaluate("[...document.querySelectorAll('[data-roll-date]')].every(node=>!/\\d{1,2}:\\d{2}/.test(node.innerText))"));
       }
    };
    const clickText = label => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${jsLiteral(label)}); if(!e)throw Error('Missing button '+${jsLiteral(label)});e.click()})()`);
    const setInput = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${jsLiteral(selector)}); if(!e)throw Error('Missing input'); const setter=Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${jsLiteral(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const openFilmOrder = async id => {
      await evaluate(`(()=>{const b=document.querySelector('[data-film-order-id="${id}"]');if(!b)throw Error('Missing group ${id}');if(b.getAttribute('aria-expanded')!=='true')b.click()})()`);
      await wait(`document.querySelector('[data-film-order-id="${id}"]').getAttribute('aria-expanded')==='true'`);
    };
    const openStageOrder = async id => {
      await evaluate(`(()=>{const button=document.querySelector('[data-operator-order-id="${id}"]');if(!button)throw Error('Missing operator group ${id}');if(button.getAttribute('aria-expanded')!=='true')button.click()})()`);
      await wait(`document.querySelector('[data-operator-order-id="${id}"]').getAttribute('aria-expanded')==='true'`);
    };
     if (warehouseNavigationOnly) {
       for (const lang of ["ar", "en"]) {
         language = lang;
         for (const width of [390, 768, 1440]) {
           await send("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 500 });
           roleMetadata = {};
           permissions = ["admin"];
           await navigate("/production");
           check(`${lang} ${width}: production contains manufacturing tabs only`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"),
             ["/production", "/production/film", "/production/printing", "/production/cutting"]);
           check(`${lang} ${width}: warehouse is a separate sidebar entry`, await evaluate("document.querySelector('.sidebar .nav a[href=\"/warehouse\"]').innerText"), lang === "ar" ? "المستودع" : "Warehouse");
           for (const [oldPath, newPath] of [["/production/hall", "/warehouse/hall"], ["/production/warehouse", "/warehouse/finished-inventory"]]) {
             await navigate(oldPath);
             check(`${lang} ${width}: ${oldPath} keeps existing bookmarks working`, await evaluate("location.pathname"), newPath);
             check(`${lang} ${width}: warehouse module has two tabs`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), ["/warehouse/hall", "/warehouse/finished-inventory"]);
             check(`${lang} ${width}: warehouse title is localized`, await evaluate("document.querySelector('.prod-heading h2').innerText"), lang === "ar" ? "المستودع" : "Warehouse");
             check(`${lang} ${width}: main title and selected section match warehouse`, await evaluate("document.querySelector('.topbar h1').innerText"), lang === "ar" ? "المستودع" : "Warehouse");
             check(`${lang} ${width}: current warehouse remains in mobile navigation`, await evaluate("!!document.querySelector('.mobile-nav a[href=\"/warehouse\"].active')"));
             check(`${lang} ${width}: production shortcut does not appear inside warehouse`, await evaluate("!document.querySelector('.prod-heading a[href=\"/production\"]')"));
             check(`${lang} ${width}: viewport does not overflow`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
           }
           for (const [grants, path, expected] of [
             [["view_production_hall"], "/warehouse/hall", ["/warehouse/hall"]],
             [["receive_production"], "/warehouse/hall", ["/warehouse/hall", "/warehouse/finished-inventory"]],
             [["view_finished_inventory"], "/warehouse/finished-inventory", ["/warehouse/finished-inventory"]],
             [["manage_finished_warehouse"], "/warehouse/finished-inventory", ["/warehouse/finished-inventory"]],
           ]) {
             permissions = grants;
             await navigate("/warehouse");
             check(`${lang} ${width} ${grants}: correct authorized landing page`, await evaluate("location.pathname"), path);
             check(`${lang} ${width} ${grants}: exact warehouse tabs`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), expected);
             check(`${lang} ${width} ${grants}: no manufacturing entry`, await evaluate("!document.querySelector('.sidebar .nav a[href=\"/production\"]')"));
           }
           permissions = ["view_finished_inventory"];
           await navigate("/production/rolls/2");
           check(`${lang} ${width}: old private QR remains usable by inventory reader`, await evaluate("location.pathname"), "/warehouse/rolls/2");
           await wait("!!document.querySelector('.prod-qr img')");
           check(`${lang} ${width}: roll details can return to inventory`, await evaluate("!!document.querySelector('.prod-heading a[href=\"/warehouse/finished-inventory\"]')"));
           await navigate("/warehouse/hall");
           check(`${lang} ${width}: inventory read does not authorize hall`, await evaluate("document.querySelectorAll('.prod-card').length"), 0);
           for (const stage of ["film", "printing", "cutting"]) {
             permissions = [`operate_${stage}`, "view_production"];
             roleMetadata = { production_role_binding: { mode: "operator", stages: [stage] } };
             await navigate(`/production/${stage}`);
             check(`${lang} ${width}: ${stage} retains one stage tab`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), [`/production/${stage}`]);
             check(`${lang} ${width}: ${stage} does not gain warehouse entry`, await evaluate("!document.querySelector('.sidebar .nav a[href=\"/warehouse\"]')"));
             const before = stateScopes.length;
             await navigate("/warehouse/hall");
             check(`${lang} ${width}: ${stage} cannot read warehouse data`, stateScopes.length, before);
             check(`${lang} ${width}: ${stage} has no warehouse content`, await evaluate("document.querySelectorAll('.prod-card').length"), 0);
           }
           permissions = ["admin"]; roleMetadata = {};
           await navigate("/warehouse/finished-inventory");
           if (lang === "ar" && [390, 1440].includes(width)) {
             const image = await send("Page.captureScreenshot", { format: "png" });
             await fs.writeFile(`/tmp/warehouse-module-${width}.png`, Buffer.from(image.data, "base64"));
           }
         }
       }
       check("warehouse relocation has no browser exceptions", errors, []);
       check("warehouse relocation does not write business data", writes, []);
       console.log(`Verified ${passed} warehouse module navigation assertions with isolated API fixtures.`);
       return;
     }
     if (compactControlsOnly) {
       await navigate("/production/film");
       for (const lang of ["ar", "en"]) {
         language = lang;
         for (const width of [320, 390, 430, 768, 1440]) {
           await send("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width < 500 });
           for (const stage of ["film", "printing", "cutting"]) {
             permissions = stage === "film"
               ? ["view_home", "view_user_dashboard", "view_film_dashboard", "view_mixing", "view_production", "operate_film"]
               : ["view_home", "view_user_dashboard", `view_${stage}_dashboard`, `operate_${stage}`];
             roleMetadata = { role_name: stage === "film" ? "Extruder Operator" : stage === "printing" ? "Printing Operator" : "Cutting Operator" };
             const label = `${lang} ${width} ${stage}`;
             await evaluate(`localStorage.removeItem('mpbf-production-machine:42:${stage}')`);
             await navigate(`/production/${stage}`);
             await wait("!!document.querySelector('[data-production-machine-slot] .prod-chip')");
             check(`${label}: one refresh in header`, await evaluate("document.querySelectorAll('[data-production-header-refresh]').length"), 1);
             check(`${label}: refresh is beside title`, await evaluate("(()=>{const a=document.querySelector('.prod-heading h2').getBoundingClientRect(),b=document.querySelector('[data-production-header-refresh]').getBoundingClientRect();return Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0})()"));
             check(`${label}: one top machine control`, await evaluate("document.querySelectorAll('[data-production-machine-slot] .prod-inline').length"), 1);
             check(`${label}: machine card removed`, await evaluate("![...document.querySelectorAll('.prod-card h3')].some(node=>node.innerText==='Machine'||node.innerText==='الماكينة')"));
             check(`${label}: machine choice is above tabs/orders`, await evaluate("document.querySelector('[data-production-machine-slot]').getBoundingClientRect().bottom<=document.querySelector('.prod-view-nav').getBoundingClientRect().top+1"));
             check(`${label}: top controls fit viewport`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
             check(`${label}: touch controls are usable`, await evaluate("[...document.querySelectorAll('.prod-heading button')].every(node=>node.getBoundingClientRect().height>=43.99)"));
             check(`${label}: actual operator is not read-only`, await evaluate("!document.querySelector('.production-app').innerText.includes('Read-only')&&!document.querySelector('.production-app').innerText.includes('عرض فقط')"));
             check(`${label}: operator still has only one tab`, await evaluate("document.querySelectorAll('.prod-view-nav a').length"), 1);
             if (stage === "film") {
               await setInput('[data-production-order-id="2"] .film-weight-field input', "12.5");
               check(`${label}: roll recording is enabled`, await evaluate("!document.querySelector('[data-production-order-id=\"2\"] .film-roll-entry button').disabled"));
             }
             const before = stateScopes.length;
             await evaluate("document.querySelector('[data-production-header-refresh]').click()");
             for (let attempt = 0; attempt < 100 && stateScopes.length === before; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
             await wait("!document.querySelector('[data-production-header-refresh]').disabled");
             check(`${label}: refresh requests fresh stage data`, stateScopes.length, before + 1);
             if (stage === "film") check(`${label}: refreshing preserves draft weight`, await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-weight-field input').value"), "12.5");
             await evaluate("document.querySelector('[data-production-machine-slot] button').click()");
             await wait(`!!document.querySelector('#machine-${stage}')`);
             check(`${label}: only one editable machine select`, await evaluate(`document.querySelectorAll('#machine-${stage}').length`), 1);
             check(`${label}: machine editor also fits viewport`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
             const selection = stage === "film" ? "F2" : stage === "printing" ? "P1" : "C1";
             await setInput(`#machine-${stage}`, selection);
             await wait(`!document.querySelector('#machine-${stage}')`);
             check(`${label}: selection saves immediately`, await evaluate(`localStorage.getItem('mpbf-production-machine:42:${stage}')`), selection);
             check(`${label}: change remains available at top`, await evaluate("!!document.querySelector('[data-production-machine-slot] button')"));
             await navigate(`/production/${stage}`);
             await wait("!!document.querySelector('[data-production-machine-slot] .prod-chip')");
             check(`${label}: selected machine persists after reload`, await evaluate("document.querySelector('[data-production-machine-slot] .prod-chip').innerText.includes(" + jsLiteral(selection) + ")"));
             if (lang === "ar" && [390, 1440].includes(width) && stage === "film") {
               const image = await send("Page.captureScreenshot", { format: "png" });
               await fs.writeFile(`/tmp/production-compact-${width}.png`, Buffer.from(image.data, "base64"));
             }
           }
         }
       }
       check("compact controls never write actual business data", writes, []);
       check("compact controls have no runtime exceptions", errors, []);
       console.log(`Verified ${passed} compact-control browser assertions with isolated API fixtures.`);
       return;
     }
     if (operatorNavigationOnly) {
       for (const lang of ["ar", "en"]) {
         language = lang;
         for (const width of [390, 768, 1440]) {
           await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
           for (const fixture of [
             { stage: "film", role_name: "Extruder Operator", role_name_ar: "مشغل فيلم", permissions: ["view_home", "view_user_dashboard", "view_film_dashboard", "view_mixing", "view_production", "operate_film"] },
             { stage: "printing", role_name: "Printing Operator", role_name_ar: "مشغل طباعة", permissions: ["view_home", "view_user_dashboard", "view_printing_dashboard", "operate_printing"] },
             { stage: "cutting", role_name: "Cutting Operator", role_name_ar: "مشغل تقطيع", permissions: ["view_home", "view_user_dashboard", "view_cutting_dashboard", "operate_cutting"] },
           ]) {
             roleMetadata = { role_name: fixture.role_name, role_name_ar: fixture.role_name_ar };
             permissions = fixture.permissions;
             const label = `${lang} ${width} actual ${fixture.stage} role`;
             await navigate("/production");
             check(`${label}: opens the actual role's board`, await evaluate("location.pathname"), `/production/${fixture.stage}`);
             check(`${label}: one matching tab only`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), [`/production/${fixture.stage}`]);
             check(`${label}: production entry is visible in sidebar`, await evaluate("!!document.querySelector('.sidebar a[href=\"/production\"]')"));
             check(`${label}: has no management shortcut`, await evaluate("document.querySelectorAll('.prod-actions a').length"), 0);
             check(`${label}: page fits viewport`, await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
             for (const forbidden of ["film", "printing", "cutting"].filter(stage => stage !== fixture.stage)) {
               const before = stateScopes.length;
               await navigate(`/production/${forbidden}`);
               check(`${label}: direct ${forbidden} is denied`, await evaluate(`document.querySelector('.production-app').innerText.includes(${jsLiteral(lang === "ar" ? "لا تتوفر صلاحية لهذا العرض." : "You do not have permission to view this page.")})`));
               check(`${label}: denied page fetches no production data`, stateScopes.length, before);
             }
           }
           roleMetadata = { role_name: "Sales Representative", role_name_ar: "مندوب مبيعات" };
           permissions = ["view_production", "view_film_dashboard"];
           await navigate("/production");
           check(`${lang} ${width}: Sales read grants are not misclassified as an operator`, await evaluate("document.querySelectorAll('.prod-view-nav a').length"), 4);
           roleMetadata = {};
           for (const stage of ["film", "printing", "cutting"]) {
             permissions = [`operate_${stage}`, "view_production", "view_production_hall", "receive_production", "view_finished_inventory"];
             const label = `${lang} ${width} ${stage}`;
             await navigate("/production");
             await wait(`location.pathname === '/production/${stage}'`);
             check(`${label}: opens own board automatically`, await evaluate("location.pathname"), `/production/${stage}`);
             check(`${label}: own stage is the only tab`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), [`/production/${stage}`]);
             check(`${label}: no general management shortcut`, await evaluate("document.querySelectorAll('.prod-actions a').length"), 0);
             check(`${label}: current tab is selected`, await evaluate("document.querySelector('.prod-view-nav a').getAttribute('aria-current')"), "page");
             check(`${label}: navigation fits viewport`, await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
             for (const forbidden of ["film", "printing", "cutting"].filter(view => view !== stage)) {
               const before = stateScopes.length;
               await navigate(`/production/${forbidden}`);
               check(`${label}: direct ${forbidden} board is denied`, await evaluate(`document.querySelector('.production-app').innerText.includes(${jsLiteral(lang === "ar" ? "لا تتوفر صلاحية لهذا العرض." : "You do not have permission to view this page.")})`));
               check(`${label}: denied ${forbidden} does not load production data`, stateScopes.length, before);
               check(`${label}: denied ${forbidden} has no operator controls`, await evaluate("!document.querySelector('.film-operator-orders,.roll-operator-orders,.prod-order-group')"));
             }
             await navigate("/warehouse");
             check(`${label}: explicit receiving grants remain in the separate warehouse`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), ["/warehouse/hall", "/warehouse/finished-inventory"]);
           }
           permissions = ["view_production", "operate_printing", "operate_cutting"];
           await navigate("/production");
           check(`${lang} ${width}: multi-stage operator sees exactly granted stages`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"), ["/production/printing", "/production/cutting"]);
           for (const grants of [["admin", "operate_film"], ["manage_production", "operate_film"], ["view_production"]]) {
             permissions = grants;
             await navigate("/production");
             check(`${lang} ${width}: management navigation unchanged for ${grants}`, await evaluate("[...document.querySelectorAll('.prod-view-nav a')].map(link=>link.getAttribute('href'))"),
               ["/production", "/production/film", "/production/printing", "/production/cutting"]);
           }
         }
       }
       check("navigation never writes business data", writes, []);
       check("navigation has no runtime errors", errors, []);
       console.log(`Verified ${passed} operator-navigation assertions with isolated API fixtures.`);
       return;
     }
     if (process.argv.includes("--labels-disclosure-only")) {
       const before = writes.length;
       for (const lang of ["ar","en"]) {
         language=lang;
         for (const width of [390,768,1440]) {
           await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<500});
           for (const route of ["/production","/production/film","/production/printing","/production/cutting"]) {
             await navigate(route);
             await wait("!!document.querySelector('.roll-label-option')");
             check(`${lang} ${width} ${route}: labels initially collapsed`,await evaluate("!document.querySelector('details.roll-label-controls').open"));
             check(`${lang} ${width} ${route}: only compact header occupies space`,await evaluate("(()=>{const box=document.querySelector('.roll-label-controls');return box.getBoundingClientRect().height<=box.querySelector('summary').getBoundingClientRect().height+3})()"));
             await evaluate("document.querySelector('.roll-label-controls > summary').click()");
             check(`${lang} ${width} ${route}: header expands controls`,await evaluate("document.querySelector('.roll-label-controls').open"));
             await evaluate("document.querySelector('.roll-label-option input').click()");
             await setInput(".roll-label-search input","ROLL-DRAFT");
             await evaluate("document.querySelector('.roll-label-controls > summary').click()");
             check(`${lang} ${width} ${route}: header collapses controls`,await evaluate("!document.querySelector('.roll-label-controls').open"));
             await send("Page.bringToFront");
             await evaluate("document.querySelector('.roll-label-controls > summary').focus()");
             await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13});
             await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
             check(`${lang} ${width} ${route}: keyboard expands controls`,await evaluate("document.querySelector('.roll-label-controls').open"));
             check(`${lang} ${width} ${route}: selection and search survive collapse`,await evaluate("document.querySelector('.roll-label-option input').checked&&document.querySelector('.roll-label-search input').value==='ROLL-DRAFT'"));
             check(`${lang} ${width} ${route}: fits viewport`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
           }
         }
       }
       check("label disclosure browsing never writes business data",writes.length,before);
       check("no label disclosure runtime errors",errors,[]);
       console.log(`Verified ${passed} label disclosure browser checks with isolated API fixtures.`);
       return;
     }
     if (filmReadyOnly) {
      const ready = state.orders[0];
      const reset = () => Object.assign(ready, {status:"pending",order_status:"for_production",previous_status:null,
        batch_number:null,started_at:null,film_closed_at:null,completed_at:null,stage:null,produced_kg:"0.00",roll_count:0});
      state.orders.push(order(80,{status:"pending",started_at:null,previous_status:"active"}),
        order(81,{status:"pending",started_at:null,batch_number:"OLD"}),
        order(82,{status:"pending",started_at:null,order_status:"paused"}),
        order(83,{status:"pending",started_at:null,final_quantity_kg:"0.00"}));
      for (const lang of ["ar","en"]) {
        language=lang; permissions=["operate_film"];
        for(const width of [390,768,1440]) {
          reset();
          await send("Emulation.setDeviceMetricsOverride",{width,height:950,deviceScaleFactor:1,mobile:width<500});
          const before=writes.length;
          await navigate("/production/film");
          await wait("!!document.querySelector('[data-film-state=\"ready\"] .prod-start-film')");
          check(`${lang} ${width}: ready order visible without starting`,writes.length,before);
          check(`${lang} ${width}: ready plan stays pending`,[ready.status,ready.order_status,ready.started_at],["pending","for_production",null]);
          check(`${lang} ${width}: readiness label localized`,await evaluate("document.querySelector('[data-film-state=\"ready\"]').textContent.includes("+jsLiteral(lang==="ar"?"جاهز":"Ready")+")"));
          check(`${lang} ${width}: exactly one eligible ready card`,await evaluate("document.querySelectorAll('[data-film-state=\"ready\"]').length"),1);
          check(`${lang} ${width}: no execution controls before start`,await evaluate("!document.querySelector('[data-film-state=\"ready\"] input')&&!document.querySelector('#weight-1')"));
          check(`${lang} ${width}: fits phone/tablet/desktop`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
          if(lang==="ar"&&width===390){
            const shot=await send("Page.captureScreenshot",{format:"png"});
            await fs.writeFile(path.join(profile,"film-ready-mobile.png"),Buffer.from(shot.data,"base64"));
            failStart=true;
            await evaluate("document.querySelector('.prod-start-film').click()");
            await wait("!!document.querySelector('[role=\"alert\"]')");
            check("failed start keeps plan ready",ready.started_at,null);
            check("failed start has no weight controls",await evaluate("!document.querySelector('#weight-1')"));
          }
          const startBefore=writes.length;
          await evaluate("(()=>{const b=document.querySelector('.prod-start-film');b.click();b.click()})()");
          await wait("!document.querySelector('[data-film-state=\"ready\"]')&&!!document.querySelector('#weight-1')");
          check(`${lang} ${width}: double click sends one start`,writes.length,startBefore+1);
          check(`${lang} ${width}: start is scoped to child order`,writes.at(-1).route,"/production/orders/1/start");
          check(`${lang} ${width}: start sends only request identity`,Object.keys(writes.at(-1).input),["request_id"]);
          check(`${lang} ${width}: started order becomes active`,ready.status,"active");
        }
        reset(); permissions=["view_production"];
        await navigate("/production/film");
        await wait("!!document.querySelector('[data-film-state=\"ready\"]')");
        check(`${lang}: readonly users see ready orders without start button`,await evaluate("!document.querySelector('.prod-start-film')"));
      }
      check("no film ready browser runtime errors",errors,[]);
      console.log(`Verified ${passed} film-ready browser checks; fixture writes only.`);
      return;
    }
    if (!process.argv.includes("--operations-only")) for (const lang of ["ar", "en"]) {
      language = lang;
      for (const width of [320, 390, 430, 768, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
         for (const route of (operatorLayoutOnly ? ["/production/film", "/production/printing", "/production/cutting"] : ["/production", "/production/film", "/production/printing", "/production/cutting", "/production/hall", "/production/warehouse", "/production/rolls/2", "/production/rolls/3"])) {
          permissions=route==="/production/film"?["operate_film"]:route==="/production/printing"?["operate_printing"]:route==="/production/cutting"?["operate_cutting"]:["admin"];
          await navigate(route);
          check(`${lang} ${width} ${route} fits viewport`, await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
          check(`${lang} ${width} ${route} renders content`, await evaluate("document.querySelector('.production-app').innerText.length > 50"));
          if(route==="/production/film"){
            check(`${lang} ${width} one customer group open`,await evaluate("document.querySelectorAll('[data-film-order-id][aria-expanded=\"true\"]').length"),1);
            check(`${lang} ${width} related production orders grouped`,await evaluate("document.querySelector('#film-order-panel-2').querySelectorAll('[data-production-order-id]').length"),3);
            check(`${lang} ${width} one header per customer order`,await evaluate("document.querySelectorAll('[data-film-order-id=\"2\"]').length"),1);
             check(`${lang} ${width} film rolls nested under their production order`,await evaluate("[...document.querySelectorAll('.film-recorded-roll')].every(node=>Number(node.closest('[data-production-order-id]').dataset.productionOrderId)===({2:2,12:2,8:8,9:9})[Number(node.dataset.productionRollId)])&&document.querySelector('[data-production-order-id=\"2\"] .film-recorded-rolls').children.length===2"));
             check(`${lang} ${width} film rolls wrap side by side`,await evaluate("(()=>{const nodes=document.querySelector('[data-production-order-id=\"2\"] .film-recorded-rolls').children;const a=nodes[0].getBoundingClientRect(),b=nodes[1].getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.left-b.left)>1})()"),width>360);
             check(`${lang} ${width} film roll links trace their own roll`,await evaluate("[...document.querySelectorAll('.film-recorded-roll')].every(node=>node.querySelector('a').getAttribute('href')==='/production/rolls/'+node.dataset.productionRollId)"));
             await openFilmOrder(4);
             check(`${lang} ${width} film lists downstream completed rolls while order stays open`,await evaluate("!!document.querySelector('[data-production-order-id=\"4\"] [data-production-roll-id=\"4\"]')"));
             await openFilmOrder(2);
             check(`${lang} ${width} film size has no width or gusset labels`,await evaluate("![...document.querySelectorAll('.film-spec-grid')].some(node=>/العرض|الكسرة|Width|Gusset/.test(node.innerText))"));
            check(`${lang} ${width} no film status chips`,await evaluate("document.querySelectorAll('.film-operator .prod-chips,.film-operator .prod-chip').length"),0);
            check(`${lang} ${width} four clear operating specs`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-spec-grid').children.length"),4);
            check(`${lang} ${width} specification values centered across full tile`,await evaluate("[...document.querySelectorAll('.film-spec > strong')].every(node=>{const tile=node.parentElement.getBoundingClientRect(),value=node.getBoundingClientRect();return getComputedStyle(node).textAlign==='center'&&Math.abs((value.left+value.right)/2-(tile.left+tile.right)/2)<=1.5})"));
            check(`${lang} ${width} color swatch does not overlap centered value`,await evaluate("[...document.querySelectorAll('.film-color-spec')].every(tile=>{const swatch=tile.querySelector('.master-batch-swatch'),value=tile.querySelector('strong');return !swatch||swatch.getBoundingClientRect().bottom<=value.getBoundingClientRect().top+1})"));
            check(`${lang} ${width} quantity and actual remaining labels`,await evaluate(`(()=>{const labels=[...document.querySelectorAll('[data-production-order-id="2"] .film-order-metrics span')].map(node=>node.innerText);return labels[0]===${jsLiteral(lang==="en"?"Quantity":"الكمية")}&&labels[1]===${jsLiteral(lang==="en"?"Remaining":"المتبقي")}})()`));
            check(`${lang} ${width} remaining is planned minus produced`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-order-metrics > div:nth-child(2) strong').innerText"),"100 kg");
            check(`${lang} ${width} compute before rounding, preserve decimal data`,await evaluate("document.querySelector('[data-production-order-id=\"8\"] .film-order-metrics > div:nth-child(2) strong').innerText"),"100 kg");
            check(`${lang} ${width} overproduction never shows negative remaining`,await evaluate("document.querySelector('[data-production-order-id=\"9\"] .film-order-metrics > div:nth-child(2) strong').innerText"),"0 kg");
            check(`${lang} ${width} operating specs round to whole numbers`,await evaluate("document.querySelector('[data-production-order-id=\"8\"] .film-spec-grid').innerText.includes('29 + 7 + 7 cm')&&document.querySelector('[data-production-order-id=\"8\"] .film-spec-grid').innerText.includes('26 µm')"));
            check(`${lang} ${width} all numeric metrics have no decimal fractions`,await evaluate("[...document.querySelectorAll('.film-order-metrics strong')].every(node=>!/[.٫][0-9٠-٩]/.test(node.innerText))"));
            check(`${lang} ${width} final roll label is concise`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-last-roll').innerText"),lang==="en"?"Final roll":"آخر رول");
            check(`${lang} ${width} roll weight label localized`,await evaluate("document.querySelector('label[for=\"weight-2\"]').innerText"),lang==="en"?"Roll weight (kg)":"وزن الرول (كجم)");
            check(`${lang} ${width} product name larger and emphasized`,await evaluate("[...document.querySelectorAll('.film-order-identity p')].every(node=>parseFloat(getComputedStyle(node).fontSize)>=16&&Number(getComputedStyle(node).fontWeight)>=600)"));
            check(`${lang} ${width} saved decimal quantities unchanged`,[state.orders.find(order=>order.id===8).final_quantity_kg,state.orders.find(order=>order.id===8).produced_kg],["110.49","10.51"]);
            check(`${lang} ${width} real size material and micron thickness`,await evaluate("['28 + 7 + 7 cm','HDPE','25 µm'].every(value=>document.querySelector('[data-production-order-id=\"2\"] .film-spec-grid').innerText.includes(value))"));
            check(`${lang} ${width} film color not printing ink`,await evaluate(`document.querySelector('[data-production-order-id="2"] .film-color-spec').innerText.includes(${jsLiteral(lang==="en"?"Blue":"أزرق")})`));
            check(`${lang} ${width} transparent color striped`,await evaluate("document.querySelector('[data-production-order-id=\"8\"] .master-batch-swatch').dataset.transparent"),"true");
            check(`${lang} ${width} ordinary white remains solid`,await evaluate("document.querySelector('[data-production-order-id=\"9\"] .master-batch-swatch').dataset.transparent"),"false");
            const targets=await evaluate("[...document.querySelectorAll('.film-operator button,.film-operator input:not([type=\"checkbox\"]),.film-operator .prod-label-inline')].map(node=>({id:node.id,kind:node.className,height:node.getBoundingClientRect().height,min:getComputedStyle(node).minHeight}))");
            if(targets.some(node=>node.height<43.5))console.log("Small touch targets",JSON.stringify(targets.filter(node=>node.height<43.5)));
            check(`${lang} ${width} touch targets at least 44px`,targets.every(node=>node.height>=43.5));
            check(`${lang} ${width} accessible disclosure controls`,await evaluate("[...document.querySelectorAll('[data-film-order-id]')].every(node=>!!document.getElementById(node.getAttribute('aria-controls')))"));
            check(`${lang} ${width} duplicate close-film button absent`,await evaluate("![...document.querySelectorAll('button')].some(button=>/Close film with existing rolls|إغلاق الفيلم باستخدام الرولات المسجلة/.test(button.textContent))"));
            check(`${lang} ${width} final-roll checkbox remains`,await evaluate("!!document.querySelector('.film-last-roll input[type=\"checkbox\"]')"));
            check(`${lang} ${width} manual duration input removed`,await evaluate("document.querySelectorAll('input[id^=\"minutes-\"]').length"),0);
            check(`${lang} ${width} film duration summary hidden on operator board`,await evaluate("document.querySelectorAll('.prod-film-duration').length"),0);
            check(`${lang} ${width} film duration endpoints hidden on operator board`,await evaluate("document.querySelectorAll('.prod-film-duration-times time').length"),0);
            check(`${lang} ${width} duration remains in records`,state.orders.find(order=>order.id===2).film_durations.length,2);
            for (const [weight, automaticLast] of [["99.99", false], ["100.00", true], ["125.00", true], ["2.75", false]]) {
              await evaluate(`(()=>{const node=document.getElementById('weight-2');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(weight)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
              await new Promise(resolve=>setTimeout(resolve,60));
              check(`${lang} ${width} weight ${weight} final-roll state`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-last-roll input').checked"),automaticLast);
              check(`${lang} ${width} weight ${weight} final-roll control`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-last-roll input').disabled"),automaticLast);
              check(`${lang} ${width} film weight has no planned maximum`,await evaluate("document.getElementById('weight-2').hasAttribute('max')"),false);
            }
            if([320,390,430].includes(width)){
              await evaluate("window.scrollTo(0,document.querySelector('.film-order-groups').getBoundingClientRect().top+scrollY-80)");
              await new Promise(resolve=>setTimeout(resolve,220));
              const shot=await send("Page.captureScreenshot",{format:"png"});
              await fs.writeFile(path.join(profile,`film-ops-${lang}-${width}.png`),Buffer.from(shot.data,"base64"));
            }
            await setInput("#weight-2","2.75");
            await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-last-roll input').click()");
            await openFilmOrder(3);
            check(`${lang} ${width} opening another group closes previous`,await evaluate("document.querySelector('[data-film-order-id=\"2\"]').getAttribute('aria-expanded')"),"false");
            await openFilmOrder(2);
            check(`${lang} ${width} disclosure retains weight draft`,await evaluate("document.querySelector('#weight-2').value"),"2.75");
            check(`${lang} ${width} disclosure retains final-roll draft`,await evaluate("document.querySelector('[data-production-order-id=\"2\"] .film-last-roll input').checked"));
            await setInput("[data-film-search]",lang==="en"?"PO-8":"PO-٨");
            check(`${lang} ${width} search filters child production orders`,await evaluate("document.querySelectorAll('[data-production-order-id]').length"),1);
            check(`${lang} ${width} matched production order visible`,await evaluate("!!document.querySelector('[data-production-order-id=\"8\"]')"));
            await setInput("[data-film-search]",lang==="en"?"Fixture customer":"عميل الاختبار");
            check(`${lang} ${width} search matches customer names`,await evaluate("document.querySelectorAll('[data-film-order-id]').length"),5);
            await setInput("[data-film-search]","ORDER-3");
            check(`${lang} ${width} customer order search matches one group`,await evaluate("document.querySelectorAll('[data-film-order-id]').length"),1);
            await setInput("[data-film-search]","NO-FILM-MATCH");
            check(`${lang} ${width} search has clear empty result`,await evaluate("!!document.querySelector('.film-no-results')&&!document.querySelector('[data-film-order-id]')"));
            await setInput("[data-film-search]","");await openFilmOrder(2);
            check(`${lang} ${width} searching retains weight and flags`,await evaluate("document.querySelector('#weight-2').value==='2.75'&&document.querySelector('[data-production-order-id=\"2\"] .film-last-roll input').checked"));
          }
          if(route==="/production/printing"||route==="/production/cutting"){
            const stage=route.split("/").pop(), groupId=stage==="printing"?2:3, rollId=stage==="printing"?2:3;
            check(`${lang} ${width} ${stage} one customer group open`,await evaluate("document.querySelectorAll('[data-operator-order-id][aria-expanded=\"true\"]').length"),1);
            check(`${lang} ${width} ${stage} centered stage-specific values`,await evaluate("[...document.querySelectorAll('.roll-operator .film-spec > strong')].every(node=>{const tile=node.parentElement.getBoundingClientRect(),value=node.getBoundingClientRect();return getComputedStyle(node).textAlign==='center'&&Math.abs((value.left+value.right)/2-(tile.left+tile.right)/2)<=1.5})"));
            check(`${lang} ${width} ${stage} prominent product names`,await evaluate("[...document.querySelectorAll('.roll-operator .film-order-identity p')].every(node=>parseFloat(getComputedStyle(node).fontSize)>=16)"));
            check(`${lang} ${width} ${stage} disclosure regions accessible`,await evaluate("[...document.querySelectorAll('[data-operator-order-id]')].every(node=>!!document.getElementById(node.getAttribute('aria-controls')))"));
            check(`${lang} ${width} ${stage} no operator status chips`,await evaluate("document.querySelectorAll('.roll-operator .prod-chips').length"),0);
            check(`${lang} ${width} ${stage} roll traceability retained`,await evaluate(`document.querySelector('[data-production-roll-id="${rollId}"] a').getAttribute('href')`),`/production/rolls/${rollId}`);
            if (operatorLayoutOnly) check(`${lang} ${width} ${stage} rolls wrap side by side`,await evaluate(`(()=>{const nodes=document.querySelector('[data-production-order-id="${stage==="printing"?2:3}"] .roll-operator-rolls').children;const a=nodes[0].getBoundingClientRect(),b=nodes[1].getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.left-b.left)>1})()`),width>360);
            if(stage==="printing"){
              check(`${lang} ${width} printing groups related production orders`,await evaluate("document.querySelectorAll('.roll-operator [data-production-order-id]').length"),2);
              check(`${lang} ${width} printing groups multiple rolls in one production order`,await evaluate("document.querySelector('[data-production-order-id=\"2\"]').querySelectorAll('[data-production-roll-id]').length"),2);
              check(`${lang} ${width} printing has cylinder size drawer and populated face colors only`,await evaluate(`(()=>{const value=document.querySelector('.roll-operator .film-spec-grid').innerText;return value.includes('16')&&!/بوصة|\\bin\\b/.test(value)&&value.includes('28 + 7 + 7 cm')&&value.includes('D-12')&&value.includes(${jsLiteral(lang==="en"?"Red":"أحمر")})&&!value.includes(${jsLiteral(lang==="en"?"Back colors":"ألوان الظهر")})})()`));
              check(`${lang} ${width} printing never asks for cutting net weight`,await evaluate("document.querySelectorAll('.roll-operator input[id^=\"net-\"]').length"),0);
              await openStageOrder(5);
            }else{
              check(`${lang} ${width} cutting shows length punching and material`,await evaluate(`(()=>{const value=document.querySelector('.roll-operator .film-spec-grid').innerText;return value.includes(${jsLiteral(lang==="en"?"41 cm":"41 سم")})&&value.includes(${jsLiteral(lang==="en"?"Banana":"بنانة")})&&value.includes('HDPE')})()`));
              check(`${lang} ${width} cutting precision and authoritative max retained`,await evaluate("(()=>{const input=document.querySelector('#net-3');return [input.min,input.max,input.step,input.inputMode]})()"),["0.01","10.00","0.01","decimal"]);
              await setInput("#net-3","2.75");
              await openStageOrder(2);
            }
            check(`${lang} ${width} ${stage} opening another customer closes previous`,await evaluate(`document.querySelector('[data-operator-order-id="${groupId}"]').getAttribute('aria-expanded')`),"false");
            await openStageOrder(groupId);
            if(stage==="cutting")check(`${lang} ${width} cutting collapse retains decimal weight draft`,await evaluate("document.querySelector('#net-3').value"),"2.75");
            await setInput("[data-operator-search]",stage==="printing"?(lang==="ar"?"PO-٢-R001":"PO-2-R001"):(lang==="ar"?"PO-٣-R001":"PO-3-R001"));
            check(`${lang} ${width} ${stage} roll-number search normalizes Arabic digits`,await evaluate("document.querySelectorAll('.roll-operator [data-production-roll-id]').length"),1);
            await setInput("[data-operator-search]","NO-STAGE-MATCH");
            check(`${lang} ${width} ${stage} search has clear empty state`,await evaluate("!document.querySelector('[data-operator-order-id]')&&document.querySelector('.roll-operator').innerText.length>15"));
            await setInput("[data-operator-search]","");await openStageOrder(groupId);
            if(stage==="cutting")check(`${lang} ${width} cutting search retains draft`,await evaluate("document.querySelector('#net-3').value"),"2.75");
            const stageTargets=await evaluate("[...document.querySelectorAll('.roll-operator button,.roll-operator input')].map(node=>node.getBoundingClientRect().height)");
            check(`${lang} ${width} ${stage} touch targets at least 44px`,stageTargets.every(height=>height>=43.5));
            if([320,390,430].includes(width)){
              await evaluate("window.scrollTo(0,document.querySelector('.roll-operator .film-order-groups').getBoundingClientRect().top+scrollY-80)");
              await new Promise(resolve=>setTimeout(resolve,220));
              const shot=await send("Page.captureScreenshot",{format:"png"});
              await fs.writeFile(path.join(profile,`${stage}-ops-${lang}-${width}.png`),Buffer.from(shot.data,"base64"));
            }
          }
          if(route==="/production/rolls/2"){
            const detailText=await evaluate("document.querySelector('.prod-roll-detail').innerText");
            for(const name of lang==="en"?["Creator Person","Printer Person","Cutter Person"]:["منشئ الرول","عامل الطباعة","عامل القص"]){
              check(`${lang} ${width} recorded actor ${name}`,detailText.includes(name));
            }
            check(`${lang} ${width} all authoritative actor IDs remain`,["#42","#43","#44"].every(id=>detailText.includes(id)));
            check(`${lang} ${width} no receiver tracking`,!(/Received by|استلمها|مستلم الرول/.test(detailText)));
            check(`${lang} ${width} detail uses its order/machine aggregate`,await evaluate(`document.querySelector('.prod-roll-detail .prod-film-duration').innerText.includes(${jsLiteral(lang==="en"?"29 h 3 sec":"29 س 3 ث")})`));
            check(`${lang} ${width} detail does not show old manual minutes`,await evaluate("!document.querySelector('.prod-roll-detail').innerText.includes('Production time (minutes)')&&!document.querySelector('.prod-roll-detail').innerText.includes('مدة الإنتاج (دقيقة)')"));
          }
          if(route==="/production/rolls/3"){
            check(`${lang} ${width} absent stage actors not guessed`,await evaluate(`document.querySelector('.prod-roll-detail').innerText.includes(${jsLiteral(lang==="en"?"Not recorded":"غير مسجل")})`));
          }
          if (lang === "en" && route === "/production" && [390, 1440].includes(width)) {
            const shot = await send("Page.captureScreenshot", { format: "png" });
            await fs.writeFile(path.join(profile,`factory-production-${width}.png`), Buffer.from(shot.data, "base64"));
          }
        }
      }
    }
    language = "en";
    if(operatorLayoutOnly){
      check("no operator layout runtime errors",errors,[]);
      console.log(`Verified ${passed} operator layout browser assertions with isolated API fixtures.`);
      return;
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const stressOffset=state.orders.length;
    state.orders.push(...Array.from({length:180},(_,index)=>order(1000+index,{
      order_id:500+Math.floor(index/3),order_number:`ORDER-${500+Math.floor(index/3)}`,
      product:{...product,customer_name:"A very long customer name with several identifying words",
        customer_name_ar:"اسم عميل طويل متعدد الكلمات لاختبار وضوح العرض على شاشة الهاتف"}
    })),order(94,{order_id:2,order_number:"ORDER-2",status:"pending",started_at:null,stage:null}),
      order(95,{product:{...product,size_caption:null,width:null,left_facing:null,right_facing:null,
        raw_material:null,universal_thickness:null,master_batch:null}}));
    const beforeStressWrites=writes.length;
    for(const lang of ["ar","en"]){
      language=lang;
      await send("Emulation.setDeviceMetricsOverride",{width:320,height:900,deviceScaleFactor:1,mobile:true});
      await navigate("/production/film");
      check(`${lang} many customer orders do not duplicate group headers`,await evaluate("document.querySelectorAll('[data-film-order-id]').length"),66);
      check(`${lang} only one group renders operation cards among many orders`,await evaluate("document.querySelectorAll('[data-production-order-id]').length"),4);
      check(`${lang} ready and active orders share their customer group`,await evaluate("!!document.querySelector('#film-order-panel-2 [data-film-state=\"ready\"][data-production-order-id=\"94\"]')"));
      check(`${lang} long customer names fit a 320px phone`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      await setInput("[data-film-search]","ORDER-559");
      check(`${lang} search does not auto-expand a different customer order`,await evaluate("document.querySelectorAll('[data-film-order-id][aria-expanded=\"true\"]').length"),0);
      await openFilmOrder(559);
      check(`${lang} search reaches last customer order in large list`,await evaluate("document.querySelectorAll('[data-production-order-id]').length"),3);
      await setInput("[data-film-search]","");await openFilmOrder(95);
      check(`${lang} missing operating fields explicit, no invented swatch`,await evaluate(`document.querySelector('[data-production-order-id="95"] .film-spec-grid').innerText.includes(${jsLiteral(lang==="en"?"Unrecorded":"غير مسجل")})&&!document.querySelector('[data-production-order-id="95"] .master-batch-swatch')`));
    }
    check("large-list browsing never writes business data",writes.length,beforeStressWrites);
    state.orders.splice(stressOffset);
    language="en";
    permissions=["view_production"];
    await navigate("/production/film");
    check("read-only film user sees specs but cannot write",await evaluate("!!document.querySelector('.film-spec-grid')&&[...document.querySelectorAll('.film-roll-entry input,.film-roll-entry button')].every(node=>node.disabled)"));
    permissions=["admin"];
    await navigate("/production/film");
    await setInput("#weight-2","6.25");
    const closing=state.orders.filter(order=>order.order_id===2);
    const beforeClosing=closing.map(order=>({...order}));
    closing.forEach(order=>Object.assign(order,{film_closed_at:"2026-10-05T11:00:00Z",status:"completed",order_status:"completed"}));
    await clickText("Refresh data");
    await wait("!document.querySelector('[data-film-order-id=\"2\"]')");
    check("finishing selected group leaves other customer orders collapsed",await evaluate("document.querySelectorAll('[data-film-order-id][aria-expanded=\"true\"]').length"),0);
    closing.forEach((order,index)=>Object.assign(order,beforeClosing[index]));
    await clickText("Refresh data");await wait("!!document.querySelector('[data-film-order-id=\"2\"]')");await openFilmOrder(2);
    check("refresh and temporary eligibility changes retain per-order draft",await evaluate("document.querySelector('#weight-2').value"),"6.25");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate("/production");
    check("historical records explicitly unrecorded", await evaluate("document.body.innerText.includes('Unrecorded')"));
    check("history is not fetched before opening",historyCalls.length,0);
    await evaluate("[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Order history').click()");
    await wait("document.body.innerText.includes('PO-220')");
    check("history first page is limited and includes full-source actuals",await evaluate("document.querySelectorAll('details[open] .prod-record').length===50&&document.body.innerText.includes('1,000 kg')"));
    check("history order review has full-source machine duration",await evaluate("document.querySelector('details[open] .prod-film-duration').innerText.includes('29 h 3 sec')"));
    await clickText("Next");await wait("document.body.innerText.includes('PO-170')");
    check("history sends a keyset cursor",historyCalls.at(-1).params.before,"171");
    await clickText("Previous");await wait("document.body.innerText.includes('PO-220')");
    await setInput("details[open] input:not([type])","PO-100");
    await evaluate("document.querySelector('details[open] form').requestSubmit()");
    await wait("document.body.innerText.includes('PO-100')&&!document.body.innerText.includes('PO-220')");
    check("search resets page cursor",historyCalls.at(-1).params.before===undefined);
    check("search preserves complete summary counts",await evaluate("document.querySelector('.prod-grid .prod-stat strong').textContent"),String(state.totals.orders));
    await setInput("details[open] input:not([type])","");historyFailure=true;
    await evaluate("document.querySelector('details[open] form').requestSubmit()");
    await wait("!!document.querySelector('details[open] .prod-error')");
    await clickText("Retry");await wait("document.body.innerText.includes('PO-220')");
    check("failed history request can be retried",await evaluate("!document.querySelector('details[open] .prod-error')"));
    await navigate("/production");
    await evaluate("document.querySelector('button[aria-label=\"Move down\"]').click()");
    await wait("!!document.querySelector('.prod-success')");
    check("queue reorder single atomic request with UUID", writes.at(-1).route, "/production/queues/reorder");
    check("queue reorder UUID", /^[0-9a-f-]{36}$/.test(writes.at(-1).input.request_id));
    check("queue UI sends current positions, not target positions", [writes.at(-1).input.first_position,writes.at(-1).input.second_position],[1,2]);
    check("queue swap applies both positions",state.queues.map(q=>q.position),[2,1]);
    await navigate("/production/film");
    await clickText("Change machine"); await setInput("#machine-film", "F2");
    check("machine choice immediately saved and picker closes", await evaluate("localStorage.getItem('mpbf-production-machine:42:film')==='F2'&&!document.querySelector('#machine-film')"));
    await setInput("#weight-2", "2.50");
    failWrite = true;
    await evaluate("document.querySelector('#weight-2').closest('article').querySelector('button.prod-btn:not(.quiet)').click()");
    await wait("!!document.querySelector('.prod-error')");
    const failedKey = writes.at(-1).input.request_id;
    check("failure retains entered film weight", await evaluate("document.querySelector('#weight-2').value"), "2.50");
    await clickText("Retry"); await wait("!!document.querySelector('.prod-success')");
    check("write retry preserves operation UUID", writes.at(-1).input.request_id, failedKey);
    check("film recording and retries never submit manual minutes",writes.filter(item=>item.route==="/production/orders/2/rolls").every(item=>!("production_minutes" in item.input)));
    check("successful film recovery clears the submitted draft",await evaluate("document.querySelector('#weight-2').value"),"");
    check("lost film response creates just one roll", [...committed.values()].filter(v=>v.route==="/production/orders/2/rolls").length,1);
    const beforeEmptyFilm=writes.length;
    await evaluate("document.querySelector('#weight-2').closest('article').querySelector('button.prod-btn:not(.quiet)').click()");
    check("empty recovered film draft cannot record a duplicate",writes.length,beforeEmptyFilm);
    await setInput("#weight-2","3.50");failWrite=true;
    await evaluate("document.querySelector('#weight-2').closest('article').querySelector('button.prod-btn:not(.quiet)').click()");
    await wait("!!document.querySelector('.prod-error')");
    await setInput("#weight-2","4.50");await clickText("Retry");await wait("!!document.querySelector('.prod-success')");
    check("recovery preserves a newer edited film draft",await evaluate("document.querySelector('#weight-2').value"),"4.50");
    check("recovery replays original film amount",writes.at(-1).input.weight_kg,"3.50");
    await navigate("/production/printing");
    check("printing excludes paused parent and done rolls", await evaluate("!document.querySelector('.production-app').innerText.includes('PO-7-R001')&&!document.querySelector('.production-app').innerText.includes('PO-4-R001')"));
    await navigate("/production/cutting");
    check("cutting excludes unprinted printed-bag roll and plastic rolls", await evaluate("!document.querySelector('.production-app').innerText.includes('PO-2-R001')&&!document.querySelector('.production-app').innerText.includes('PO-5-R001')"));
    await navigate("/production/rolls/2"); await wait("!!document.querySelector('.prod-qr img')");
    check("QR links to authenticated in-system roll route", await evaluate("document.querySelector('.prod-qr').innerText.includes('/production/rolls/2')"));
    permissions = ["view_production"];
    await navigate("/production");
    check("read-only manager has no mutation buttons", await evaluate("![...document.querySelectorAll('.production-app button')].some(b=>/Start production|Add to queue|Remove/.test(b.textContent))"));
    await navigate("/production/film");
    check("read-only operator cannot register film", await evaluate("![...document.querySelectorAll('.production-app button')].some(b=>b.textContent.trim()==='Register roll'&&!b.disabled)"));
    permissions = ["operate_film"];
    await navigate("/production"); await wait("location.pathname==='/production/film'");
    check("operator-only navigation opens permitted board", await evaluate("location.pathname"), "/production/film");
    permissions = ["view_finished_inventory"];
    await navigate("/production");
    await wait("location.pathname==='/warehouse/finished-inventory'");
    check("warehouse-only navigation opens inventory", await evaluate("location.pathname"), "/warehouse/finished-inventory");
    await evaluate("[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()==='Saved receipt vouchers').click()");
    await wait("!!document.querySelector('.prod-voucher')");
    await evaluate("document.querySelectorAll('.prod-voucher').forEach(voucher=>voucher.open=true)");
    check("all saved voucher items displayed", await evaluate("document.querySelector('.production-app').innerText.includes('PO-4')&&document.querySelector('.production-app').innerText.includes('PO-2')"));
    check("inventory reader cannot edit locations", await evaluate("![...document.querySelectorAll('.production-app button')].some(b=>/Save location|Edit/.test(b.textContent))"));
    permissions=["admin"];await navigate("/production/warehouse");
    await setInput("#location-name","Fixture new location");await setInput("#location-name-ar","موقع الاختبار الجديد");failWrite=true;
    await clickText("Save location");await wait("!!document.querySelector('.prod-error')");
    const locationKey=writes.at(-1).input.request_id;
    await clickText("Retry");await wait("!!document.querySelector('.prod-success')");
    check("location retry reuses its operation UUID",writes.at(-1).input.request_id,locationKey);
    check("location recovery clears both name fields",await evaluate("[document.querySelector('#location-name').value,document.querySelector('#location-name-ar').value]"),["",""]);
    check("lost location response creates one location", [...committed.values()].filter(v=>v.route==="/production/locations").length,1);
    Object.assign(state.orders.find(order=>order.id===4), {ready_kg:"0.30",received_kg:"0.20",remaining_kg:"0.10"});
    permissions = ["receive_production"];
    await navigate("/production");
    await wait("location.pathname==='/warehouse/hall'");
    check("receiver-only navigation opens hall", await evaluate("location.pathname"), "/warehouse/hall");
    await setInput("#receipt-order-0","4"); await setInput("#receipt-location-0","1"); await setInput("#receipt-quantity-0","0.10");
    check("exact remaining 0.10 kg is accepted without floating subtraction", await evaluate("document.querySelector('#receipt-quantity-0').validity.valid"));
    await setInput("#receipt-notes","Fixture recovery note");failWrite=true;
    await clickText("Save receipt");await wait("!!document.querySelector('.prod-error')");
    const receiptKey=writes.at(-1).input.request_id;
    check("uncertain receipt retains its quantity",await evaluate("document.querySelector('#receipt-quantity-0').value"),"0.10");
    await clickText("Retry"); await wait("!!document.querySelector('.prod-success')");
    check("receiving UI submits authoritative kilograms and all identifiers", writes.at(-1).input.items, [{production_order_id:4,location_id:1,quantity_kg:"0.10"}]);
    check("receipt retry reuses its operation UUID",writes.at(-1).input.request_id,receiptKey);
    check("receipt recovery clears submitted items and notes",await evaluate("[document.querySelector('#receipt-order-0').value,document.querySelector('#receipt-quantity-0').value,document.querySelector('#receipt-notes').value]"),["","",""]);
    check("lost receipt response creates one partial receipt", [...committed.values()].filter(v=>v.route==="/production/receipts").length,1);
    const beforeEmptyReceipt=writes.length;await clickText("Save receipt");
    check("empty recovered receipt cannot submit again",writes.length,beforeEmptyReceipt);
    permissions = ["view_production_hall"];
    await navigate("/production/hall");
    check("hall viewer cannot save receipt", await evaluate("![...document.querySelectorAll('.production-app button')].some(b=>b.textContent.trim()==='Save receipt')"));
    permissions = ["view_production"];
    failure = true;
    await navigate("/production"); await wait("!!document.querySelector('.prod-error')");
    failure = false;
    await clickText("Retry"); await wait("!document.querySelector('.prod-error')&&!document.querySelector('.prod-loading')&&document.querySelector('.production-app').innerText.includes('PO-2')");
    check("load failure retry restores data", await evaluate("document.querySelector('.production-app').innerText.includes('PO-2')"));
    permissions=["admin"];
    for(const lang of ["en","ar"]){
      language=lang;
      for(const width of [390,768,1440]){
        await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<500});
        await navigate("/production");
        await evaluate(`[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()===${jsLiteral(lang==="en"?"Order history":"تاريخ أوامر الإنتاج")}).click()`);
        await wait("document.body.innerText.includes('PO-220')");
        check(`${lang} ${width} expanded history fits viewport`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        await setInput("details[open] input:not([type])", "NO-MATCH-I18N");
        await evaluate("document.querySelector('details[open] form').requestSubmit()");
        const emptyText = lang === "en" ? "No results" : "لا توجد نتائج";
        await wait(`document.querySelector('details[open]').innerText.includes(${jsLiteral(emptyText)})`);
        check(`${lang} ${width} history empty message`, await evaluate("document.querySelectorAll('details[open] .prod-record').length"), 0);
        await setInput("details[open] input:not([type])", ""); historyFailure = true;
        await evaluate("document.querySelector('details[open] form').requestSubmit()");
        await wait("!!document.querySelector('details[open] .prod-error')");
        check(`${lang} ${width} history localized error`, await evaluate(`document.querySelector('details[open] .prod-error').innerText.includes(${jsLiteral(lang === "en" ? "Fixture history failure" : "تعذر تحميل التاريخ")})`));
        await navigate("/production/warehouse");
        for(const title of (lang==="en"?["Finished-goods balances","Saved receipt vouchers","Inventory movements"]:["أرصدة المواد التامة","سندات الاستلام المحفوظة","حركات المخزون"])){
          await evaluate(`[...document.querySelectorAll('summary')].find(item=>item.textContent.trim()===${jsLiteral(title)}).click()`);
        }
        await wait("!!document.querySelector('.prod-voucher')");
        await evaluate("document.querySelectorAll('.prod-voucher').forEach(item=>item.open=true)");
        check(`${lang} ${width} expanded warehouse history fits viewport`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
      }
    }
    check("each board requests its own scope",["management","film","printing","cutting","hall","warehouse","roll"].every(scope=>stateScopes.includes(scope)));
    check("no runtime exceptions", errors, []);
    await fs.writeFile(path.join(profile,"factory-ui-requests.json"),JSON.stringify(writes));
    console.log(`Verified ${passed} browser assertions with isolated API fixtures.`);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    ws?.close();
    if (chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill("SIGTERM"); await exited;
    }
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });