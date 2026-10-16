// Real Chromium checks. All authentication requests are intercepted; no credentials or writes reach the database.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const response = await fetch(`${base}/api/public-branding`);
  assert.ok(response.ok, "Public branding must load");
  const branding = await response.json();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "login-page-check-"));
  const out = "generated-artifacts/login-checks";
  await fs.mkdir(out, { recursive: true });
  const chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws, serial = 0, sessionId, passed = 0;
  const pending = new Map(), errors = [], logins = [], unknown = [];
  const check = (name, value) => { assert.ok(value, name); passed++; };
  try {
    const address = await new Promise((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.stderr.on("data", chunk => {
        buffer += chunk; const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.once("error", error => { clearTimeout(timer); reject(error); });
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const job = pending.get(event.id); if (!job) return;
        pending.delete(event.id); event.error ? job.reject(Error(event.error.message)) : job.resolve(event.result);
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.text);
      } else if (event.method === "Fetch.requestPaused") {
        void (async () => {
          const { request, requestId } = event.params;
          const route = new URL(request.url).pathname;
          let body, status = 200;
          if (route === "/api/public-branding" && request.method === "GET") body = branding;
          else if (route === "/api/me" && request.method === "GET") { status = 401; body = { message: "Authentication required" }; }
          else if (route === "/api/login" && request.method === "POST") {
            logins.push(JSON.parse(request.postData)); status = 401;
            body = { message: "اسم المستخدم أو كلمة المرور غير صحيحة" };
          } else { unknown.push(`${request.method} ${route}`); status = 404; body = { message: "Fixture blocked request" }; }
          await send("Fetch.fulfillRequest", { requestId, responseCode: status,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(body)).toString("base64") });
        })().catch(error => errors.push(error.message));
      }
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
    await send("Page.enable"); await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
      return result.result?.value;
    };
    const wait = async expression => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const key = async (name, code) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, windowsVirtualKeyCode: code, ...(name === "Enter" ? { text: "\r" } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, windowsVirtualKeyCode: code });
    };
    const setLanguage = async lang => {
      if (await evaluate(`document.documentElement.lang===${JSON.stringify(lang)}`)) return;
      await evaluate("document.querySelector('.flag-language-selector__trigger').focus()");
      await key("ArrowDown", 40);
      await wait("!!document.querySelector('[role=menu]')");
      await evaluate(`document.querySelector('[data-language="${lang}"]').click()`);
      await wait(`document.documentElement.lang===${JSON.stringify(lang)}&&!document.querySelector('[role=menu]')`);
    };
    await send("Page.navigate", { url: base });
    await wait("!!document.querySelector('.login-redesign__form')");
    await evaluate("document.fonts.ready.then(()=>true)");
    if (branding.logoSrc) await wait("document.querySelector('.login-redesign__logo img')?.naturalWidth>0");
    for (const lang of ["ar", "en"]) {
      await setLanguage(lang);
      for (const [width, height] of [[1280, 900], [768, 1024], [390, 844], [320, 568], [844, 390]]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
        await evaluate("window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
        const geometry = await evaluate(`(()=>{const q=s=>document.querySelector(s),rect=s=>q(s).getBoundingClientRect();const order=['.login-redesign__company-ar','.login-redesign__company-en','.login-redesign__logo','#login-welcome','.login-redesign__welcome p','.login-redesign__form'].map(s=>rect(s).top);const container=q('.login-redesign'),center=rect('.login-redesign').left+container.clientLeft+container.clientWidth/2;return {ordered:order.every((y,i)=>!i||y>order[i-1]),overflow:document.documentElement.scrollWidth>innerWidth+1,contained:rect('.login-redesign__card').left>=0&&rect('.login-redesign__card').right<=innerWidth+1,centered:Math.abs(rect('.login-redesign__card').left+rect('.login-redesign__card').width/2-center)<2,names:[q('.login-redesign__company-ar').textContent,q('.login-redesign__company-en').textContent],copy:q('.login-redesign__welcome').textContent,touch:rect('#login-username').height>=44&&rect('.login-redesign__submit').height>=44}})()`);
        check(`${lang}/${width} required content order`, geometry.ordered);
        check(`${lang}/${width} no horizontal overflow`, !geometry.overflow && geometry.contained);
        check(`${lang}/${width} centered card`, geometry.centered);
        check(`${lang}/${width} real bilingual factory names`, geometry.names[0] === branding.companyNameAr && geometry.names[1] === branding.companyNameEn);
        check(`${lang}/${width} touch controls`, geometry.touch);
        if (branding.logoSrc) check(`${lang}/${width} complete logo stays inside its frame`, await evaluate("(()=>{const i=document.querySelector('.login-redesign__logo img'),b=i.parentElement.getBoundingClientRect(),r=i.getBoundingClientRect();return getComputedStyle(i).objectFit==='contain'&&r.top>=b.top&&r.bottom<=b.bottom+1&&r.left>=b.left&&r.right<=b.right+1})()"));
        if (lang === "ar") check(`${width} exact Arabic welcome`, geometry.copy.includes("مرحبا بك في نظام مودرن") && geometry.copy.includes("سجل دخولك الى النظام"));
        await evaluate("document.querySelector('.login-redesign__submit').scrollIntoView({block:'center'})");
        check(`${lang}/${width} submit reachable on short screens`, await evaluate("(()=>{const r=document.querySelector('.login-redesign__submit').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()"));
        await evaluate("window.scrollTo(0,0)");
        const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        await fs.writeFile(path.join(out, `${lang}-${width}x${height}.png`), Buffer.from(screenshot.data, "base64"));
      }
      for (const [id, text] of [["login-username", "fixture-user"], ["login-password", "fixture-only-password"]]) {
        await evaluate(`document.getElementById('${id}').focus();document.getElementById('${id}').select()`);
        await send("Input.insertText", { text });
      }
      await evaluate("document.getElementById('login-username').focus()");
      await key("Tab", 9);
      check(`${lang} keyboard moves from username to password`, await evaluate("document.activeElement.id==='login-password'"));
      await key("Enter", 13);
      await wait("!!document.querySelector('[role=alert]')?.textContent");
      assert.deepEqual(logins.at(-1), { username: "fixture-user", password: "fixture-only-password" });
      check(`${lang} error announced accessibly`, await evaluate("document.querySelector('[role=alert]').getAttribute('aria-live')==='assertive'"));
      if (lang === "en") check("English error has no Arabic fallback", await evaluate("!/[\\u0600-\\u06ff]/.test(document.querySelector('[role=alert]').textContent)"));
      check(`${lang} credentials autocomplete unchanged`, await evaluate("document.getElementById('login-username').autocomplete==='username'&&document.getElementById('login-password').autocomplete==='current-password'&&document.getElementById('login-password').type==='password'"));
    }
    assert.equal(logins.length, 2, "One intercepted submit per language");
    assert.deepEqual(unknown, [], "No unexpected API requests");
    assert.deepEqual(errors, [], "No uncaught browser exceptions");
    console.log(`PASS ${passed} login checks across Arabic/English and five viewport sizes; all login POSTs intercepted.`);
  } finally {
    if (ws) ws.close();
    chrome.kill("SIGTERM");
    await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { const timer = setTimeout(resolve, 2500); chrome.once("exit", () => { clearTimeout(timer); resolve(); }); } });
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
