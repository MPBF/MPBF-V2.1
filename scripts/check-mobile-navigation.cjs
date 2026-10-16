// Browser regression using intercepted API fixtures only; never reads or writes real data.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-navigation-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  let checks = 0;
  let permissions = ["admin"];
  let language = "ar";
  const errors = [];
  const writes = [];
  const verify = (label, actual, expected = true) => {
    assert.deepEqual(actual, expected, label);
    console.log(`PASS ${label}`);
    checks++;
  };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chromium startup timeout")), 20000);
      chrome.stderr.on("data", chunk => {
        output += String(chunk);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.once("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    let serial = 0;
    let session;
    const pending = new Map();
    const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
    });
    ws.on("message", async raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const handler = pending.get(event.id);
        if (!handler) return;
        pending.delete(event.id);
        if (event.error) handler.reject(new Error(event.error.message)); else handler.resolve(event.result);
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      } else if (event.method === "Fetch.requestPaused") {
        try {
          const { requestId, request } = event.params;
          const route = new URL(request.url).pathname.replace(/^\/api/, "");
          if (request.method !== "GET") writes.push(`${request.method} ${route}`);
          const data = route === "/me"
            ? { user: { id: 42, username: "navigation-fixture", display_name: "Navigation fixture",
              display_name_ar: "اختبار القائمة", preferred_language: language, permissions } }
            : route === "/public-branding" ? {} : [];
          await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(data)).toString("base64") });
        } catch (error) { errors.push(error.message); }
      }
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, true);
    session = (await send("Target.attachToTarget", { targetId, flatten: true }, true)).sessionId;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || expression);
      return result.result.value;
    };
    const wait = async expression => {
      for (let n = 0; n < 150; n++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out: ${expression}; browser errors: ${errors.join("; ")}`);
    };
    const origin = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
    const navigate = async route => {
      await send("Page.navigate", { url: origin + route });
      await wait("!!document.querySelector('.shell')&&!!document.querySelector('.mobile-navigation-root')");
    };
    const viewport = async (width, height = 844) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 700 });
    };
    const click = async selector => {
      await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click()})()`);
    };
    const key = async (name, code) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
    };
    const open = async () => {
      await click(".mobile-navigation-more");
      await wait("!!document.querySelector('[role=dialog]')");
      await evaluate("Promise.allSettled(document.getAnimations().map(a=>a.finished))");
    };
    const screenshot = async name => {
      const directory = "generated-artifacts/mobile-navigation";
      await fs.mkdir(directory, { recursive: true });
      const image = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`${directory}/${name}.png`, Buffer.from(image.data, "base64"));
    };
    const expected = ["/", "/my-dashboard", "/customers", "/orders", "/production", "/planning", "/warehouse", "/hr", "/admin"];
    const sheetLinks = "[role=dialog] a[href]";
    for (const currentLanguage of ["ar", "en"]) {
      language = currentLanguage;
      await viewport(390);
      await navigate("/customers");
      await wait(`document.documentElement.lang===${JSON.stringify(language)}`);
      verify(`${language}: bottom bar has four quick links plus More`,
        await evaluate("document.querySelectorAll('.mobile-navigation-bar a').length===4&&!!document.querySelector('.mobile-navigation-more')"));
      verify(`${language}: More label is translated`,
        await evaluate(`document.querySelector('.mobile-navigation-more').textContent.includes(${JSON.stringify(language === "ar" ? "المزيد" : "More")})`));
      await open();
      verify(`${language}: all nine authorized pages are accessible`,
        await evaluate(`[...document.querySelectorAll(${JSON.stringify(sheetLinks)})].map(a=>a.getAttribute('href'))`), expected);
      verify(`${language}: current page marked in the full list`,
        await evaluate("!!document.querySelector('[role=dialog] a[href=\"/customers\"][aria-current=\"page\"]')"));
      verify(`${language}: background cannot receive focus`,
        await evaluate("!!document.querySelector('.content').closest('[inert]')"));
      verify(`${language}: page scrolling locked`, await evaluate("getComputedStyle(document.body).overflow==='hidden'"));
      for (const [width, height] of [[320, 568], [390, 844], [700, 700], [390, 400]]) {
        await viewport(width, height);
        verify(`${language}: ${width}x${height} sheet fits without horizontal overflow`,
          await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1})()"));
        verify(`${language}: ${width}x${height} navigation touch targets remain usable`,
          await evaluate(`[...document.querySelectorAll(${JSON.stringify(sheetLinks)})].every(a=>a.getBoundingClientRect().height>=43.5)`));
        await screenshot(`${language}-${width}x${height}`);
      }
      await evaluate("(()=>{const e=[...document.querySelector('[role=dialog]').querySelectorAll('a[href],button')].filter(e=>e.offsetParent!==null);e[e.length-1].focus()})()");
      await key("Tab", 9);
      verify(`${language}: keyboard focus stays inside sheet`,
        await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)"));
      await key("Escape", 27);
      await wait("!document.querySelector('[role=dialog]')");
      verify(`${language}: Escape restores trigger focus and page scrolling`,
        await evaluate("document.activeElement===document.querySelector('.mobile-navigation-more')&&getComputedStyle(document.body).overflow!=='hidden'&&!document.querySelector('.content').closest('[inert]')"));
      await viewport(390);
      await open();
      await click('[role=dialog] a[href="/admin"]');
      await wait("location.pathname==='/admin'&&!document.querySelector('[role=dialog]')");
      verify(`${language}: More marks the current hidden section`,
        await evaluate("document.querySelector('.mobile-navigation-more').getAttribute('aria-current')==='page'"));
      await open();
      await evaluate("history.pushState(null,'','/orders');window.dispatchEvent(new PopStateEvent('popstate'))");
      await wait("!document.querySelector('[role=dialog]')");
      verify(`${language}: external route change closes the sheet`, await evaluate("getComputedStyle(document.body).overflow!=='hidden'"));
      await open();
      await viewport(1024);
      await wait("!document.querySelector('[role=dialog]')");
      verify(`${language}: desktop sidebar keeps all main pages`,
        await evaluate("[...document.querySelectorAll('.sidebar .nav a')].map(a=>a.getAttribute('href'))"), expected);
      verify(`${language}: desktop hides the mobile bar`,
        await evaluate("getComputedStyle(document.querySelector('.mobile-navigation-root')).display==='none'&&getComputedStyle(document.body).overflow!=='hidden'"));
    }
    language = "ar";
    permissions = ["operate_film"];
    await viewport(390);
    await navigate("/orders");
    verify("minimum film-operator role sees only its permitted main pages",
      await evaluate("[...document.querySelectorAll('.mobile-navigation-bar a')].map(a=>a.getAttribute('href'))"), ["/my-dashboard", "/production"]);
    verify("small navigation lists have no unnecessary More button",
      await evaluate("!document.querySelector('.mobile-navigation-more')"));
    verify("no real or simulated writes needed for navigation", writes, []);
    verify("no uncaught browser exceptions", errors, []);
    console.log(`Mobile navigation passed: ${checks} checks; all API responses used fixtures.`);
  } finally {
    if (ws) ws.close();
    await new Promise(resolve => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("close", resolve);
      chrome.kill("SIGKILL");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
