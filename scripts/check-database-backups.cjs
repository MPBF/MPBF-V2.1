// Isolated component/API fixtures; never logs in or writes to the real app DB.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { build } = require("esbuild");
const WebSocket = require("ws");
const { once } = require("node:events");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "backup-browser-"));
  let chrome, server, ws;
  let safetyFails = false, applyUncertain = false, setupMissing = false, commits = 0;
  const requests = [], errors = [];
  const id = "00000000-0000-4000-8000-000000000001";
  const checksum = "a".repeat(64), phrase = "synthetic-backup-passphrase";
  let assertions = 0;
  const check = (name, value) => { assert.ok(value, name); assertions++; console.log(`PASS ${name}`); };
  try {
    await build({
      stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";import Panel from "./client/src/pages/admin/DatabaseBackupsPanel";import "./client/src/index.css";const lang=new URL(location.href).searchParams.get("lang")||"ar";document.documentElement.dir=lang==="ar"?"rtl":"ltr";createRoot(document.getElementById("root")).render(<main style={{padding:"16px",maxWidth:"1100px",margin:"auto"}}><Panel language={lang}/></main>);`,
        resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, jsx: "automatic", outfile: path.join(temp, "entry.js"), logLevel: "silent",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://fixture");
      if (url.pathname.startsWith("/api/")) {
        const parts = []; for await (const part of req) parts.push(part);
        const raw = Buffer.concat(parts).toString();
        requests.push({ path: url.pathname, body: raw });
        if (url.pathname.endsWith("/create") || url.pathname.endsWith("/safety")) {
          if (url.pathname.endsWith("/create") && setupMissing) {
            res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"code":"BACKUP_SETUP_REQUIRED"}'); return;
          }
          if (url.pathname.endsWith("/safety") && safetyFails) {
            res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"code":"BACKUP_STORAGE_UNAVAILABLE"}'); return;
          }
          res.writeHead(200, { "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="fixture.mpbfbak"', "X-Backup-Safety-Checksum": checksum });
          res.end(Buffer.from("MPBFBK01-encrypted-fixture")); return;
        }
        res.setHeader("Content-Type", "application/json");
        if (url.pathname.endsWith("/preview")) {
          res.end(JSON.stringify({ id, createdAt: "2026-10-13T04:00:00Z", expiresAt: "2026-10-13T04:10:00Z",
            environment: "development", tables: [{ name: "users", currentRows: 1200, backupRows: 1100 },
              { name: "orders", currentRows: 3, backupRows: 2 }],
            excludedTables: ["sessions", "integration_credentials"], totalRows: 1102, safetyReady: false }));
          return;
        }
        if (url.pathname.endsWith("/apply")) {
          if (!commits) commits++;
          if (applyUncertain) {
            applyUncertain = false;
            res.writeHead(503); res.end('{"code":"BACKUP_FAILED"}'); return;
          }
          res.end(JSON.stringify({ id, restoredTables: 2, restoredRows: 1102, restoredAt: "2026-10-13T04:02:00Z", requiresLogin: true })); return;
        }
        res.writeHead(404); res.end("{}"); return;
      }
      if (url.pathname === "/entry.js" || url.pathname === "/entry.css") {
        res.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
        res.end(await fs.readFile(path.join(temp, url.pathname.slice(1)))); return;
      }
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script src="/entry.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu",
      "--remote-debugging-port=0", `--user-data-dir=${path.join(temp, "chrome")}`], { stdio: ["ignore", "ignore", "pipe"] });
    const debuggerUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Chrome startup timeout")), 12000);
      chrome.stderr.on("data", data => {
        const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    ws = new WebSocket(debuggerUrl); await once(ws, "open");
    let counter = 0, session;
    const pending = new Map();
    ws.on("message", raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(Error(msg.error.message)); else p.resolve(msg.result);
      }
      if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
    });
    const send = (method, params = {}, attached = true) => new Promise((resolve, reject) => {
      const cid = ++counter; pending.set(cid, { resolve, reject });
      ws.send(JSON.stringify({ id: cid, method, params, ...(attached && session ? { sessionId: session } : {}) }));
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, false);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
    await send("Runtime.enable"); await send("Page.enable");
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: temp }, false);
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
    const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const passwords = ".db-backups-panel input[type=password]";
    for (const lang of ["ar", "en"]) {
      requests.length = 0; commits = 0;
      await send("Page.navigate", { url: `${base}/?lang=${lang}` });
      await wait("!!document.querySelector('.db-backups-panel')");
      check(`${lang} initial render does not create a backup`, requests.length === 0);
      check(`${lang} passwords are concealed`, await evaluate(`document.querySelectorAll(${JSON.stringify(passwords)}).length>=3`));
      // Use the two password inputs in the first create form.
      await evaluate(`(()=>{const p=document.querySelectorAll('.db-backups-panel form')[0].querySelectorAll('input[type=password]');for(const e of p){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(phrase)});e.dispatchEvent(new Event("input",{bubbles:true}));}})()`);
      await wait("!document.querySelectorAll('.db-backups-panel form')[0].querySelector('button[type=submit]').disabled");
      await click(".db-backups-panel form button[type=submit]");
      await wait("document.querySelectorAll('.db-backups-panel form')[0].querySelector('input[type=password]').value===''");
      check(`${lang} backup sends only passphrase`, Object.keys(JSON.parse(requests.find(r => r.path.endsWith("/create")).body)).join() === "passphrase");
      await evaluate(`(()=>{const e=document.querySelector('input[type=file]'),d=new DataTransfer();d.items.add(new File(['MPBFBK01-fixture'],'archive.mpbfbak',{type:'application/octet-stream'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await input(".db-backup-preview-form input[type=password]", phrase);
      await click(".db-backup-preview-form button[type=submit]");
      await wait("!!document.querySelector('.db-backup-preview')");
      check(`${lang} preview has grouped counts and no plaintext rows`, await evaluate("document.querySelector('.db-backup-preview').textContent.includes('1,200')&&!document.querySelector('.db-backup-preview').textContent.includes('synthetic-password')"));
      check(`${lang} preview false safetyReady does not make the workflow unreachable`, await evaluate("!document.querySelector('.db-backup-safety').textContent.includes('not currently available')"));
      safetyFails = true;
      await input(".db-backup-safety input[type=password]", phrase);
      await wait("!document.querySelector('.db-backup-safety button').disabled");
      await click(".db-backup-safety button");
      await wait("!!document.querySelector('.db-backup-alert')");
      check(`${lang} failed safety download cannot enable apply`, await evaluate("!document.querySelector('.db-backup-apply')&&!document.querySelector('.db-backup-checks')"));
      safetyFails = false;
      await input(".db-backup-safety input[type=password]", phrase);
      await click(".db-backup-safety button");
      await wait("!!document.querySelector('.db-backup-checks')");
      check(`${lang} success requires both acknowledgements`, await evaluate("!document.querySelector('.db-backup-apply')"));
      await click(".db-backup-checks label:first-child input");
      check(`${lang} safety acknowledgement alone is insufficient`, await evaluate("!document.querySelector('.db-backup-apply')"));
      await click(".db-backup-checks label:last-child input");
      await wait("!!document.querySelector('.db-backup-apply')");
      for (const width of [390, 768, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        check(`${lang} ${width} page fits viewport`, await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"));
        await fs.writeFile(path.join(temp, `${lang}-${width}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      }
      applyUncertain = true;
      await input(".db-backup-apply input[type=password]", phrase);
      await click(".db-backup-apply button");
      await wait("document.querySelector('.db-backup-apply button').textContent.includes(" + JSON.stringify(lang === "ar" ? "إعادة محاولة" : "Retry") + ")");
      check(`${lang} lost response is not reported as success`, await evaluate("!document.querySelector('.db-backup-success')"));
      await input(".db-backup-apply input[type=password]", phrase);
      await click(".db-backup-apply button");
      await wait("!!document.querySelector('.db-backup-success')");
      const applies = requests.filter(r => r.path.endsWith("/apply")).map(r => JSON.parse(r.body));
      check(`${lang} retry preserves identical approved input and one commit`, applies.length === 2 && JSON.stringify(applies[0]) === JSON.stringify(applies[1]) && commits === 1);
      check(`${lang} session renewal is explicit`, await evaluate("!!document.querySelector('.db-backup-success button')"));
      check(`${lang} passphrases are not stored in browser storage`, await evaluate("localStorage.length===0&&sessionStorage.length===0"));
      setupMissing = true;
      await evaluate(`(()=>{for(const e of document.querySelectorAll('.db-backups-panel form')[0].querySelectorAll('input[type=password]')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(phrase)});e.dispatchEvent(new Event("input",{bubbles:true}));}})()`);
      await click(".db-backups-panel form button[type=submit]");
      await wait("!!document.querySelector('.db-backup-alert')");
      check(`${lang} missing migration reports required setup, not temporary storage failure`, await evaluate("document.querySelector('.db-backup-alert').textContent.includes(" + JSON.stringify(lang === "ar" ? "لم تُجهّز" : "have not been set up") + ")"));
      check(`${lang} setup error still clears entered passphrases`, await evaluate("document.querySelectorAll('.db-backups-panel form')[0].querySelector('input[type=password]').value===''"));
      setupMissing = false;
    }
    check("no uncaught browser exceptions", errors.length === 0);
    console.log(`Verified ${assertions} backup browser assertions; screenshots at ${temp}`);
  } finally {
    if (ws) ws.close();
    if (chrome) { chrome.kill("SIGTERM"); await once(chrome, "exit").catch(() => {}); }
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
