// Actual raw-inventory component with synthetic APIs; no live records or auth bypass.
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp("/tmp/raw-inventory-check-");
  let server, chrome, ws;
  try {
    await build({
      stdin: { contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import Page from './client/src/pages/warehouse/RawInventoryPage';
        import i18n from './client/src/i18n';import './client/src/styles/theme-tokens.css';
        const params=new URLSearchParams(location.search);
        await i18n.changeLanguage(params.has('en')?'en':'ar');
        document.documentElement.dir=params.has('en')?'ltr':'rtl';
        const materials=[
          {id:1,item_id:'ITM001',code:'HDPE',name:'High density polyethylene resin with a deliberately long catalog name',name_ar:'خام عالي الكثافة',quantity_kg:'-0.25',total_received_kg:'12345.67',total_issued_kg:'12345.92',is_active:true},
          {id:2,item_id:'ITM002',code:'LDPE',name:'Low density resin',name_ar:'خام منخفض الكثافة',quantity_kg:'0.00',total_received_kg:'0',total_issued_kg:'0',is_active:true},
          {id:3,item_id:'ITM003',code:'MISSING-EN',name:'مادة باسم عربي فقط',name_ar:'مادة باسم عربي فقط',quantity_kg:'1',total_received_kg:'999999999999.99',total_issued_kg:'999999999998.99',is_active:false}
        ];
        window.calls=[];
        window.fetch=async(path,options={})=>{
          window.calls.push(String(path));
          if(String(path)!=='/api/production/mixing'||(options.method&&options.method!=='GET'))throw Error('Unexpected request '+path);
          return {ok:true,json:async()=>({materials,machines:[],latest_mixes:[],records:[],next_before:null,
            raw_vouchers:[{id:1,kind:'receipt',total_kg:'1',created_at:'2026-10-01T10:00:00Z',created_by:1,actor_name:'Test operator',actor_name_ar:'موظف تجريبي',
              items:[{material_id:1,code:'HDPE',name:'High density resin',name_ar:'خام عالي الكثافة',quantity_kg:'1'}]}]})};
        };
        createRoot(document.getElementById('root')).render(<Page user={{id:1,permissions:params.has('readonly')?['view_raw_inventory']:['manage_raw_materials']}}/>);
      `, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, platform: "browser", format: "esm", jsx: "automatic", outfile: `${temp}/check.js`, logLevel: "silent",
    });
    server = http.createServer(async (req, res) => {
      const name = req.url.split("?")[0];
      if (name === "/check.js" || name === "/check.css") {
        res.setHeader("Content-Type", name.endsWith("css") ? "text/css" : "text/javascript");
        return res.end(await fs.readFile(temp + name));
      }
      res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/check.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}/profile`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let text = ""; const timer = setTimeout(() => reject(Error("Chromium timeout")), 20000);
      chrome.stderr.on("data", chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    });
    ws = new WebSocket(address); await new Promise(resolve => ws.once("open", resolve));
    let serial = 0, session;
    const pending = new Map(), errors = [];
    ws.on("message", raw => {
      const data = JSON.parse(raw);
      if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.text);
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
      const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error("Timed out: " + expression);
    };
    for (const width of [390, 768, 1280]) for (const english of [false, true]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?${english ? "en=1" : ""}` });
      await wait("document.querySelectorAll('.raw-stock-card').length===3");
      const titles = await evaluate("[...document.querySelectorAll('.raw-stock-card h3')].map(e=>e.textContent)");
      assert.ok(titles[0].startsWith("High density polyethylene"));
      assert.deepEqual(titles.slice(1), ["Low density resin", "MISSING-EN"]);
      assert.deepEqual(await evaluate("[...document.querySelector('.raw-stock-totals').querySelectorAll('bdi')].map(e=>e.textContent)"), ["12,345.67 kg", "12,345.92 kg"]);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.raw-stock-totals')[1].querySelectorAll('bdi')].map(e=>e.textContent)"), ["0 kg", "0 kg"]);
      assert.ok(await evaluate("!!document.querySelector('.raw-stock-quantity.negative')"));
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), `page overflow ${width}`);
      const overflow = await evaluate("[...document.querySelectorAll('.raw-stock-card,.raw-stock-totals')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)");
      assert.deepEqual(overflow, [], `card overflow ${width}: ${overflow}`);
      assert.ok(await evaluate(`document.querySelector('.raw-stock-totals').textContent.includes(${JSON.stringify(english ? "Total issued" : "مجموع الخارج")})`));
      await evaluate("document.querySelector('.raw-movement-launch-actions button').click()");
      await wait("!!document.querySelector('#raw-material-0')");
      const option = await evaluate("document.querySelector('#raw-material-0 option[value=\"1\"]').textContent");
      assert.ok(option.startsWith("High density polyethylene"));
      assert.ok(!/[\u0600-\u06ff]/.test(option), "selector uses English names in both languages");
      await evaluate("document.querySelector('.raw-movement-dialog header button').click()");
      if (width === 390 && !english) {
        await evaluate("document.querySelector('.raw-stock-card').scrollIntoView({block:'start'})");
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        await fs.writeFile("/tmp/raw-inventory-totals.jpg", Buffer.from(shot.data, "base64"));
      }
      console.log(`PASS ${width}px ${english ? "English" : "Arabic"}: English material names, exact totals, zero/negative balances, long values fit, movement selector`);
    }
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?readonly=1` });
    await wait("document.querySelectorAll('.raw-stock-card').length===3");
    assert.equal(await evaluate("document.querySelectorAll('.raw-movement-launch-actions').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.raw-stock-totals').length"), 3);
    assert.deepEqual(errors, []);
    console.log("PASS read-only warehouse viewer sees totals without stock-write controls; no runtime errors");
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) { chrome.kill("SIGKILL"); await new Promise(resolve => chrome.once("close", resolve)); }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
