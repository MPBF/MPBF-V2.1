// Real component with isolated API fixtures; never uses or writes the application DB.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "transfer-catalogue-"));
  let chrome, server, ws, session, chooser = null, assertions = 0, failExport = false, uncertain = false, commits = 0;
  const requests = [], exceptions = [];
  const id = "00000000-0000-4000-8000-000000000001";
  const check = (name, value) => { assert.ok(value, name); assertions++; console.log(`PASS ${name}`); };
  const column = (name) => ({name,labelAr:name,labelEn:name,type:"character varying",nullable:name!=="id",
    default:null,generated:false,writable:true,maxLength:200,precision:null,scale:null});
  const tables = ["customers","customer_products","users","readonly_table"].map(name=>({
    name,labelAr:name,labelEn:name,group:name==="customers"?"discovered":"catalogue",approved:true,exportable:true,importable:name!=="readonly_table",
    reasonAr:"",reasonEn:"",keys:[["id"]],relations:[],columns:[column("id"),column("name")],
  }));
  try {
    await build({stdin:{contents:`import React from "react";import{createRoot}from"react-dom/client";import i18n from "i18next";import{initReactI18next}from"react-i18next";import Panel from "./client/src/pages/admin/DataTransferAdmin";import "./client/src/index.css";const lang=new URL(location.href).searchParams.get("lang")||"ar";i18n.use(initReactI18next).init({lng:lang,resources:{ar:{translation:{}},en:{translation:{}}},initImmediate:false});document.documentElement.dir=lang==="ar"?"rtl":"ltr";createRoot(document.getElementById("root")).render(<main style={{padding:16,maxWidth:1200,margin:"auto"}}><Panel/></main>);`,resolveDir:process.cwd(),loader:"tsx"},
      bundle:true,jsx:"automatic",outfile:path.join(temp,"entry.js"),logLevel:"silent",define:{"process.env.NODE_ENV":'"development"'}});
    await fs.writeFile(path.join(temp,"selected.csv"),"id,name\n100,Fixture\n");
    server=http.createServer(async(req,res)=>{
      const url=new URL(req.url,"http://fixture");
      if(url.pathname.startsWith("/api/")){
        const parts=[];for await(const part of req)parts.push(part);
        const raw=Buffer.concat(parts).toString();
        const body=req.headers["content-type"]?.includes("application/json")?JSON.parse(raw||"{}"):null;
        requests.push({path:url.pathname,body});
        res.setHeader("Content-Type","application/json");
        if(url.pathname.endsWith("/schema"))return res.end(JSON.stringify({ready:true,version:"fixture",environment:"development",limits:{bytes:5242880,rows:2000,retentionDays:30},tables}));
        if(url.pathname.endsWith("/export")){
          if(failExport){res.writeHead(503);return res.end('{"message":"HTTP_503"}');}
          res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition",'attachment; filename="fixture.xlsx"');return res.end(Buffer.from("isolated-download-fixture"));
        }
        if(url.pathname.endsWith("/read-file"))return res.end(JSON.stringify({receipt:id,source:"external",tables:[{name:"customers",headers:["id","name"],rows:[{id:"100",name:"Fixture"}]}]}));
        if(url.pathname.endsWith("/preview"))return res.end(JSON.stringify({id,version:"fixture",expiresAt:"2099-01-01T00:00:00Z",kind:"import",rows:[{index:0,table:body.mappings[0].table,status:"new",values:{id:"100",name:"Fixture"},old:null,changes:[],errors:[]}]}));
        if(url.pathname.endsWith("/apply")){
          if(!commits)commits++;
          if(uncertain){uncertain=false;res.writeHead(503);return res.end('{"message":"HTTP_503"}');}
          return res.end(JSON.stringify({id,inserted:1,updated:0}));
        }
        return res.end("[]");
      }
      if(["/entry.js","/entry.css"].includes(url.pathname)){res.setHeader("Content-Type",url.pathname.endsWith(".js")?"text/javascript":"text/css");return res.end(await fs.readFile(path.join(temp,url.pathname.slice(1))));}
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script src="/entry.js"></script></body></html>');
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    chrome=spawn("chromium",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${path.join(temp,"chrome")}`],{stdio:["ignore","ignore","pipe"]});
    const debug=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Chrome startup timeout")),12000);chrome.stderr.on("data",data=>{const match=data.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
    ws=new WebSocket(debug);await once(ws,"open");
    let counter=0;const pending=new Map();
    ws.on("message",raw=>{const msg=JSON.parse(raw.toString());if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}if(msg.method==="Page.fileChooserOpened")chooser=msg.params;if(msg.method==="Runtime.exceptionThrown")exceptions.push(msg.params.exceptionDetails.text);});
    const send=(method,params={},attached=true)=>new Promise((resolve,reject)=>{const cid=++counter;pending.set(cid,{resolve,reject});ws.send(JSON.stringify({id:cid,method,params,...(attached&&session?{sessionId:session}:{})}));});
    const target=await send("Target.createTarget",{url:"about:blank"},false);
    session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},false)).sessionId;
    await send("Runtime.enable");await send("Page.enable");await send("Page.setInterceptFileChooserDialog",{enabled:true});
    await send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:temp},false);
    const evaluate=async expression=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
    const wait=async expression=>{const until=Date.now()+8000;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error(`Timeout: ${expression}`);};
    const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    for(const lang of ["ar","en"]){
      requests.length=0;commits=0;
      await send("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?lang=${lang}`});
      await wait("document.querySelectorAll('[data-transfer-export]').length===4");
      check(`${lang} other data tables group is last`,await evaluate("document.querySelector('.transfer-group:last-child [data-transfer-export=customers]')!==null"));
      check(`${lang} catalogue appears before backups`,await evaluate("Boolean(document.querySelector('.transfer-groups').compareDocumentPosition(document.querySelector('.db-backups-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)"));
      check(`${lang} controlled transfer section removed`,await evaluate("!document.body.textContent.includes('نقل مضبوط')&&!document.body.textContent.includes('CONTROLLED TRANSFER')"));
      check(`${lang} import capability stays enforced`,await evaluate("document.querySelector('[data-transfer-import=readonly_table]').disabled"));
      await click('[data-transfer-export="users"]');
      await wait("!document.querySelector('[data-transfer-export=users]').disabled");
      const exported=requests.find(r=>r.path.endsWith("/export"));
      check(`${lang} direct export sends only clicked table and XLSX`,exported?.body?.tables?.join()==="users"&&exported.body.format==="xlsx");
      check(`${lang} export never invokes an import`,!requests.some(r=>/read-file|preview|apply/.test(r.path)));
      failExport=true;await click('[data-transfer-export="customers"]');await wait("!!document.querySelector('[role=alert]')");
      check(`${lang} failed export shown explicitly`,await evaluate("!!document.querySelector('[role=alert]')"));failExport=false;
      chooser=null;await click('[data-transfer-import="customer_products"]');
      for(let i=0;i<80&&!chooser;i++)await new Promise(r=>setTimeout(r,30));
      check(`${lang} import opens native file picker`,!!chooser);
      check(`${lang} file picker alone never imports`,!requests.some(r=>/read-file|preview|apply/.test(r.path)));
      await send("DOM.setFileInputFiles",{backendNodeId:chooser.backendNodeId,files:[path.join(temp,"selected.csv")]});
      await wait("!!document.querySelector('.transfer-import-workflow')");
      check(`${lang} clicked target wins over file table name`,await evaluate("document.querySelector('.transfer-import-workflow .panel-head code').textContent==='customer_products'"));
      check(`${lang} file selection cannot apply without preview`,!requests.some(r=>r.path.endsWith("/apply")));
      for(const width of [390,768,1280]){await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<481});check(`${lang} ${width}px page has no horizontal overflow`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));const shot=await send("Page.captureScreenshot",{format:"jpeg",quality:65});await fs.writeFile(path.join(temp,`${lang}-${width}.jpg`),Buffer.from(shot.data,"base64"));}
      await click(".transfer-import-workflow .transfer-safety-check input");
      await click(".transfer-import-workflow button.btn-primary");
      await wait("document.body.textContent.includes(" + JSON.stringify(lang==="ar"?"مراجعة الصفوف والتغييرات":"Review rows and changes") + ")");
      const preview=requests.find(r=>r.path.endsWith("/preview"));
      check(`${lang} preview maps file to clicked table`,preview?.body?.mappings?.[0]?.table==="customer_products");
      const applySelector="document.querySelector('.transfer-preview-list').closest('section').querySelector('button.btn-primary')";
      check(`${lang} new rows still require confirmation`,await evaluate(`${applySelector}.disabled===true`));
      await evaluate("document.querySelector('.transfer-preview-list').closest('section').querySelector('input[type=checkbox]').click()");
      uncertain=true;await evaluate(`${applySelector}.click()`);
      await wait("!!document.querySelector('[role=alert]')&&!"+applySelector+".disabled");
      check(`${lang} unresolved apply blocks catalogue target changes`,await evaluate("[...document.querySelectorAll('[data-transfer-import],[data-transfer-export]')].every(b=>b.disabled)"));
      const first=requests.filter(r=>r.path.endsWith("/apply"))[0].body;
      await evaluate(`${applySelector}.click()`);
      await wait("!document.querySelector('.transfer-import-workflow')&&!document.querySelector('[data-transfer-import=customers]').disabled");
      const applied=requests.filter(r=>r.path.endsWith("/apply"));
      check(`${lang} retry preserves identical frozen apply request`,applied.length===2&&JSON.stringify(first)===JSON.stringify(applied[1].body)&&commits===1);
      check(`${lang} completed workflow releases catalogue`,await evaluate("!document.querySelector('[data-transfer-import=customers]').disabled"));
      chooser=null;await click('[data-transfer-import="customers"]');
      for(let i=0;i<80&&!chooser;i++)await new Promise(r=>setTimeout(r,30));
      await send("DOM.setFileInputFiles",{backendNodeId:chooser.backendNodeId,files:[]});
      check(`${lang} cancelled picker cannot reuse previous file`,await evaluate("!document.querySelector('.transfer-import-workflow')"));
    }
    check("no uncaught browser exceptions",exceptions.length===0);
    console.log(`Verified ${assertions} direct catalogue browser assertions; screenshots at ${temp}`);
  }finally{ws?.close();if(chrome){chrome.kill("SIGTERM");await once(chrome,"exit").catch(()=>{});}if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
