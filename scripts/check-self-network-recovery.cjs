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
  let attendanceOverrides = {};
  let adminView = false, allowFixtureWrites = false;
  const fixtureWrites = [], fixtureReads = [];
  const fixtureRequests = [{
    id: 701, user_id: 42, user_name: "Test Employee", type: "leave", title: "Legacy approved leave",
    details: "Approved request awaiting its explicit period", status: "approved", response: "Original reply",
    created_at: "2026-10-01T08:00:00Z", responded_at: "2026-10-02T08:00:00Z",
    leave_start_date: null, leave_end_date: null,
  }];
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
        const fixtureWrite = allowFixtureWrites && (
          request.method === "POST" && url.pathname === "/api/self/requests"
          || request.method === "PATCH" && /^\/api\/self\/admin\/requests\/\d+$/.test(url.pathname));
        assert.ok(request.method === "GET" || fixtureWrite, "Only explicit intercepted fixture writes are allowed; never forward a write to the app");
        let body = [];
        if (request.method === "GET") fixtureReads.push(url.pathname + url.search);
        if (url.pathname === "/api/me") body = { user: {
          id: 42, username: "fixture", display_name: "Test Employee", display_name_ar: "موظف تجريبي",
          preferred_language: language, permissions: adminView ? ["admin"] : [],
        } };
        if (fixtureWrite) {
          const payload = JSON.parse(request.postData);
          fixtureWrites.push({ method: request.method, path: url.pathname, payload });
          if (request.method === "POST") {
            body = { id: 800 + fixtureWrites.length, user_id: 42, user_name: "Test Employee", ...payload, status: "pending", response: null, created_at: "2026-10-05T08:00:00Z" };
            fixtureRequests.unshift(body);
          } else {
            const row = fixtureRequests.find(row => row.id === Number(url.pathname.split("/").pop()));
            assert.ok(row, "Fixture correction must target a known fixture only");
            Object.assign(row, payload);
            body = row;
          }
        }
        if (request.method === "GET" && url.pathname === "/api/self/admin/requests") body =
          url.searchParams.get("missing_leave_dates") === "1"
            ? fixtureRequests.filter(row => row.type === "leave" && row.status === "approved" && (!row.leave_start_date || !row.leave_end_date))
            : fixtureRequests;
        if (url.pathname === "/api/public-branding") body = { companyNameAr: "مصنع تجريبي", companyNameEn: "Test Factory", logoSrc: "" };
        if (url.pathname === "/api/hr/data") body = { shifts: [], users: [], history: [] };
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
            ...attendanceOverrides,
          };
          if (endpoint === "requests" && allowFixtureWrites && request.method === "GET") body = fixtureRequests;
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
    if (!process.argv.includes("--forms-only")) {
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
    attendanceOverrides = {
      currentSession: { id: 21, shiftDate: "2026-10-16", incomplete: false },
      unresolvedIncompleteSession: { id: 20, shiftDate: "2026-10-13" },
    };
    await fs.mkdir("generated-artifacts/self-attendance-checks", { recursive: true });
    for (language of ["ar", "en"]) for (const width of [1440, 768, 390, 320]) {
      resetCounts(); await open(width);
      await wait(`${ready}&&document.querySelectorAll('.self-attendance-day').length===4`);
      assert.equal(await evaluate("document.querySelectorAll('.self-attendance-stat').length"), 0, "Remove the days aside, not just its text");
      assert.ok(await evaluate("(()=>{const p=document.querySelector('.self-attendance'),m=p.querySelector('.self-attendance-main');return p.children.length===1&&Math.abs(m.getBoundingClientRect().width-p.clientWidth)<2})()"),
        "Biometric content fills the available panel width");
      assert.ok(await evaluate("(()=>{const t=document.querySelector('.self-attendance-main').textContent;return !['الموقع إلزامي لكل تسجيل.','تاريخ احتساب الوردية:','2026-10-16','2026-10-13'].some(x=>t.includes(x))})()"),
        "Specified informational text is absent even when session metadata exists");
      assert.equal(await evaluate("document.querySelector('.self-summary-item strong').textContent"), "7", "Preserve the top monthly attendance metric");
      assert.equal(await evaluate("document.querySelectorAll('.self-attendance-btn').length"), 4, "Preserve every attendance action");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-btn')].every(b=>b.disabled)"), "No shift must still prevent attendance actions");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.self-attendance-day')].map(r=>r.dataset.day)"),
        ["2026-10-31", "2026-10-03", "2026-10-02", "2026-10-01"], "Newest accounting day is first");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.self-attendance-day')].map(r=>r.querySelectorAll('.self-attendance-day-event').length)"), [2, 2, 4, 6]);
      assert.deepEqual((await evaluate("[...document.querySelectorAll('.self-attendance-day-event time')].map(t=>t.dateTime)")).sort(),
        historyEvents.map(e => e.occurred_at).sort(), "Every original event timestamp must survive grouping");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day')].every(r=>{const date=r.querySelector('.self-attendance-day-date').getBoundingClientRect(),events=r.querySelector('.self-attendance-day-events').getBoundingClientRect();return events.top>=date.bottom&&Math.abs(date.left-events.left)<3})"),
        "Each date appears above its own attendance details at every width");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day-event')].every(r=>{const box=r.getBoundingClientRect();return [...r.children].every(c=>{const b=c.getBoundingClientRect();return b.left>=box.left-1&&b.right<=box.right+1&&b.bottom<=box.bottom+1})})"),
        "Wrapped attendance cards retain all action names, times and overnight dates without clipping");
      assert.ok((await evaluate("document.querySelector('[data-day=\"2026-10-01\"] .self-attendance-day-date').textContent")).includes(language === "ar" ? "الخميس" : "Thursday"),
        "The full date keeps its weekday");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true, "No page-wide horizontal overflow");
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day-events')].every(r=>r.scrollWidth<=r.clientWidth+1||(r.tabIndex===0&&['auto','scroll'].includes(getComputedStyle(r).overflowX)))"),
        "Overflowing operation rows remain keyboard-accessible and scrollable");
      if (language === "en") assert.equal(await evaluate("/[\\u0600-\\u06ff]/.test(document.querySelector('.self-attendance-day-list').textContent)"), false);
      attendanceOverrides.dayStatuses = [
        { day: "2026-10-04", status: "absent" }, { day: "2026-10-05", status: "leave" },
        { day: "2026-10-01", status: "absent" },
      ];
      await evaluate("document.querySelector('.page-hero-refresh').click()");
      await wait(`${ready}&&document.querySelectorAll('.self-attendance-day').length===6`);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.self-attendance-day')].map(r=>r.dataset.day)"),
        ["2026-10-31", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"],
        "Attendance, absence and leave share the same newest-first ordering");
      const absentLabel = language === "ar" ? "غائب" : "Absent", leaveLabel = language === "ar" ? "إجازة" : "Leave";
      assert.ok((await evaluate("document.querySelector('[data-day=\"2026-10-04\"]').textContent")).includes(absentLabel));
      assert.ok((await evaluate("document.querySelector('[data-day=\"2026-10-05\"]').textContent")).includes(leaveLabel));
      assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-day-status')].every(s=>s.getBoundingClientRect().top>=s.closest('.self-attendance-day').querySelector('time').getBoundingClientRect().bottom)"),
        "Absent and leave labels also appear below their respective dates");
      assert.equal(await evaluate("document.querySelector('[data-day=\"2026-10-01\"]').querySelectorAll('.self-attendance-day-event').length"), 6);
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "No page-wide overflow after adding day statuses");
      await evaluate("document.querySelector('.self-attendance-day-list').scrollIntoView({block:'center'})");
      const image = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`generated-artifacts/self-attendance-checks/${language}-${width}.png`, Buffer.from(image.data, "base64"));
      console.log(`PASS ${language}/${width}: original events and timestamps preserved; absent/leave rows localized, conflict-free and responsive`);
      delete attendanceOverrides.dayStatuses;
    }
    historyEvents = [];
    attendanceOverrides.dayStatuses = [{ day: "2026-10-04", status: "absent" }, { day: "2026-10-05", status: "leave" }];
    await open(390); await wait(`${ready}&&document.querySelectorAll('.self-attendance-day').length===2`);
    attendanceOverrides.absenceAssessmentBlocked = true;
    await evaluate("document.querySelector('.page-hero-refresh').click()");
    await wait(`${ready}&&!!document.querySelector('.self-attendance-assessment-note')`);
    assert.equal(await evaluate("!!document.querySelector('[data-day=\"2026-10-04\"]')"), false);
    assert.equal(await evaluate("!!document.querySelector('[data-day=\"2026-10-05\"]')"), true);
    console.log("PASS status-only month and ambiguous legacy-leave notice; no false absence");
    attendanceOverrides.absenceAssessmentBlocked = false;
    delete attendanceOverrides.dayStatuses;
    attendanceOverrides = {
      ...attendanceOverrides,
      status: "working",
      activeShift: { id: "fixture-shift", name: "Test shift", startTime: "07:00", endTime: "15:00", geofenceStatus: "enabled", radiusMeters: 100 },
      withinShiftWindow: false,
    };
    await open(1440); await wait(ready);
    assert.ok(await evaluate("[...document.querySelectorAll('.self-attendance-btn')].every(b=>b.disabled)&&!!document.querySelector('.self-window-warning')"),
      "Out-of-window warning and disabled actions remain");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(_success,error){error({code:1,PERMISSION_DENIED:1})}}})" });
    attendanceOverrides.withinShiftWindow = true;
    await open(390);
    await wait(`${ready}&&!document.querySelector('.self-attendance-btn.action-break_start').disabled`);
    await evaluate("document.querySelector('.self-attendance-btn.action-break_start').click()");
    await wait(`${ready}&&!!document.querySelector('.self-alert-error')`);
    assert.match(await evaluate("document.querySelector('.self-alert-error').textContent"), /location/i);
    console.log("PASS full-width biometric panel; removed only requested copy/aside; top metrics, disabled/window guards and mandatory geolocation remain");
    }
    mode = "ok";
    await fs.mkdir("generated-artifacts/self-attendance-checks", { recursive: true });
    const fill = (id, value) => evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
    allowFixtureWrites = true;
    await open(390); await wait(ready);
    await fill("self-request-title", "Annual leave");
    await fill("self-request-details", "Fixture request only");
    await fill("self-request-leave-start", "2026-10-08");
    await fill("self-request-leave-end", "2026-10-07");
    assert.equal(await evaluate("document.getElementById('self-request-title').closest('form').checkValidity()"), false);
    await fill("self-request-leave-end", "2026-10-09");
    await evaluate("document.getElementById('self-request-title').closest('form').querySelector('[type=submit]').click()");
    await wait(`${ready}&&!!document.querySelector('.self-alert-success')`);
    assert.deepEqual(fixtureWrites.at(-1).payload, { type: "leave", title: "Annual leave", details: "Fixture request only", leave_start_date: "2026-10-08", leave_end_date: "2026-10-09" });
    const pendingLeaveId = fixtureRequests[0].id;
    await fill("self-request-type", "permission");
    assert.equal(await evaluate("!!document.getElementById('self-request-leave-start')"), false);
    await fill("self-request-title", "Permission");
    await fill("self-request-details", "Fixture permission only");
    await evaluate("document.getElementById('self-request-title').closest('form').querySelector('[type=submit]').click()");
    await wait(`${ready}&&!!document.querySelector('.self-alert-success')`);
    assert.equal(fixtureWrites.at(-1).payload.type, "permission");
    assert.equal("leave_start_date" in fixtureWrites.at(-1).payload, false);
    console.log("PASS employee leave dates: required/reversed-range validation, actual submitted date payload, no dates on other request types");
    adminView = true;
    const openAdmin = async width => {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await evaluate("window.__selfFixtureNavigating=true");
      await send("Page.navigate", { url: `${origin}/hr` });
      await wait("(()=>{if(window.__selfFixtureNavigating)return false;const t=[...document.querySelectorAll('button[role=tab]')].find(b=>/الطلبات الإدارية|administrative requests/i.test(b.textContent));if(!t)return false;if(t.getAttribute('aria-selected')!=='true')t.click();return !!document.getElementById('admin-leave-start-701')&&!!document.querySelector('.self-refresh:not([disabled])')})()");
    };
    await openAdmin(1440);
    await evaluate("document.querySelector('.self-admin-missing-leave-filter input').click()");
    await wait("!!document.getElementById('admin-leave-start-701')&&!document.getElementById('admin-leave-start-" + pendingLeaveId + "')&&!!document.querySelector('.self-refresh:not([disabled])')");
    assert.ok(fixtureReads.includes("/api/self/admin/requests?missing_leave_dates=1"));
    const beforeInvalidReview = fixtureWrites.length;
    await evaluate("[...document.getElementById('admin-leave-start-701').closest('article').querySelectorAll('button')].at(-1).click()");
    await wait("!!document.querySelector('.self-alert-error')");
    assert.equal(fixtureWrites.length, beforeInvalidReview, "Do not approve an undated leave");
    await fill("admin-leave-start-701", "2026-10-02");
    await fill("admin-leave-end-701", "2026-10-03");
    await evaluate("document.getElementById('admin-leave-start-701').closest('article').querySelector('button').click()");
    await wait("!document.getElementById('admin-leave-start-701')&&!!document.querySelector('.self-alert-success')");
    assert.deepEqual(fixtureWrites.at(-1).payload, { leave_start_date: "2026-10-02", leave_end_date: "2026-10-03" });
    assert.equal(fixtureRequests.find(row => row.id === 701).status, "approved");
    assert.equal(fixtureRequests.find(row => row.id === 701).response, "Original reply");
    await evaluate("document.querySelector('.self-admin-missing-leave-filter input').click()");
    await wait("!!document.getElementById('admin-leave-start-" + pendingLeaveId + "')&&!!document.querySelector('.self-refresh:not([disabled])')");
    await evaluate("[...document.getElementById('admin-leave-start-" + pendingLeaveId + "').closest('article').querySelectorAll('button')].at(-1).click()");
    await wait("!!document.querySelector('.self-alert-success')&&!!document.querySelector('.self-refresh:not([disabled])')");
    assert.equal(fixtureWrites.at(-1).payload.status, "approved");
    assert.equal(fixtureWrites.at(-1).payload.leave_start_date, "2026-10-08");
    assert.equal(fixtureWrites.at(-1).payload.leave_end_date, "2026-10-09");
    for (const locale of ["ar", "en"]) for (const width of [1440, 390]) {
      language = locale;
      await openAdmin(width);
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "Responsive admin date controls");
      if (locale === "en") assert.equal(await evaluate("/[\\u0600-\\u06ff]/.test(document.querySelector('.self-admin-missing-leave-filter').textContent)"), false);
      await evaluate("document.getElementById('admin-leave-start-701').closest('article').scrollIntoView({block:'center'})");
      const image = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`generated-artifacts/self-attendance-checks/admin-leave-${locale}-${width}.png`, Buffer.from(image.data, "base64"));
    }
    console.log("PASS admin missing-date filter, dates-only legacy correction preserving approval/response, dated approval, Arabic/English desktop/mobile");
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
