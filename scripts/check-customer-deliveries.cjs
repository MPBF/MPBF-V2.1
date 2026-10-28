// Exercise the actual page against fixture APIs, never live stock or accounts.
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp("/tmp/customer-deliveries-check-");
  let server, chrome, ws;
  try {
    await build({
      stdin: { contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import Page from './client/src/pages/warehouse/CustomerDeliveriesPage';
        import i18n from './client/src/i18n';import './client/src/styles/theme-tokens.css';
        const mode=new URLSearchParams(location.search);
        await i18n.changeLanguage(mode.has('en')?'en':'ar');
        document.documentElement.dir=mode.has('en')?'ltr':'rtl';
        const record={production_order_id:20,production_order_number:'PO-20',order_number:'O-123',
          customer_id:'C-1',customer_name:'Long English customer name for a synthetic delivery',customer_name_ar:'عميل تجريبي باسم طويل',
          item_id:'ITM001',product:{name:'English product',name_ar:'منتج تجريبي'},
          delivered_kg:'12345.67',last_delivered_at:'2026-10-16T22:30:00Z',
          deliveries:[{id:2,voucher_number:'FP-Del0002',created_at:'2026-10-16T22:30:00Z',quantity_kg:'12000.12'},
            {id:1,voucher_number:'FP-Del0001',created_at:'2026-10-15T09:00:00Z',quantity_kg:'345.55'}]};
        window.calls=[];window.fail=mode.has('error');window.empty=mode.has('empty');
        window.fetch=async(path,options={})=>{
          if(options.method!=='GET')throw Error('Unexpected mutation');
          const url=new URL(path,location.origin);window.calls.push(url.pathname+url.search);
          if(url.pathname!=='/api/production/customer-deliveries')throw Error('Unexpected API');
          if(window.fail)return {ok:false,status:500,json:async()=>({message:'خطأ تجريبي',message_en:'Fixture failure'})};
          const before=url.searchParams.get('before');
          return {ok:true,json:async()=>({records:window.empty?[]:[before?{...record,production_order_id:10,production_order_number:'PO-10'}:record],next:window.empty||before?null:20})};
        };
        createRoot(document.getElementById('root')).render(<Page user={{id:7,permissions:[mode.has('denied')?'view_raw_inventory':'view_finished_inventory']}}/>);
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
      for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error("Timed out: " + expression);
    };
    const navigate = async query => {
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?${query}` });
    };
    for (const width of [390, 768, 1280]) for (const english of [false, true]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await navigate(english ? "en=1" : "");
      await wait("document.querySelectorAll('.customer-delivery-card').length===1");
      assert.ok(await evaluate("document.querySelector('.customer-delivery-amount').textContent.includes('12,345.67')"));
      assert.ok(await evaluate("!!document.querySelector('a[href=\"/warehouse/customer-deliveries\"][aria-current=\"page\"]')"));
      await evaluate("document.querySelector('summary').click()");
      await wait("!!document.querySelector('details[open]')");
      assert.equal(await evaluate("document.querySelectorAll('.customer-delivery-voucher-row').length"), 3);
      assert.ok(await evaluate("document.querySelector('time').textContent.includes('17')"), "Riyadh day rolls over");
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), `page overflow ${width}`);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.customer-delivery-card,.customer-delivery-voucher-table')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)"), [], `card overflow ${width}`);
      assert.ok(await evaluate("document.querySelector('.customer-deliveries-toolbar').getBoundingClientRect().height<200"), "compact mobile search");
      if (english) assert.ok(!/[\u0600-\u06ff]/.test(await evaluate("document.querySelector('.customer-delivery-card').textContent")));
      if (width === 390 && !english) {
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        await fs.writeFile("/tmp/customer-deliveries-mobile.jpg", Buffer.from(shot.data, "base64"));
      }
      await evaluate("document.querySelector('.customer-delivery-load-more button').click()");
      await wait("document.querySelectorAll('.customer-delivery-card').length===2");
      assert.ok((await evaluate("window.calls")).some(url => url.includes("before=20")));
      await evaluate(`(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'PO-20');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait("window.calls.some(url=>url.includes('search=PO-20'))");
      await wait("document.querySelectorAll('.customer-delivery-card').length===1");
      const count = await evaluate("window.calls.length");
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await wait(`window.calls.length>${count}`);
      console.log(`PASS ${width}px ${english ? "English" : "Arabic"} cards, vouchers, dates, decimals, navigation, search, pagination, refresh`);
    }
    await navigate("denied=1");
    await wait("!!document.querySelector('[role=alert]')");
    assert.equal(await evaluate("window.calls.length"), 0, "denied role never fetches");
    assert.equal(await evaluate("document.querySelectorAll('.customer-delivery-card').length"), 0);
    await navigate("empty=1");
    await wait("!!document.querySelector('.customer-delivery-empty')");
    await navigate("error=1&en=1");
    await wait("!!document.querySelector('[role=alert]')");
    assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('Fixture failure')"));
    await evaluate("window.fail=false;document.querySelector('[role=alert] button').click()");
    await wait("document.querySelectorAll('.customer-delivery-card').length===1");
    assert.deepEqual(errors, []);
    console.log("PASS permission denial, empty state, error/retry; no mutations or runtime errors");
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) { chrome.kill("SIGKILL"); await new Promise(resolve => chrome.once("close", resolve)); }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
