// Real browser input against built UI + synthetic API fixtures only.
// Run after npm run build: node scripts/check-general-modals.cjs
// Customer/production dialogs and the standalone product form have separate checks.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

(async () => {
  const root = path.resolve("dist/public");
  await fs.access(path.join(root, "index.html"));
  const leakedAPI = [];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://fixture.test").pathname;
    if (pathname.startsWith("/api/")) {
      leakedAPI.push(`${req.method} ${pathname}`);
      res.writeHead(500).end("API must be intercepted");
      return;
    }
    try {
      const file = pathname.startsWith("/assets/") ? path.resolve(root, `.${pathname}`) : path.join(root, "index.html");
      assert.ok(file.startsWith(`${root}/`));
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      res.writeHead(200, { "Content-Type": type });
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "general-modals-"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws, session, serial = 0, checks = 0;
  const pending = new Map(), errors = [], requests = [], writes = [], nativeDialogs = [];
  let permissions = ["admin"];
  const records = {
    users: [{ id: 81, username: "modal-fixture", display_name: "Modal fixture", display_name_ar: "مستخدم تجريبي", role_id: 82, status: "active" }],
    roles: [{ id: 82, name: "Fixture role", name_ar: "دور تجريبي", permissions: ["view_user_dashboard"], production_role_binding: { mode: "general", stages: [] } }],
    sections: [{ id: "S81", name: "Fixture section", name_ar: "قسم تجريبي" }],
  };
  const original = JSON.stringify(records);
  const verify = (label, value, expected = true) => {
    assert.deepEqual(value, expected, label);
    checks++;
    console.log(`PASS ${label}`);
  };
  const send = (method, params = {}, browser = false) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params, ...(!browser && session ? { sessionId: session } : {}) }));
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chromium startup timeout")), 20000);
      chrome.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.once("error", error => { clearTimeout(timer); reject(error); });
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const respond = async ({ requestId, request }) => {
      const route = new URL(request.url).pathname.slice(4);
      requests.push(`${request.method} ${route}`);
      let data;
      if (request.method !== "GET") {
        writes.push({ route, method: request.method, body: request.postData });
        // No live writes; deliberately reject unexpected mutations instead of
        // silently claiming success.
        throw new Error(`Unexpected mutation: ${request.method} ${route}`);
      }
      if (route === "/me") data = { user: { id: 42, username: "modal-test", preferred_language: "ar", permissions } };
      else if (route === "/public-branding") data = {};
      else if (route === "/customers") data = [];
      else if (Object.hasOwn(records, route.slice(1))) data = records[route.slice(1)];
      else throw new Error(`Missing API fixture: ${route}`);
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(data)).toString("base64") });
    };
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const handler = pending.get(event.id);
        if (!handler) return;
        pending.delete(event.id);
        if (event.error) handler.reject(new Error(event.error.message)); else handler.resolve(event.result);
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      } else if (event.method === "Page.javascriptDialogOpening") {
        nativeDialogs.push(event.params);
      } else if (event.method === "Fetch.requestPaused") {
        respond(event.params).catch(async error => {
          errors.push(error.message);
          await send("Fetch.fulfillRequest", { requestId: event.params.requestId, responseCode: 500, body: "" });
        });
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
      for (let n = 0; n < 100; n++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${expression}\n${JSON.stringify({ errors, requests: requests.slice(-8), active: await evaluate("document.activeElement?.outerHTML.slice(0,250)") })}`);
    };
    const pointer = async selector => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`);
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element&&a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      const point = await evaluate(`(()=>{
        const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        return {x,y,hit:x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))};
      })()`);
      verify(`real pointer reaches ${selector}`, point.hit);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    };
    const escape = async () => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    };
    const navigate = async tab => {
      const defaultTab = permissions.includes("admin") || permissions.includes("manage_users") ? "users" : "roles";
      // Page.navigate can return while the old document still has admin tabs.
      await evaluate("window.__oldModalDocument=true");
      await send("Page.navigate", { url: `${origin}/admin` });
      // Wait for the lazy default panel too: clicking a tab before its
      // Suspense boundary settles can target a soon-to-be-replaced button.
      await wait(`!window.__oldModalDocument&&!!document.querySelector('#admin-panel-${defaultTab} .actions button')&&!document.querySelector('#admin-panel-${defaultTab} [aria-busy=true]')`);
      if (tab !== defaultTab) await pointer(`#admin-tab-${tab}`);
      await wait(`!!document.querySelector('#admin-panel-${tab} .btn-primary')&&!document.querySelector('#admin-panel-${tab} [aria-busy=true]')`);
    };
    const open = async tab => {
      await pointer(`#admin-panel-${tab} .page-heading .btn-primary`);
      await wait("!!document.querySelector('.modal-backdrop [role=dialog]')");
      if (tab === "users") await wait("document.querySelector('[role=dialog] footer .btn-primary')?.disabled===false");
    };
    const assertFocus = async selector => {
      await wait(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
      verify(`focus restored to ${selector}`, await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`));
    };
    const navigationAfterClose = async width => {
      const selector = width === 390 ? '.mobile-navigation-bar a[href="/customers"]' : '.sidebar .nav a[href="/customers"]';
      await pointer(selector);
      await wait("location.pathname==='/customers'&&!!document.querySelector('#customer-tab-customers')");
      verify(`${width}: navigation works after close`, await evaluate("!document.querySelector('.modal-backdrop')&&!document.querySelector('.mobile-navigation-sheet')&&getComputedStyle(document.body).overflow!=='hidden'"));
    };
    const covered = async (width, label) => {
      verify(`${width} ${label}: dialog fits horizontally`, await evaluate("document.documentElement.scrollWidth<=innerWidth&&document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth"));
      if (width !== 390) return;
      verify(`${label}: backdrop wins actual navigation hit areas`, await evaluate(`(()=>{
        const r=document.querySelector('.mobile-navigation-bar').getBoundingClientRect();
        return r.height>0&&[.1,.5,.9].every(p=>!!document.elementFromPoint(r.left+r.width*p,r.top+r.height/2)?.closest('.modal-backdrop'));
      })()`));
      // A real tap where navigation lives must not navigate or open More.
      const point = await evaluate("(()=>{const r=document.querySelector('.mobile-navigation-bar').getBoundingClientRect();return{x:r.left+4,y:r.top+r.height/2}})()");
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      await wait("!document.querySelector('.modal-backdrop')");
      verify(`${label}: tap cannot activate underlying navigation`, await evaluate("location.pathname==='/admin'&&!document.querySelector('.mobile-navigation-sheet')"));
    };
    const nativeConfirm = async (selector, accept, message) => {
      const before = nativeDialogs.length;
      // Headless Chromium exposes native browser dialogs through CDP, not the
      // page DOM. Use actual pointer input to trigger them; never stub confirm().
      const clicking = pointer(selector);
      for (let n = 0; n < 100 && nativeDialogs.length === before; n++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(nativeDialogs.length, before + 1, "native confirmation opened");
      verify("native confirm has expected message", nativeDialogs.at(-1).type === "confirm" && nativeDialogs.at(-1).message.includes(message));
      // CDP dismiss models Cancel/Escape for browser chrome; application Escape
      // is tested separately with actual keyboard events below.
      await send("Page.handleJavaScriptDialog", { accept });
      await clicking;
    };
    // Inventory of exact shared-backdrop owners: fail when another owner is
    // introduced without deciding which isolated regression suite covers it.
    const owners = [];
    const scan = async dir => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (file.endsWith(".tsx") && /className="modal-backdrop(?:[" ])/.test(await fs.readFile(file, "utf8"))) owners.push(file);
      }
    };
    await scan("client/src");
    verify("all exact shared-backdrop owners accounted for", owners.sort(), [
      "client/src/App.tsx", "client/src/components/CustomerModal.tsx", "client/src/components/ProductionOrderModal.tsx",
      "client/src/pages/admin/RolesAdmin.tsx", "client/src/pages/admin/UsersAdmin.tsx",
    ].sort());
    for (const width of [390, 768, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
      for (const tab of ["users", "roles", "sections"]) {
        await navigate(tab);
        const opener = `#admin-panel-${tab} .page-heading .btn-primary`;
        const field = tab === "users" ? "#user-username" : tab === "roles" ? "#role-name" : "#field-name";
        await open(tab);
        await pointer(field);
        await covered(width, tab);
        if (width === 390) {
          await assertFocus(opener);
          await open(tab);
        }
        await pointer(field);
        await pointer('[role=dialog] footer button[type=button]');
        await wait("!document.querySelector('.modal-backdrop')");
        await assertFocus(opener);
        await navigationAfterClose(width);
        await navigate(tab);
        await open(tab);
        await pointer(field);
        await escape();
        await wait("!document.querySelector('.modal-backdrop')");
        await assertFocus(opener);
        await navigationAfterClose(width);
      }
      await navigate("roles");
      await open("roles");
      await pointer("#role-name");
      await send("Input.insertText", { text: "Unsaved role draft" });
      const adminToggle = '.permission-group:first-child input[type=checkbox]';
      await evaluate(`document.querySelector(${JSON.stringify(adminToggle)}).dataset.testAdminToggle="true"`);
      await nativeConfirm(adminToggle, false, "تغيير صلاحية مدير النظام");
      verify(`${width}: dismiss nested confirm leaves role editor and permission unchanged`,
        await evaluate("document.querySelector('#role-name')?.value==='Unsaved role draft'&&!document.querySelector('[data-test-admin-toggle]').checked&&location.pathname==='/admin'&&!document.querySelector('.mobile-navigation-sheet')"));
      await assertFocus(adminToggle);
      await nativeConfirm(adminToggle, true, "تغيير صلاحية مدير النظام");
      verify(`${width}: accepting explicit grant changes draft only`, await evaluate("document.querySelector('[data-test-admin-toggle]').checked"), true);
      await assertFocus(adminToggle);
      await escape();
      await wait("!document.querySelector('.modal-backdrop')");
      await assertFocus("#admin-panel-roles .page-heading .btn-primary");
      await navigationAfterClose(width);
      for (const [tab, label, message] of [
        ["users", "حذف المستخدم", "تأكيد حذف المستخدم"],
        ["roles", "حذف دور", "تأكيد حذف الدور"],
        ["sections", "حذف قسم", "تأكيد حذف السجل"],
      ]) {
        await navigate(tab);
        // Table and mobile-card delete controls coexist. Mark the actually
        // visible one, never the hidden desktop copy.
        await wait(`Array.from(document.querySelectorAll('button[aria-label^="${label}"]')).some(e=>e.offsetParent!==null)`);
        await evaluate(`Array.from(document.querySelectorAll('button[aria-label^="${label}"]')).find(e=>e.offsetParent!==null).dataset.testDelete='true'`);
        await nativeConfirm("[data-test-delete]", false, message);
        await assertFocus("[data-test-delete]");
        verify(`${width} ${tab}: cancelling native deletion preserves record and route`,
          await evaluate("location.pathname==='/admin'&&!!document.querySelector('[data-test-delete]')&&!document.querySelector('.modal-backdrop')"));
        await navigationAfterClose(width);
      }
    }
    // Minimum roles: do not make the fixture actor admin to hide a permission bug.
    permissions = ["manage_roles"];
    await navigate("roles");
    await open("roles");
    verify("non-admin cannot grant guarded admin permission", await evaluate("document.querySelector('.permission-group:first-child input').disabled"));
    await escape();
    verify("cancelled/draft confirmation flows never write", writes, []);
    verify("fixtures remain unchanged", JSON.stringify(records), original);
    verify("all APIs intercepted; static host received none", leakedAPI, []);
    verify("no runtime or fixture errors", errors, []);
    console.log(`General modal checks passed: ${checks}; 390/768/1280px, fixture APIs only.`);
  } finally {
    if (ws) ws.close();
    await new Promise(resolve => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("close", resolve);
      chrome.kill("SIGKILL");
    });
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
