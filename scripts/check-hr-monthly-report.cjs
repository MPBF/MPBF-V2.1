// Real component/export checks with synthetic data only; never signs in or writes HR data.
const { build } = require("esbuild");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const { spawn, execFileSync } = require("node:child_process");
const WebSocket = require("ws");
const path = require("node:path");

(async () => {
  const temp = await fs.mkdtemp("/tmp/hr-monthly-");
  const output = path.resolve("generated-artifacts/hr-monthly-report");
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  let server, chrome, ws;
  try {
    await build({ stdin: { contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Page from './client/src/pages/HumanResourcesOperations';
      import i18n from './client/src/i18n';
      import * as report from './client/src/lib/hr-monthly-report';
      import './client/src/pages/human-resources.css';import './client/src/styles/theme-tokens.css';
      const en=new URLSearchParams(location.search).has('en');
      await i18n.changeLanguage(en?'en':'ar');document.documentElement.dir=en?'ltr':'rtl';
      const logo='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="54" fill="white" stroke="#178840" stroke-width="8"/><text x="60" y="69" text-anchor="middle" font-size="26" fill="#242064">MPBF</text></svg>');
      window.branding={companyNameAr:'مصنع أكياس البلاستيك الحديث',companyNameEn:'Modern Plastic Bag Factory',logoSrc:logo};
      const rows=Array.from({length:80},(_,i)=>({id:i+1,username:'Employee-'+(i+1),
        display_name:'Employee '+String(i+1).padStart(3,'0'),display_name_ar:'موظف تجريبي '+(i+1),
        section_id:'SEC',section_name:en?'Production department':'قسم الإنتاج',workedMinutes:12345,daysWorked:25,absentDays:2,incompleteDays:1,overtimeMinutes:850}));
      window.report=report;window.testRows=rows;
      window.fetch=async(url)=>{
        if(String(url).includes('/public-branding'))return {ok:!window.failBranding,json:async()=>window.branding};
        return {ok:true,json:async()=>String(url).includes('/attendance-summary')?{rows}:[]};
      };
      window.fixture=(count)=>({language:en?'en':'ar',title:en?'Monthly attendance report':'كشف الحضور الشهري',
        month:'2026-10',filters:[en?'Department: Production':'القسم: الإنتاج',en?'Employee: All employees':'الموظف: كل الموظفين'],
        headers:en?['Employee','Department','Work hours','Working days','Absences','Incomplete','Overtime']:['الموظف','القسم','ساعات العمل','أيام العمل','الغياب','غير مكتمل','الإضافي'],
        rows:rows.slice(0,count).map(r=>({nameAr:r.display_name_ar,nameEn:r.display_name,section:r.section_name,worked:'205 h 45 min',days:r.daysWorked,absent:r.absentDays,incomplete:r.incompleteDays,overtime:'14 h 10 min'}))});
      window.fixtureReady=true;
      window.printCalls=[];
      new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(frame=>{
        if(frame.tagName==='IFRAME'&&frame.hasAttribute('data-hr-monthly-report'))frame.addEventListener('load',()=>{
          frame.contentWindow.print=()=>{window.printCalls.push({rows:frame.contentDocument.querySelectorAll('tbody tr').length,
            text:frame.contentDocument.body.textContent});frame.contentWindow.dispatchEvent(new Event('afterprint'));};
        });
      }))).observe(document.body,{childList:true});
      createRoot(document.getElementById('root')).render(<main className="hr-page"><Page tab="report" employees={rows}/></main>);
    `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "esm", jsx: "automatic",
      outfile: temp + "/check.js", logLevel: "silent" });
    server = http.createServer(async (req, res) => {
      const name = req.url.split("?")[0];
      if (name === "/check.js" || name === "/check.css") {
        res.setHeader("Content-Type", name.endsWith("css") ? "text/css" : "text/javascript");
        return res.end(await fs.readFile(temp + name));
      }
      res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/check.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}main{padding:16px;min-width:0}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
      ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temp}/profile`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] });
    const address = await new Promise((resolve, reject) => {
      let text = ""; const timer = setTimeout(() => reject(Error("Chrome timeout")), 20000);
      chrome.stderr.on("data", data => { text += data; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    ws = new WebSocket(address); await new Promise(resolve => ws.once("open", resolve));
    let serial = 0, session; const pending = new Map();
    ws.on("message", raw => {
      const message = JSON.parse(raw); if (!message.id) return;
      const request = pending.get(message.id); pending.delete(message.id);
      message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
    });
    const send = (method, params = {}, target = session) => new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
    });
    const target = await send("Target.createTarget", { url: "about:blank" }, null);
    session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, null)).sessionId;
    const evaluate = async (expression, targetSession = session) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, targetSession);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error("Timeout: " + expression);
    };
    await send("Page.enable");
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output }, null);
    const printTarget = await send("Target.createTarget", { url: "about:blank" }, null);
    const printSession = (await send("Target.attachToTarget", { targetId: printTarget.targetId, flatten: true }, null)).sessionId;
    await send("Page.enable", {}, printSession);
    for (const width of [390, 768, 1280]) for (const en of [false, true]) {
      await send("Page.bringToFront");
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?${en ? "en=1" : ""}` });
      await wait("window.fixtureReady && document.querySelectorAll('.hr-report-sheet tbody tr').length===80");
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), "responsive report page " + width + " " +
        JSON.stringify(await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.body.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().left<0||e.getBoundingClientRect().right>innerWidth).slice(0,8).map(e=>[e.className,e.getBoundingClientRect().left,e.getBoundingClientRect().width])})")));
      if (width !== 390) { console.log("PASS report UI", width, en ? "en" : "ar"); continue; }
      // Every pagination boundary around one and two pages plus the empty and long reports.
      let previousFirstCapacity;
      for (const count of [0, 1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 32, 80]) {
        const result = await evaluate(`(async()=>{
          const branding=await report.loadReportBranding(${JSON.stringify(en ? "en" : "ar")});
          const prepared=await report.prepareMonthlyReport(fixture(${count}),branding);
          const pages=prepared.pages.map(p=>({rows:p.querySelectorAll('tbody tr').length,
            fits:p.querySelector('table').getBoundingClientRect().bottom+7<=p.querySelector('footer').getBoundingClientRect().top,
            logo:p.querySelector('img').naturalWidth>0,header:p.querySelectorAll('th').length,
            text:p.textContent}));
          const html=prepared.frame.contentDocument.documentElement.outerHTML;
          prepared.dispose();return{pages,html};
        })()`);
        assert.equal(result.pages.reduce((sum, page) => sum + page.rows, 0), count || 1);
        assert.ok(result.pages.every(page => page.fits && page.logo && page.header === 7));
        assert.ok(count === 0 || result.pages.every(page => page.rows > 0), "no empty trailing pages");
        if (count === 80) previousFirstCapacity = result.pages[0].rows;
        // Verify physical printed PDFs, not only DOM pagination.
        if (![0, 1, 17, 18, 32, 80].includes(count)) continue;
        const tree = await send("Page.getFrameTree", {}, printSession);
        await send("Page.setDocumentContent", { frameId: tree.frameTree.frame.id, html: "<!doctype html>" + result.html }, printSession);
        await evaluate("document.fonts.ready", printSession);
        assert.ok(await evaluate("Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)", printSession));
        const pdf = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false }, printSession);
        const filename = path.join(output, `printed-${en ? "en" : "ar"}-${count}.pdf`);
        await fs.writeFile(filename, Buffer.from(pdf.data, "base64"));
        const info = execFileSync("pdfinfo", [filename], { encoding: "utf8" });
        const size = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
        assert.ok(size && Math.abs(+size[1] - 841.89) < 1 && Math.abs(+size[2] - 595.28) < 1, "A4 landscape dimensions");
        const texts = execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" }).split("\f").filter(text => text.trim());
        assert.equal(texts.length, result.pages.length, "physical PDF matches measured pages, no trailing blank");
        for (const text of texts) assert.ok(text.includes("Modern Plastic Bag Factory"), "factory identity repeats");
        for (let i = 1; i <= count; i++) {
          const token = "Employee " + String(i).padStart(3, "0");
          assert.equal(texts.join("\n").split(token).length - 1, 1, "each employee printed exactly once");
        }
      }
      assert.ok(previousFirstCapacity > 0 && previousFirstCapacity < 80);
      await send("Page.bringToFront");
      await evaluate("document.querySelector('.hr-export-actions button').click()");
      await wait("window.printCalls.length===1&&!document.querySelector('.hr-export-actions button').disabled");
      assert.equal(await evaluate("window.printCalls[0].rows"), 80, "print all includes every filtered employee");
      assert.ok(await evaluate("window.printCalls[0].text.includes('Modern Plastic Bag Factory')"));
      await evaluate("document.querySelector('.hr-report-sheet tbody button').click()");
      await wait("window.printCalls.length===2&&!document.querySelector('.hr-export-actions button').disabled");
      assert.equal(await evaluate("window.printCalls[1].rows"), 1, "individual print includes only selected employee");
      assert.ok(await evaluate("window.printCalls[1].text.includes('Employee 001')&&!window.printCalls[1].text.includes('Employee 002')"));
      // Downloaded PDF: actual UI action and raster export are exercised.
      await send("Page.bringToFront");
      await evaluate("document.querySelectorAll('.hr-export-actions button')[2].click()");
      await wait("!document.querySelector('.hr-export-actions button').disabled");
      assert.equal(await evaluate("document.querySelector('.hr-alert.error')?.textContent||''"), "");
      const month = await evaluate("document.querySelector('input[type=month]').value");
      const downloaded = path.join(output, `${en ? "attendance" : "كشف-الحضور"}-${month}.pdf`);
      for (let i = 0; i < 100; i++) {
        if (await fs.stat(downloaded).then(() => true, () => false)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const downloadedInfo = execFileSync("pdfinfo", [downloaded], { encoding: "utf8" });
      assert.match(downloadedInfo, /Pages:\s+10/);
      assert.ok((await fs.stat(downloaded)).size < 5_000_000, "compressed PDF remains practical to download");
      // Workbook: actual UI download and independently round-tripped ExcelJS model.
      await evaluate("document.querySelectorAll('.hr-export-actions button')[1].click()");
      await wait("!document.querySelector('.hr-export-actions button').disabled");
      const workbookBase64 = await evaluate(`(async()=>{const b=await report.loadReportBranding('${en ? "en" : "ar"}');
        const workbook=await report.buildMonthlyWorkbook(fixture(80),b);
        const data=new Uint8Array(await workbook.xlsx.writeBuffer());let text='';for(const byte of data)text+=String.fromCharCode(byte);return btoa(text)})()`);
      const ExcelJS = require("exceljs"); const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(workbookBase64, "base64"));
      const sheet = workbook.worksheets[0];
      assert.equal(sheet.pageSetup.paperSize, 9); assert.equal(sheet.pageSetup.orientation, "landscape");
      assert.equal(sheet.pageSetup.fitToWidth, 1); assert.equal(sheet.pageSetup.fitToHeight, 0);
      assert.equal(sheet.pageSetup.printTitlesRow, "1:6"); assert.equal(sheet.getImages().length, 1);
      assert.equal(sheet.rowCount, 86); assert.equal(sheet.getCell("B1").value, "مصنع أكياس البلاستيك الحديث");
      assert.equal(sheet.getCell("B2").value, "Modern Plastic Bag Factory"); assert.equal(sheet.getCell("B4").value.includes("2026-10"), true);
      assert.equal(sheet.getCell("A7").value, "موظف تجريبي 1\nEmployee 001");
      assert.equal(sheet.getCell("A86").value, "موظف تجريبي 80\nEmployee 080");
      // Missing branding must fail visibly and never produce a brandless report.
      assert.ok(await evaluate(`(async()=>{window.failBranding=true;try{await report.loadReportBranding('${en ? "en" : "ar"}');return false}catch{return true}finally{window.failBranding=false}})()`));
      console.log("PASS reports, pagination, PDF, Excel", width, en ? "en" : "ar");
    }
    console.log("PASS synthetic monthly attendance exports; output:", output);
  } finally {
    if (ws) ws.close();
    if (chrome && chrome.exitCode === null) {
      const stopped = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await stopped;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
