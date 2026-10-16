// Browser integration checks with intercepted APIs; no actual account or business writes.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "self-network-"));
  let chrome, ws, session, serial = 0, mode = "once", language = "ar";
  const pending = new Map(), errors = [], counts = {};
  let historyEvents = [];
  const endpoints = ["attendance", "recipients", "messages", "requests", "violations"];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const resetCounts = () => { for (const key of endpoints) counts[key] = 0; };
  resetCounts();
  try {
    chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.once("error", reject);
      chrome.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}, sid = session) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const call = pending.get(event.id);
        if (call) { pending.delete(event.id); event.error ? call.reject(Error(JSON.stringify(event.error))) : call.resolve(event.result); }
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      } else if (event.method === "Fetch.requestPaused") void (async () => {
        const { requestId, request } = event.params, url = new URL(request.url);
        assert.equal(request.method, "GET", "Only intercepted read requests are allowed");
        let body = [];
        if (url.pathname === "/api/me") body = { user: {
          id: 42, username: "fixture", display_name: "Test Employee", display_name_ar: "موظف تجريبي",
          preferred_language: language, permissions: [],
        } };
        if (url.pathname === "/api/public-branding") body = { companyNameAr: "مصنع تجريبي", companyNameEn: "Test Factory", logoSrc: "" };
        const endpoint = url.pathname.replace("/api/self/", "");
        if (endpoints.includes(endpoint)) {
          counts[endpoint] += 1;
          if (mode === "all" || mode === "once" && counts[endpoint] === 1) {
            await send("Fetch.failRequest", { requestId, errorReason: "Failed" }, event.sessionId);
            return;
          }
          if (endpoint === "attendance") body = {
            events: historyEvents, status: "out", month: "2026-10", daysPresent: 7, currentSession: null,
            activeShift: null, withinShiftWindow: false, serverNow: new Date().toISOString(),
            workedSeconds: 0, sessionStartedAt: null, actionTimes: {},
          };
        }
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") }, event.sessionId);
      })().catch(error => errors.push(error.stack));
    });
    const targetId = (await send("Target.createTarget", { url: "about:blank" }, null)).targetId;
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, null)).sessionId;
    await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
      throw Error(`Timed out: ${expression}`);
    };
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const open = async width => {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await evaluate("window.__selfFixtureNavigating=true");
      await send("Page.navigate", { url: `${origin}/my-dashboard` });
      await wait("!window.__selfFixtureNavigating&&!!document.querySelector('.self-page')");
    };
    const ready = "!!document.querySelector('.self-page .page-hero-refresh:not([disabled])')";
    await open(1440);
    await wait(`${ready}&&document.querySelector('.self-summary-item strong').textContent==='7'`);
    for (const key of endpoints) assert.equal(counts[key], 2, `${key}: one failure then recovery`);
    assert.equal(await evaluate("!!document.querySelector('.self-alert-error')"), false);
    assert.equal(await evaluate("document.querySelectorAll('.self-attendance-day').length"), 0);
    assert.equal(await evaluate("document.body.textContent.includes('لا توجد أحداث حضور مسجلة لهذا الشهر.')"), true);
    console.log("PASS all five sections recover from a transient failed fetch");

    mode = "all"; resetCounts();
    await evaluate("document.querySelector('.page-hero-refresh').click()");
    await wait(`${ready}&&!!document.querySelector('.self-alert-error button')`);
    for (const key of endpoints) assert.equal(counts[key], 3, `${key}: bounded retries`);
    assert.equal(await evaluate("document.querySelector('.self-alert-error').textContent.includes('Failed to fetch')"), false);
    console.log("PASS permanent outage: bounded attempts, clear message and explicit read-only retry");

    mode = "ok"; resetCounts();
    await evaluate("document.querySelector('.self-alert-error button').click()");
    await wait(`${ready}&&!document.querySelector('.self-alert-error')`);
    for (const key of endpoints) assert.equal(counts[key], 1);
    console.log("PASS retry button restores every section without business writes");

    mode = "all"; resetCounts();
    await evaluate("document.querySelector('.page-hero-refresh').click()");
    await wait(`${ready}&&!!document.querySelector('.self-alert-error button')`);
    mode = "ok"; resetCounts();
    await evaluate("window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))");
    await wait(`${ready}&&!document.querySelector('.self-alert-error')`);
    for (const key of endpoints) assert.equal(counts[key], 1, `${key}: recovery events must not duplicate reads`);
    console.log("PASS online/focus recovery is deduplicated");

    language = "en"; mode = "all"; resetCounts();
    await open(390);
    await wait(`${ready}&&!!document.querySelector('.self-alert-error button')&&document.documentElement.lang==='en'`);
    const errorText = await evaluate("document.querySelector('.self-alert-error').textContent");
    assert.match(errorText, /Could not connect to the server/);
    assert.equal(/[\u0600-\u06ff]/.test(errorText), false, "English connection error must not fall back to Arabic");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile("/tmp/self-network-recovery.png", Buffer.from(screenshot.data, "base64"));
    assert.deepEqual(errors, []);
    console.log("PASS English mobile recovery state, viewport fit and no runtime exceptions");

    const punch = (id, action, occurred_at, shift_date = null) => ({
      id, action, occurred_at, shift_date, session_id: shift_date ? Number(shift_date.slice(-2)) : null,
      latitude: 24, longitude: 46, accuracy: 5,
    });
    historyEvents = [
      punch(1, "check_in", "2026-10-01T04:00:00Z", "2026-10-01"),
      punch(2, "break_start", "2026-10-01T06:00:00Z", "2026-10-01"),
      punch(3, "break_end", "2026-10-01T06:15:00Z", "2026-10-01"),
      punch(4, "break_start", "2026-10-01T08:00:00Z", "2026-10-01"),
      punch(5, "break_end", "2026-10-01T08:10:00Z", "2026-10-01"),
      punch(6, "check_out", "2026-10-01T12:00:00Z", "2026-10-01"),
      punch(7, "check_in", "2026-10-02T16:00:00Z", "2026-10-02"),
      punch(11, "check_in", "2026-10-02T22:00:00Z"),
      punch(8, "break_start", "2026-10-02T23:00:00Z", "2026-10-02"),
      punch(9, "break_end", "2026-10-02T23:10:00Z", "2026-10-02"),
      punch(10, "check_out", "2026-10-03T00:00:00Z", "2026-10-02"),
      punch(12, "check_out", "2026-10-03T04:00:00Z"),
      punch(13, "check_in", "2026-10-31T16:00:00Z", "2026-10-31"),
      punch(14, "check_out", "2026-11-01T00:00:00Z", "2026-10-31"),
    ];
    mode = "ok";
    await fs.mkdir("generated-artifacts/self-attendance-checks", { recursive: true });
    for (language of ["ar", "en"]) for (const width of [1440, 768, 390, 320]) {
      resetCounts(); await open(width);
      await wait(`${ready}&&document.querySelectorAll('.self-attendance-day').length===4`);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.self-attendance-day')].map(r=>r.dataset.day)"),
        ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-31"]);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.self-attendance-day')].map(r=>r.querySelectorAll('.self-attendance-day-event').length)"), [6, 4, 2, 2]);
      assert.deepEqual((await evaluate("[...document.querySelectorAll('.self-attendance-day-event time')].map(t=>t.dateTime)")).sort(),
        historyEvents.map(e => e.occurred_at).sort(), "Every original event timestamp must survive grouping");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day-events')].every(r=>{const boxes=[...r.querySelectorAll('.self-attendance-day-event')].map(e=>e.getBoundingClientRect());return boxes.every(b=>Math.abs(b.top-boxes[0].top)<2||Math.abs(b.top+b.height/2-boxes[0].top-boxes[0].height/2)<2)})"),
        "Each day's operations stay on the same horizontal row");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "No page-wide horizontal overflow");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day-events')].every(r=>r.scrollWidth<=r.clientWidth+1||(r.tabIndex===0&&['auto','scroll'].includes(getComputedStyle(r).overflowX)))"),
        "Overflowing operation rows remain keyboard-accessible and scrollable");
      if (language === "en") assert.equal(await evaluate("/[\\u0600-\\u06ff]/.test(document.querySelector('.self-attendance-day-list').textContent)"), false);
      await evaluate("document.querySelector('.self-attendance-day-list').scrollIntoView({block:'center'})");
      const image = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`generated-artifacts/self-attendance-checks/${language}-${width}.png`, Buffer.from(image.data, "base64"));
      console.log(`PASS ${language}/${width}: four day rows, all fourteen timestamps, repeated breaks, overnight/month boundaries, accessible horizontal layout`);
    }
    assert.deepEqual(errors, []);
  } finally {
    ws?.close();
    if (chrome && chrome.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => chrome.kill("SIGKILL"), 5000);
      chrome.once("exit", () => { clearTimeout(timer); resolve(); });
      chrome.kill("SIGTERM");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
