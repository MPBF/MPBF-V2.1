// Real customer form, isolated HTTP fixtures. Never writes the application DB.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { build } = require("esbuild");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "customer-drawer-"));
  let chrome, server, ws, session, assertions = 0, failSave = false;
  const writes = [], errors = [];
  const check = (name, result) => { assert.ok(result, name); assertions++; console.log(`PASS ${name}`); };
  try {
    await build({ stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";import Modal from "./client/src/components/CustomerModal";import i18n,{applyLanguage}from"./client/src/i18n";import"./client/src/index.css";const p=new URL(location.href).searchParams;const lang=p.get("lang")||"ar";await i18n.changeLanguage(lang);applyLanguage(lang);const mode=p.get("mode");const row=mode==="edit"?{id:"CID001",name:"Existing fixture",name_ar:"عميل تجريبي",is_active:true,plate_drawer_code:"C-24"}:mode==="legacy"?{id:"CID002",name:"Legacy fixture",is_active:true,plate_drawer_code:"OLD-240"}:{};window.saved=[];createRoot(document.getElementById("root")).render(<Modal row={row} onClose={()=>{window.closed=true}} onSaved={r=>window.saved.push(r)}/>);`,
      resolveDir: process.cwd(), loader: "tsx" }, bundle: true, format: "esm", jsx: "automatic",
      outfile: path.join(temp, "entry.js"), logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' } });
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://fixture");
      if (url.pathname === "/api/customers/sales-representatives") {
        res.setHeader("Content-Type", "application/json"); return res.end("[]");
      }
      if (url.pathname.startsWith("/api/customers") && ["POST", "PUT"].includes(req.method)) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        writes.push({ method: req.method, path: url.pathname, body });
        res.setHeader("Content-Type", "application/json");
        if (failSave) { res.writeHead(400); return res.end(JSON.stringify({ message: "The drawer could not be saved." })); }
        return res.end(JSON.stringify({ id: url.pathname.split("/")[3] || "CID999", ...body }));
      }
      if (["/entry.js", "/entry.css"].includes(url.pathname)) {
        res.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
        return res.end(await fs.readFile(path.join(temp, url.pathname.slice(1))));
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${path.join(temp, "chrome")}`], { stdio: ["ignore", "ignore", "pipe"] });
    const debug = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Chrome startup timeout")), 15000);
      chrome.stderr.on("data", data => { const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    ws = new WebSocket(debug); await once(ws, "open");
    let counter = 0; const pending = new Map();
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        const task = pending.get(message.id); pending.delete(message.id);
        message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    });
    const send = (method, params = {}, attached = true) => new Promise((resolve, reject) => {
      const id = ++counter; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(attached && session ? { sessionId: session } : {}) }));
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, false);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
    await send("Runtime.enable"); await send("Page.enable");
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const end = Date.now() + 8000;
      while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw Error(`Timeout: ${expression}`);
    };
    const field = async (id, value) => evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}));})()`);
    const submit = () => evaluate("document.querySelector('form').requestSubmit()");
    const open = async (lang, mode = "") => {
      writes.length = 0; failSave = false;
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?lang=${lang}&mode=${mode}` });
      await wait("!!document.getElementById('customer-drawer-letter')&&!document.querySelector('button[type=submit]').disabled");
    };
    for (const lang of ["ar", "en"]) {
      await open(lang);
      check(`${lang} complete letter and number options`, await evaluate("document.getElementById('customer-drawer-letter').options.length===27&&document.getElementById('customer-drawer-number').options.length===101"));
      check(`${lang} exact number bounds`, await evaluate("document.getElementById('customer-drawer-number').options[1].value==='1'&&document.getElementById('customer-drawer-number').options[100].value==='100'"));
      check(`${lang} labels localized`, await evaluate(`document.querySelector('label[for=customer-drawer-letter]').textContent===${JSON.stringify(lang === "ar" ? "حرف الدرج" : "Drawer letter")}`));
      for (const width of [390, 768, 1280]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        check(`${lang} ${width}px drawer controls fit`, await evaluate("(()=>{const a=document.getElementById('customer-drawer-letter').getBoundingClientRect(),b=document.getElementById('customer-drawer-number').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&a.width>=44&&b.width>=44&&a.left>=0&&b.left>=0&&a.right<=innerWidth&&b.right<=innerWidth})()"));
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        await fs.writeFile(path.join(temp, `${lang}-${width}.png`), Buffer.from(screenshot.data, "base64"));
      }
      await field("customer-name", "New drawer fixture");
      await field("customer-drawer-letter", "C"); await submit();
      await wait("!!document.querySelector('[role=alert]')");
      check(`${lang} partial selection blocks save`, writes.length === 0);
      check(`${lang} incomplete drawer error localized`, await evaluate(`document.querySelector('[role=alert]').textContent.includes(${JSON.stringify(lang === "ar" ? "اختر حرف الدرج ورقمه معًا." : "Select both a drawer letter and number.")})`));
      await field("customer-drawer-number", "24"); await submit();
      await wait("window.saved.length===1");
      check(`${lang} create saves exact combined drawer`, writes[0]?.method === "POST" && writes[0].body.plate_drawer_code === "C-24");
      await open(lang); await field("customer-name", "No drawer fixture"); await submit(); await wait("window.saved.length===1");
      check(`${lang} drawer optional without defaults`, writes[0]?.body.plate_drawer_code === null);
      await open(lang, "edit");
      check(`${lang} edit prefills current drawer`, await evaluate("document.getElementById('customer-drawer-letter').value==='C'&&document.getElementById('customer-drawer-number').value==='24'"));
      await field("customer-city", "New city"); await submit(); await wait("window.saved.length===1");
      check(`${lang} unrelated edit does not rewrite drawer`, writes[0]?.method === "PUT" && !Object.hasOwn(writes[0].body, "plate_drawer_code"));
      await open(lang, "edit"); await field("customer-drawer-letter", "Z"); await field("customer-drawer-number", "100");
      await submit(); await wait("window.saved.length===1");
      check(`${lang} drawer update uses supported upper bounds`, writes[0]?.body.plate_drawer_code === "Z-100");
      await open(lang, "edit"); await field("customer-drawer-letter", ""); await field("customer-drawer-number", "");
      await submit(); await wait("window.saved.length===1");
      check(`${lang} deliberate clearing submits explicit null`, Object.hasOwn(writes[0].body, "plate_drawer_code") && writes[0].body.plate_drawer_code === null);
      await open(lang, "legacy");
      check(`${lang} historical drawer remains visible`, await evaluate("document.body.textContent.includes('OLD-240')"));
      await field("customer-city", "Another city"); await submit(); await wait("window.saved.length===1");
      check(`${lang} unrelated edit preserves historical drawer`, !Object.hasOwn(writes[0].body, "plate_drawer_code"));
      await open(lang, "legacy"); await field("customer-drawer-letter", "A"); await field("customer-drawer-number", "1");
      failSave = true; await submit(); await wait("!!document.querySelector('[role=alert]')&&!document.querySelector('button[type=submit]').disabled");
      check(`${lang} failed save retains selections and modal`, await evaluate("window.saved.length===0&&document.getElementById('customer-drawer-letter').value==='A'&&document.getElementById('customer-drawer-number').value==='1'"));
      failSave = false; await submit(); await wait("window.saved.length===1");
      check(`${lang} legacy drawer can be explicitly replaced`, writes.at(-1)?.body.plate_drawer_code === "A-1");
    }
    check("no uncaught browser exceptions", errors.length === 0);
    console.log(`Verified ${assertions} customer drawer assertions; screenshots at ${temp}`);
  } finally {
    ws?.close(); if (chrome) { chrome.kill("SIGTERM"); await once(chrome, "exit").catch(() => {}); }
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
