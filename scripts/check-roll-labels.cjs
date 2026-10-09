// Fixture-only browser and physical-page PDF checks. EVERY app API is intercepted.
// Run with the development workflow serving: node scripts/check-roll-labels.cjs
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const QRCode = require("qrcode");
const esbuild = require("esbuild");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const jsLiteral = value => JSON.stringify(value).replace(/[<>&/\u2028\u2029]/g, char => ({
  "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "/": "\\u002f", "\u2028": "\\u2028", "\u2029": "\\u2029",
})[char]);

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "roll-label-check-"));
  await esbuild.build({
    entryPoints: ["client/src/pages/production/roll-label-document.ts"],
    outfile: path.join(temp, "renderer.cjs"), bundle: true, platform: "node", format: "cjs",
  });
  const { buildRollLabelDocument } = require(path.join(temp, "renderer.cjs"));
  const chrome = spawn(process.env.CHROMIUM_PATH || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${path.join(temp, "profile")}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  let ws, serial = 0, passed = 0, language = "en", failure = "", permissions = ["operate_film"];
  const pending = new Map(), errors = [], requests = [], historyRequests = [];
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); console.log(`PASS ${name}`); passed++; };
  const product = { id: 1, item_id: "ITM01", name: "Film bag", name_ar: "كيس بلاستيك", customer_name: "Fixture", customer_name_ar: "اختبار" };
  const rolls = Array.from({ length: 105 }, (_, index) => ({
    id: index + 1, production_order_id: 1, roll_number: `PO-00001-R${String(index + 1).padStart(3, "0")}`,
    production_order_number: "PO-00001", weight_kg: index ? "19.50" : "57.25", batch_number: index ? null : "BATCH-001",
    stage: "done", film_machine_id: "F1", created_by: 42, created_at: "2026-10-04T03:00:00Z",
    production_minutes: 10, is_last_roll: false, printing_machine_id: null, printed_by: null, printed_at: null,
    cutting_machine_id: null, cut_by: null, cut_completed_at: null, net_weight_kg: null, waste_kg: "0.00",
    product, is_printed: false, is_roll_product: false,
  }));
  const images = await Promise.all(rolls.map(roll => QRCode.toDataURL(`https://factory.example.test/production/rolls/${roll.id}`, {
    width: 600, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" },
  })));
  const label = roll => ({ roll, qr: { url: `https://factory.example.test/production/rolls/${roll.id}`, image: images[roll.id - 1] } });
  // Completed rolls never come from active/scoped state feeds.
  const state = { orders: [], rolls: [], machines: [], queues: [], locations: [], inventory: [], movements: [], receipts: [] };
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Chromium startup timeout")), 15000);
      chrome.stderr.on("data", chunk => {
        output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.on("error", reject);
    });
    ws = new WebSocket(address);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    ws.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.id) {
        const p = pending.get(event.id);
        if (p) { pending.delete(event.id); event.error ? p.reject(Error(JSON.stringify(event.error))) : p.resolve(event.result); }
      } else if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      } else if (event.method === "Fetch.requestPaused") void (async () => {
        const { request, requestId } = event.params;
        const route = new URL(request.url).pathname;
        let body = {}, status = 200;
        if (route === "/api/me") body = { user: { id: 42, username: "fixture", display_name: "Fixture", display_name_ar: "اختبار", preferred_language: language, permissions } };
        else if (route === "/api/public-branding") body = {};
        else if (route === "/api/production/state") body = state;
        else if (route === "/api/production/labels" && request.method === "GET") {
          const params = new URL(request.url).searchParams;
          historyRequests.push(Object.fromEntries(params));
          const before = Number(params.get("before") || Infinity), limit = Number(params.get("limit") || 50);
          assert.ok(limit <= 100, "Label discovery must remain bounded");
          const search = (params.get("search") || "").toLowerCase();
          const records = rolls.filter(roll => roll.id < before &&
            `${roll.roll_number} ${roll.production_order_number}`.toLowerCase().includes(search)).sort((a,b) => b.id-a.id);
          body = { records: records.slice(0, limit), next: records.length > limit ? records[limit - 1].id : null };
        } else if (route === "/api/production/labels") {
          const input = JSON.parse(request.postData || "{}");
          requests.push(input.roll_ids);
          body = { labels: input.roll_ids.map(id => label(rolls.find(roll => roll.id === id))) };
          if (failure === "fetch") { status = 403; body = { message: "صلاحية مرفوضة للاختبار", message_en: "Fixture permission denied." }; }
          if (failure === "missing") body.labels.pop();
          if (failure === "duplicate") body.labels = [body.labels[0], body.labels[0]];
          if (failure === "image") body.labels[0].qr.image = "data:image/png;base64,AAAA";
        } else if (/^\/api\/production\/rolls\/\d+\/qr$/.test(route)) body = label(rolls[0]).qr;
        else if (/^\/api\/production\/rolls\/\d+$/.test(route)) body = rolls[Number(route.split("/").pop()) - 1];
        else {
          // Never forward unknown API requests to the working database.
          assert.equal(request.method, "GET", `Unexpected business write ${route}`);
          body = [];
        }
        await send("Fetch.fulfillRequest", { requestId, responseCode: status,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") }, event.sessionId);
      })().catch(error => errors.push(error.message));
    });
    const page = async () => {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
      return { targetId, sessionId };
    };
    const evaluate = async (expression, sessionId) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async (expression, sessionId) => {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression, sessionId)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error(`Timeout ${expression}`);
    };
    const pdfPage = await page();
    const content = async html => {
      const { frameTree } = await send("Page.getFrameTree", {}, pdfPage.sessionId);
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html }, pdfPage.sessionId);
      await wait("[...document.images].every(i=>i.complete&&i.naturalWidth>0)", pdfPage.sessionId);
      await evaluate("document.fonts.ready.then(()=>true)", pdfPage.sessionId);
    };
    // Real print-to-PDF, not merely emulated continuous print-media layout.
    for (const lang of ["en", "ar"]) for (const count of [1, 2, 3, 100]) {
      const selected = rolls.slice(0, count).map(label);
      await content(buildRollLabelDocument(selected, lang));
      const { data } = await send("Page.printToPDF", {
        preferCSSPageSize: true, displayHeaderFooter: false, printBackground: true, scale: 1,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      }, pdfPage.sessionId);
      const output = path.join(temp, `${lang}-${count}.pdf`);
      await fs.writeFile(output, Buffer.from(data, "base64"));
      const info = execFileSync("pdfinfo", [output], { encoding: "utf8" });
      check(`${lang} ${count} labels produce exactly ${count} pages`, Number(info.match(/Pages:\s+(\d+)/)[1]), count);
      check(`${lang} ${count} exact 4x6 inch media`, /Page size:\s+288 x 432 pts/.test(info));
      const texts = execFileSync("pdftotext", ["-layout", output, "-"], { encoding: "utf8" }).split("\f").slice(0, count);
      texts.forEach((text, index) => {
        assert.ok(text.includes(selected[index].roll.roll_number), `Missing roll on page ${index + 1}`);
        assert.ok(text.includes("PO-00001"), "Missing order");
        assert.ok(text.includes(Number(selected[index].roll.weight_kg).toLocaleString("en-US")), "Missing weight");
        assert.ok(text.includes("ROLL IDENTIFICATION"), "Missing footer");
        assert.equal(text.includes("BATCH-001"), index === 0, "Batch is conditional");
      });
      check(`${lang} ${count} complete ordered pages without orphan/blank pages`, true);
      if (count === 1) {
        const raster = path.join(temp, `${lang}-label`);
        execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-r", "203", "-png", output, raster]);
        const png = PNG.sync.read(await fs.readFile(`${raster}.png`));
        const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
        check(`${lang} printed QR decodes at Zebra 203 dpi`, decoded?.data, selected[0].qr.url);
      }
    }
    const longRoll = { ...rolls[0], roll_number: "R".repeat(100), production_order_number: "P".repeat(50), batch_number: "B".repeat(50) };
    await content(buildRollLabelDocument([label(longRoll)], "ar"));
    const longLayout = await evaluate(`(()=> {
      const sheet=document.querySelector('.label-sheet'), box=sheet.getBoundingClientRect();
      return {height:sheet.clientHeight,scroll:sheet.scrollHeight,box:box.toJSON(),
        elements:[...sheet.querySelectorAll('strong,img,footer')].map(e=>({tag:e.tagName,box:e.getBoundingClientRect().toJSON()}))};
    })()`, pdfPage.sessionId);
    check("max-length identifiers fit without clipping QR or footer", longLayout.elements.every(({ box }) =>
      box.bottom <= longLayout.box.bottom && box.right <= longLayout.box.right && box.left >= longLayout.box.left
    ) && longLayout.scroll <= longLayout.height);
    const longPdf = await send("Page.printToPDF", { preferCSSPageSize: true, displayHeaderFooter: false, scale: 1,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, pdfPage.sessionId);
    const longPath = path.join(temp, "max-identifiers.pdf");
    await fs.writeFile(longPath, Buffer.from(longPdf.data, "base64"));
    const longText = execFileSync("pdftotext", [longPath, "-"], { encoding: "utf8" }).replace(/\s/g, "");
    check("maximum identifiers survive real PDF pagination intact", ["R".repeat(100), "P".repeat(50), "B".repeat(50)].every(id => longText.includes(id)));
    check("untrusted identifiers cannot inject executable markup", !buildRollLabelDocument([label({
      ...rolls[0], roll_number: '<img src=x onerror="window.evil=1">',
    })], "en").includes('<img src=x'));
    check("unsafe QR image URLs are rejected", (() => {
      try { buildRollLabelDocument([{ roll: rolls[0], qr: { image: "javascript:alert(1)", url: "/production/rolls/1" } }], "en"); return false; }
      catch { return true; }
    })());

    const ui = await page();
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] }, ui.sessionId);
    const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
    const navigate = async route => {
      await send("Page.navigate", { url: origin + route }, ui.sessionId);
      await wait("!!document.querySelector('.production-app')&&!document.querySelector('.prod-loading')", ui.sessionId);
    };
    const click = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${jsLiteral(text)});if(!b)throw Error('Missing button');b.click()})()`, ui.sessionId);
    const popupAfter = async targets => {
      let popup;
      for (let i = 0; i < 100 && !popup; i++) {
        popup = (await send("Target.getTargets")).targetInfos.find(t => t.type === "page" && !targets.includes(t.targetId));
        if (!popup) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(popup, "Preview popup exists");
      const { sessionId } = await send("Target.attachToTarget", { targetId: popup.targetId, flatten: true });
      await send("Runtime.enable", {}, sessionId); await send("Page.enable", {}, sessionId);
      return { ...popup, sessionId };
    };
    const targetIds = async () => (await send("Target.getTargets")).targetInfos.map(t => t.targetId);
    for (const lang of ["en", "ar"]) {
      language = lang;
      for (const width of [390, 768, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 }, ui.sessionId);
        await navigate("/production/film");
        await wait("document.querySelectorAll('.roll-label-list input').length===50", ui.sessionId);
        check(`${lang} ${width} selection UI fits`, await evaluate("document.documentElement.scrollWidth<=innerWidth+1", ui.sessionId));
        check(`${lang} ${width} available without management permission`, await evaluate("document.querySelector('.roll-label-controls').innerText.length>80", ui.sessionId));
      }
      await click(lang === "en" ? "Select results" : "تحديد النتائج");
      check(`${lang} only first bounded page selected`, await evaluate("document.querySelectorAll('.roll-label-list input:checked').length", ui.sessionId), 50);
      await click(lang === "en" ? "Next" : "التالي");
      await wait("document.querySelector('.roll-label-list')?.innerText.includes('R055')", ui.sessionId);
      await click(lang === "en" ? "Select results" : "تحديد النتائج");
      await wait("document.querySelector('.roll-label-count').innerText.startsWith('100')", ui.sessionId);
      await click(lang === "en" ? "Next" : "التالي");
      await wait("document.querySelectorAll('.roll-label-list input').length===5", ui.sessionId);
      check(`${lang} group selection capped at 100 across pages`, await evaluate("document.querySelectorAll('.roll-label-list input:disabled').length", ui.sessionId), 5);
      await click(lang === "en" ? "Previous" : "السابق");
      await wait("document.querySelectorAll('.roll-label-list input:checked').length===50", ui.sessionId);
      await click(lang === "en" ? "Previous" : "السابق");
      await wait("document.querySelector('.roll-label-list')?.innerText.includes('R105')", ui.sessionId);
      await click(lang === "en" ? "Clear selection" : "مسح التحديد");
      await wait("document.querySelectorAll('.roll-label-list input:checked').length===0", ui.sessionId);
      await evaluate("[...document.querySelectorAll('.roll-label-list input')].slice(0,2).forEach(i=>i.click())", ui.sessionId);
      await wait("document.querySelectorAll('.roll-label-list input:checked').length===2", ui.sessionId);
      const before = await targetIds();
      await click(lang === "en" ? "Prepare preview" : "تجهيز المعاينة");
      const popup = await popupAfter(before);
      await wait("!!document.querySelector('#print-labels')&&!document.querySelector('#print-labels').disabled", popup.sessionId);
      check(`${lang} exact completed-roll IDs fetched from empty work board`, requests.at(-1), [105, 104]);
      check(`${lang} two fresh labels ready`, await evaluate("document.querySelectorAll('.label-sheet').length", popup.sessionId), 2);
      check(`${lang} printer instructions included`, await evaluate("document.querySelector('.preview-toolbar').innerText.includes('Zebra')", popup.sessionId));
      // Clicking Print invokes the browser printing API, never a stage transition.
      await evaluate("window.print=()=>{window.printInvoked=true};document.querySelector('#print-labels').click()", popup.sessionId);
      check(`${lang} Print invokes browser print`, await evaluate("window.printInvoked===true", popup.sessionId));
      await send("Target.closeTarget", { targetId: popup.targetId });
    }
    language = "en";
    for (const [route, grant] of [["hall", "view_production_hall"], ["warehouse", "view_finished_inventory"]]) {
      permissions = [grant];
      await navigate(`/production/${route}`);
      await wait("document.querySelectorAll('.roll-label-list input').length===50", ui.sessionId);
      await evaluate("[...document.querySelectorAll('.roll-label-list input')].slice(0,2).forEach(i=>i.click())", ui.sessionId);
      await wait("document.querySelectorAll('.roll-label-list input:checked').length===2", ui.sessionId);
      const before = await targetIds();
      await click("Prepare preview");
      const popup = await popupAfter(before);
      await wait("!!document.querySelector('#print-labels')&&!document.querySelector('#print-labels').disabled", popup.sessionId);
      check(`${route} preserves batch browser labels with its own permission`, requests.at(-1), [105, 104]);
      await send("Target.closeTarget", { targetId: popup.targetId });
    }
    permissions = ["operate_film"];
    language = "en";
    const historyBeforeSingle = historyRequests.length;
    await navigate("/production/rolls/1");
    await wait("!!document.querySelector('.roll-label-single button')", ui.sessionId);
    const before = await targetIds();
    await click("Print this roll label");
    const single = await popupAfter(before);
    await wait("!!document.querySelector('#print-labels')&&!document.querySelector('#print-labels').disabled", single.sessionId);
    check("single roll detail fetches one ID", requests.at(-1), [1]);
    check("single label needs no archive discovery", historyRequests.length, historyBeforeSingle);
    await send("Target.closeTarget", { targetId: single.targetId });
    await navigate("/production/film");
    await wait("document.querySelectorAll('.roll-label-list input').length===50", ui.sessionId);
    await evaluate("[...document.querySelectorAll('.roll-label-list input')].slice(0,2).forEach(i=>i.click())", ui.sessionId);
    await wait("document.querySelectorAll('.roll-label-list input:checked').length===2", ui.sessionId);
    for (const mode of ["fetch", "missing", "duplicate", "image"]) {
      failure = mode;
      const before = await targetIds();
      await click("Prepare preview");
      const popup = await popupAfter(before);
      await wait("!!document.querySelector('.roll-label-error')", ui.sessionId);
      check(`${mode} never enables partial or invalid printing`, await evaluate("!document.querySelector('#print-labels')", popup.sessionId));
      check(`${mode} exposes retry action`, await evaluate("document.querySelector('.roll-label-error').innerText.includes('Retry')", ui.sessionId));
      await send("Target.closeTarget", { targetId: popup.targetId });
    }
    failure = "";
    const retryBefore = await targetIds();
    await click("Retry");
    const retry = await popupAfter(retryBefore);
    await wait("!!document.querySelector('#print-labels')&&!document.querySelector('#print-labels').disabled", retry.sessionId);
    check("retry preserves selection", requests.at(-1), [105, 104]);
    await send("Target.closeTarget", { targetId: retry.targetId });
    const requestsBefore = requests.length;
    await evaluate("window.open=()=>null", ui.sessionId);
    await click("Prepare preview");
    await wait("!!document.querySelector('.roll-label-error')", ui.sessionId);
    check("blocked popup gives actionable message", await evaluate("document.querySelector('.roll-label-error').innerText.includes('Allow pop-ups')", ui.sessionId));
    check("blocked popup does not fetch labels", requests.length, requestsBefore);
    check("no browser exceptions or unexpected business writes", errors, []);
    console.log(`Completed ${passed} checks. PDFs and rendered Arabic/English labels: ${temp}`);
  } finally {
    ws?.close(); chrome.kill("SIGTERM");
  }
})().catch(error => { console.error(error); process.exitCode = 1; });