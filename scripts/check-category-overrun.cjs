// Intercepts every API request: exercises the real UI without authenticating
// a real user or changing real category records.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "category-overrun-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let checks = 0;
  const check = (name, actual, expected = true) => {
    assert.deepEqual(actual, expected, name); console.log(`PASS ${name}`); checks++;
  };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Browser startup timed out")), 15000);
      chrome.stderr.on("data", (chunk) => {
        output += String(chunk);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let id = 0;
    let session;
    const pending = new Map();
    const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
      const serial = ++id;
      pending.set(serial, { resolve, reject });
      ws.send(JSON.stringify({ id: serial, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
    });
    let permissions = ["manage_categories"];
    let rows = [];
    const writes = [];
    const errors = [];
    const fixture = (percentage) => ({ id: "CAT01", code: "CAT01", name: "Test category", name_ar: "تصنيف تجريبي",
      parent_id: null, parent_name: null, parent_name_ar: null, overrun_percentage: percentage });
    const intercept = async ({ requestId, request }) => {
      const route = new URL(request.url).pathname;
      let body = [];
      let status = 200;
      if (request.method !== "GET") {
        assert.ok(["/api/categories", "/api/categories/CAT01"].includes(route), `Unexpected write to ${route}`);
        const payload = JSON.parse(request.postData);
        writes.push({ method: request.method, route, body: payload });
        if (request.method === "POST") {
          body = { ...payload, id: "CAT02", code: "CAT02" }; rows.push(body); status = 201;
        } else {
          rows = rows.map((row) => row.id === "CAT01" ? { ...row, ...payload } : row);
          body = rows[0];
        }
      } else if (route === "/api/me") body = { user: { id: 42, username: "test", display_name_ar: "مستخدم تجريبي", permissions } };
      else if (route === "/api/categories") body = rows;
      else if (route === "/api/public-branding") body = { companyNameAr: "مصنع تجريبي", companyNameEn: "Test Factory", logoSrc: "" };
      await send("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") });
    };
    ws.on("message", (raw) => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const waiter = pending.get(event.id); pending.delete(event.id);
        if (event.error) waiter.reject(Error(event.error.message)); else waiter.resolve(event.result);
      } else if (event.method === "Fetch.requestPaused") intercept(event.params).catch((error) => errors.push(error.message));
      else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, true)).sessionId;
    await send("Page.enable"); await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
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
    const navigate = () => send("Page.navigate", { url: `${origin}/admin` });
    const clickButton = (text) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent!==null&&b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click();})()`);
    const setInput = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    for (const width of [390, 768, 1280]) {
      rows = [fixture(0)];
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await navigate();
      await wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('إضافة تصنيف'))");
      await clickButton("إضافة تصنيف");
      await wait("!!document.querySelector('#field-overrun_percentage')&&[...document.querySelectorAll('form button')].some(b=>b.type==='submit'&&!b.disabled)");
      check(`${width}: new category defaults to 0%`, await evaluate("document.querySelector('#field-overrun_percentage').value"), "0");
      check(`${width}: exactly the four requested percentages`, await evaluate("[...document.querySelector('#field-overrun_percentage').options].map(o=>o.textContent)"), ["0%", "5%", "10%", "20%"]);
      check(`${width}: field label and layout fit screen`, await evaluate("document.querySelector('label[for=field-overrun_percentage]').textContent==='نسبة الزيادة في الإنتاج'&&document.querySelector('#field-overrun_percentage').getBoundingClientRect().left>=0&&document.querySelector('#field-overrun_percentage').getBoundingClientRect().right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth"));
      await setInput("#field-name", "New test category");
      await setInput("#field-overrun_percentage", "20");
      await evaluate("document.querySelector('#field-overrun_percentage').closest('form').requestSubmit()");
      await wait("!document.querySelector('#field-overrun_percentage')");
      check(`${width}: create saves numeric 20, not formatted text`, writes.at(-1).body.overrun_percentage, 20);
      rows = [fixture(10)];
      await navigate();
      await wait("!!document.querySelector('[aria-label=\"تعديل تصنيف\"]')");
      await evaluate("[...document.querySelectorAll('[aria-label=\"تعديل تصنيف\"]')].find(e=>e.offsetParent!==null).click()");
      await wait("!!document.querySelector('#field-overrun_percentage')&&[...document.querySelectorAll('form button')].some(b=>b.type==='submit'&&!b.disabled)");
      check(`${width}: edit loads the saved 10%`, await evaluate("document.querySelector('#field-overrun_percentage').value"), "10");
      await fs.mkdir("screenshots", { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`screenshots/category-overrun-${width}.png`, Buffer.from(shot.data, "base64"));
      await setInput("#field-overrun_percentage", "5");
      await evaluate("document.querySelector('#field-overrun_percentage').closest('form').requestSubmit()");
      await wait("!document.querySelector('#field-overrun_percentage')");
      check(`${width}: edit saves numeric 5 and keeps the category identity`, {
        method: writes.at(-1).method, route: writes.at(-1).route, percentage: writes.at(-1).body.overrun_percentage,
      }, { method: "PUT", route: "/api/categories/CAT01", percentage: 5 });
      await wait("document.body?.textContent?.includes('5%')");
    }
    permissions = ["view_orders"];
    await navigate();
    await wait("document.body?.textContent?.includes('تصنيف تجريبي')");
    check("read-only users cannot create or edit categories", await evaluate("!document.querySelector('[aria-label=\"تعديل تصنيف\"]')&&![...document.querySelectorAll('button')].some(b=>b.textContent.includes('إضافة تصنيف'))"));
    check("no browser errors", errors, []);
    console.log(`Category overrun passed ${checks} checks using isolated fixtures only.`);
  } finally {
    if (ws) ws.close();
    await new Promise((resolve) => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("close", resolve); chrome.kill("SIGKILL");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });