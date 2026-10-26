// Actual component, fixture APIs only. Never reads or changes live customer data.
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp("/tmp/customer-facing-check-");
  const logo = await fs.readFile("attached_assets/Firefly_replace_the_font_of_the_text_around_the_logo_(Small)_1792995814002.png");
  let server, chrome, ws;
  try {
    await build({
      stdin: { contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import Modal from './client/src/components/CustomerProductModal';
        import HumanResources from './client/src/pages/HumanResources';
        import i18n from './client/src/i18n';
        import './client/src/styles/theme-tokens.css';
        const params=new URLSearchParams(location.search);
        if(params.has('en'))await i18n.changeLanguage('en');
        const row=params.has('edit')?{id:17,customer_id:1,width:'30',right_facing:'5',left_facing:'4',thickness:'20',notes:'old',punching:'بدون',status:'active',front_print_colors:[],back_print_colors:[]}:{customer_id:1,width:'30',thickness:'20'};
        window.writes=[];window.saved=false;
        window.logoSource=${JSON.stringify(`data:image/png;base64,${logo.toString("base64")}`)};
        window.makeImage=(fill)=>{const c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,100,100);ctx.fillStyle=fill;ctx.fillRect(20,20,60,60);return c.toDataURL();};
        window.fetch=async(input,options={})=>{
          const url=new URL(String(input),location.origin);
          if(!url.pathname.startsWith('/api/'))throw Error('Unexpected fetch '+url);
          if(options.method&&options.method!=='GET'){if(url.pathname!=='/api/customer-products'&&url.pathname!=='/api/customer-products/17')throw Error('Unexpected write');window.writes.push({method:options.method,body:JSON.parse(options.body)});return {ok:true,json:async()=>({id:17})};}
          const data={'/api/customers':[{id:1,name_ar:'عميل تجريبي',name:'Test customer'}],'/api/categories':[{id:'HOOK',name_ar:'أكياس علاقي',name:'Hanger bags'},{id:'BANANA',name_ar:'أكياس بنانة',name:'Banana bags'},{id:'COAL',name_ar:'أكياس فحم',name:'Charcoal bags'}],'/api/items':[],'/api/master-batch-colors':[],'/api/customer-products/form-options':{printing_cylinders:[]}};
          data['/api/hr/data']={shifts:[],history:[],users:[{id:1,username:'test',display_name:'Test employee',display_name_ar:'موظف تجريبي',section_id:'2',section_name:'الطباعة',section_name_ar:'الطباعة',section_name_en:'Printing',shift_id:null,assignment_id:null,assigned_at:null},{id:2,username:'none',display_name:'No section',display_name_ar:'بدون قسم',section_id:'99',section_name:null,shift_id:null,assignment_id:null,assigned_at:null}]};
          if(!(url.pathname in data))throw Error('Unexpected lookup '+url);
          return {ok:true,json:async()=>data[url.pathname]};
        };
        createRoot(document.getElementById('root')).render(params.has('hr')?<HumanResources canReviewRequests={false}/>:<Modal row={row} onClose={()=>{}} onSaved={()=>{window.saved=true}}/>);
      `, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, platform: "browser", format: "esm", jsx: "automatic", outfile: `${temp}/check.js`, logLevel: "silent",
    });
    server = http.createServer(async (req, res) => {
      const path = req.url.split("?")[0];
      if (path === "/check.js" || path === "/check.css") {
        res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript");
        return res.end(await fs.readFile(temp + path));
      }
      res.end('<html dir="rtl" lang="ar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/check.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}label{display:block;margin-bottom:6px}button,select,input,textarea{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}/profile`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let text = ""; const timer = setTimeout(() => reject(Error("Chromium timeout")), 20000);
      chrome.stderr.on("data", chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    ws = new WebSocket(address); await new Promise(resolve => ws.once("open", resolve));
    let serial = 0, session;
    const pending = new Map();
    ws.on("message", raw => {
      const data = JSON.parse(raw);
      if (!data.id) return;
      const entry = pending.get(data.id); pending.delete(data.id);
      data.error ? entry.reject(Error(data.error.message)) : entry.resolve(data.result);
    });
    const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, true)).sessionId;
    await send("Page.enable"); await send("Runtime.enable");
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error("Timed out: " + expression);
    };
    const open = async (width, edit = false) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/${edit ? "?edit=1" : ""}` });
      await wait("!!document.querySelector('#cp-right')");
    };
    const set = async (id, value) => {
      await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
      await evaluate("new Promise(resolve=>setTimeout(resolve,20))");
    };
    const pair = () => evaluate("[document.querySelector('#cp-right').value,document.querySelector('#cp-left').value]");
    for (const width of [390, 768, 1280]) {
      await open(width);
      assert.deepEqual(await pair(), ["", ""]);
      await set("cp-right", "5"); assert.deepEqual(await pair(), ["5", "5"]);
      await set("cp-left", "4"); assert.deepEqual(await pair(), ["4", "4"]);
      await set("cp-right", "0"); assert.deepEqual(await pair(), ["0", "0"]);
      await set("cp-left", ""); assert.deepEqual(await pair(), ["", ""]);
      const layout = await evaluate(`(()=>{const ids=['cp-right','cp-width','cp-left'];const r=ids.map(id=>document.getElementById(id).getBoundingClientRect());return {gap1:r[0].left-r[1].right,gap2:r[1].left-r[2].right,widths:r.map(x=>x.width),tops:r.map(x=>x.top),fits:document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.cp-modal').scrollWidth<=document.querySelector('.cp-modal').clientWidth};})()`);
      assert.ok(layout.fits, `overflow at ${width}`);
      assert.ok(Math.abs(layout.gap1 - layout.gap2) < 1, `unequal gaps ${width}: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.widths[0] * 2 - layout.widths[1]) < 1, `side ratio ${width}`);
      assert.ok(Math.abs(layout.tops[0] - layout.tops[2]) < 1, `not aligned ${width}`);
      assert.ok(await evaluate("!!document.querySelector('label[for=cp-right] .lucide-arrow-right')&&!!document.querySelector('label[for=cp-left] .lucide-arrow-left')"));
      await set("cp-left", "5");
      await evaluate("document.querySelector('.cp-save').click()");
      await wait("window.saved===true");
      const write = await evaluate("window.writes[0]");
      assert.equal(write.method, "POST");
      assert.equal(write.body.right_facing, "5"); assert.equal(write.body.left_facing, "5");
      console.log(`PASS ${width}px: equal visible gaps, half-width sides, bidirectional sync, zero/blank, saved values`);
    }
    await open(1280, true);
    assert.deepEqual(await pair(), ["5", "4"]);
    await set("cp-width", "32"); assert.deepEqual(await pair(), ["5", "4"]);
    await open(1280, true);
    await evaluate("(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'notes only');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,20))");
    await evaluate("document.querySelector('.cp-save').click()");
    await wait("!!document.querySelector('.cp-facing-warning')");
    await evaluate("document.querySelector('.cp-warning-actions button:last-child').click()");
    await wait("window.saved===true");
    assert.deepEqual(await evaluate("window.writes[0]"), { method: "PUT", body: { notes: "notes only" } });
    assert.deepEqual(await pair(), ["5", "4"]);
    await set("cp-left", "6"); assert.deepEqual(await pair(), ["6", "6"]);
    console.log("PASS historical unequal sides unchanged on open, width/notes edits; explicit side choice syncs both");
    await open(1280);
    await set("cp-width", "10"); await set("cp-right", "6");
    await evaluate("document.querySelector('.cp-save').click()");
    await wait("document.querySelector('.cp-error')?.textContent.includes('مجموع الجانب الأيمن والجانب الأيسر')");
    assert.equal(await evaluate("window.writes.length"), 0);
    console.log("PASS existing half-width validation retained; no live API requests");
    for (const width of [390, 768, 1280]) {
      await open(width);
      await set("cp-category", "HOOK");
      assert.equal(await evaluate("document.querySelector('#cp-punching').value"), "علاقي");
      assert.ok(await evaluate("[...document.querySelector('#cp-punching').options].every(o=>o.value!=='بدون')"));
      await set("cp-punching", "علاقي هوك");
      await set("cp-width", "32");
      assert.equal(await evaluate("document.querySelector('#cp-punching').value"), "علاقي هوك");
      await set("cp-category", "BANANA");
      assert.equal(await evaluate("document.querySelector('#cp-punching').value"), "بنانة");
      assert.ok(await evaluate("[...document.querySelector('#cp-punching').options].every(o=>o.value!=='بدون')"));
      await set("cp-category", "COAL");
      assert.equal(await evaluate("document.querySelector('#cp-punching').value"), "بدون");
      assert.ok(await evaluate("[...document.querySelector('#cp-punching').options].some(o=>o.value==='بنانة')"));
      await set("cp-punching", "بنانة");
      await evaluate("document.querySelector('.cp-save').click()");
      await wait("window.saved===true");
      assert.equal(await evaluate("window.writes[0].body.punching"), "بنانة");
      assert.equal(await evaluate("window.writes[0].body.category_id"), "COAL");
      console.log(`PASS ${width}px: category defaults, charcoal optional banana, explicit override preserved and saved`);
    }
    for (const width of [390, 768, 1280]) {
      await open(width);
      const upload = async (side, source) => {
        await evaluate(`(async()=>{const src=${source};const bytes=Uint8Array.from(atob(src.split(',')[1]),c=>c.charCodeAt(0));const input=document.querySelectorAll('.cp-file')[${side}];const dt=new DataTransfer();dt.items.add(new File([bytes],'artwork.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await wait(`!document.querySelectorAll('.cp-file')[${side}].disabled`);
        await wait(`!!document.querySelectorAll('.cp-image-card')[${side}].querySelector('.cp-preview img')`);
      };
      const colors = (side) => evaluate(`[...document.querySelectorAll('.cp-image-card')[${side}].querySelectorAll('.cp-color-pill>span')].map(e=>e.textContent)`);
      await upload(0, "window.logoSource");
      const palette = await colors(0);
      console.log("Logo palette:", palette);
      assert.equal(palette.length, 2, "logo must produce only green and navy");
      const rgb = palette.map(hex => hex.slice(1).match(/../g).map(n=>parseInt(n,16)));
      assert.ok(rgb.some(([r,g,b])=>g>r*1.5&&g>b*1.3), "green ink");
      assert.ok(rgb.some(([r,g,b])=>b>g*1.5&&b>r*1.4), "navy ink");
      const processed = await evaluate(`(async()=>{const img=document.querySelectorAll('.cp-image-card')[0].querySelector('.cp-preview img');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return {width:c.width,height:c.height,cornerAlpha:ctx.getImageData(0,0,1,1).data[3],source:img.src};})()`);
      assert.equal(processed.width, 480, "original width preserved");
      assert.equal(processed.height, 480, "original height preserved");
      assert.equal(processed.cornerAlpha, 0, "background is actually transparent in saved image");
      assert.notEqual(processed.source, await evaluate("window.logoSource"));
      assert.deepEqual(await colors(1), [], "front upload must not affect back");
      await evaluate("document.querySelector('.cp-colors').scrollIntoView({block:'center'})");
      assert.ok(await evaluate("document.querySelector('.cp-modal').scrollWidth<=document.querySelector('.cp-modal').clientWidth"), "no artwork-section overflow");
      if (width === 390) {
        const screenshot = await send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
        await fs.writeFile("/tmp/customer-product-print-colors.jpg", Buffer.from(screenshot.data, "base64"));
      }
      await upload(1, "window.makeImage('#d02020')");
      assert.equal((await colors(1)).length, 1);
      assert.deepEqual(await colors(0), palette, "back upload must not affect front");
      await evaluate(`(()=>{const e=document.querySelectorAll('.cp-image-card')[0].querySelector('.cp-ink-edit');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'#123456');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("document.querySelectorAll('.cp-image-card')[0].querySelector('.cp-color-pill>span').textContent==='#123456'");
      await evaluate("document.querySelectorAll('.cp-image-card')[0].querySelector('.cp-color-add button').click()");
      assert.equal((await colors(0)).length, 3, "manual add remains available");
      await evaluate("document.querySelectorAll('.cp-image-card')[0].querySelector('.cp-color-pill button').click()");
      assert.equal((await colors(0)).length, 2, "manual removal remains available");
      await upload(0, "window.makeImage('#d02020')");
      assert.equal((await colors(0)).length, 1, "reupload replaces, not appends");
      const previous = await colors(0);
      await evaluate(`(()=>{const input=document.querySelectorAll('.cp-file')[0];const dt=new DataTransfer();dt.items.add(new File(['broken image'],'broken.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("!!document.querySelectorAll('.cp-image-card')[0].querySelector('[role=alert]')");
      assert.deepEqual(await colors(0), previous, "invalid image preserves palette");
      await evaluate("document.querySelector('.cp-save').click()");
      await wait("window.saved");
      assert.deepEqual(await evaluate("window.writes[0].body.front_print_colors"), previous);
      assert.equal((await evaluate("window.writes[0].body.back_print_colors")).length, 1);
      console.log(`PASS ${width}px: logo has two inks, separate faces, manual changes, replacement, decode failure, saved colors`);
    }
    for (const width of [390, 768, 1280]) {
      for (const english of [false, true]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?hr=1${english ? "&en=1" : ""}` });
        await wait("document.querySelectorAll('.hr-table-wrap tbody tr').length===2");
        const names = await evaluate("[...document.querySelectorAll('.hr-table-wrap tbody tr')].map(r=>r.cells[2].textContent)");
        assert.deepEqual(names, [english ? "Printing" : "الطباعة", "—"]);
        await evaluate(`(()=>{const e=document.querySelector('.hr-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(english ? "Printing" : "الطباعة")});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await wait("document.querySelectorAll('.hr-table-wrap tbody tr').length===1");
        assert.equal(await evaluate("document.querySelector('.hr-table-wrap tbody tr').cells[2].textContent"), english ? "Printing" : "الطباعة");
      }
      console.log(`PASS ${width}px: HR section names (Arabic/English), missing-name placeholder and section-name search`);
    }
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) { chrome.kill("SIGKILL"); await new Promise(resolve => chrome.once("close", resolve)); }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
