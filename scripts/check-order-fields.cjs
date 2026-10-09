// CDP-only browser fixtures: no Playwright dependency and no real API writes.
const assert = require("node:assert/strict");
const {spawn,execFileSync} = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const WebSocket = require("ws");

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),"order-fields-"));
  let chrome,ws,session,serial=0,previews=0,failPreview=false;
  const pending=new Map(),errors=[],writes=[];
  try {
    await esbuild.build({stdin:{contents:`
      import React from "react";
      import {createRoot} from "react-dom/client";
      import Modal from "./client/src/components/OrderCreateModal";
      import i18n from "./client/src/i18n";
      const params=new URLSearchParams(location.search);
      void i18n.changeLanguage(params.get("lang")||"ar");
      createRoot(document.getElementById("root")).render(<Modal editId={Number(params.get("editId"))||undefined} onSaved={()=>{}} onClose={()=>{window.closedFixture=true}}/>);
    `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,jsx:"automatic",platform:"browser",outfile:path.join(temp,"fixture.js"),logLevel:"silent"});
    const js=await fs.readFile(path.join(temp,"fixture.js"),"utf8"),css=await fs.readFile(path.join(temp,"fixture.css"),"utf8");
    chrome=spawn(process.env.CHROMIUM_PATH||execFileSync("which",["chromium"],{encoding:"utf8"}).trim(),
      ["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${temp}/profile`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
    const address=await new Promise((resolve,reject)=>{
      let output="";const timer=setTimeout(()=>reject(Error("Chromium startup timeout")),15000);
      chrome.stderr.on("data",chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1])}});
    });
    ws=new WebSocket(address);await new Promise(resolve=>ws.once("open",resolve));
    const send=(method,params={},sid=session)=>new Promise((resolve,reject)=>{
      const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})}));
    });
    ws.on("message",raw=>{
      const event=JSON.parse(String(raw));
      if(event.id){const p=pending.get(event.id);if(p){pending.delete(event.id);event.error?p.reject(Error(JSON.stringify(event.error))):p.resolve(event.result)}}
      else if(event.method==="Runtime.exceptionThrown")errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);
      else if(event.method==="Fetch.requestPaused")void(async()=>{
        const {requestId,request}=event.params,url=new URL(request.url);let body,status=200,type="application/json";
        if(url.pathname==="/__order-field-test"){
          type="text/html";const en=url.searchParams.get("lang")==="en";
          body=`<html lang="${en?"en":"ar"}" dir="${en?"ltr":"rtl"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"><style>${css}</style></head><body><div id="root"></div><script src="/__order-field-test.js"></script></body></html>`;
        }else if(url.pathname==="/__order-field-test.js"){type="text/javascript";body=js}
        else if(url.pathname.startsWith("/api/")){
          assert.equal(request.method,"GET","fixtures must never write");body=[];
          if(url.pathname==="/api/orders/next-number"){previews++;if(failPreview){failPreview=false;status=500;body={message:"تعذر تحميل رقم الطلب."}}else body={order_number:"O0001"}}
          if(url.pathname==="/api/orders/77/with-items")body={order:{id:77,order_number:"OLD-77",customer_id:"C1",created_at:"2026-01-01T10:00:00Z",delivery_days:20,status:"waiting"},items:[{id:1,customer_product_id:1,quantity_kg:"10.00",status:"pending"}]};
        }else return send("Fetch.continueRequest",{requestId},event.sessionId);
        await send("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:type}],body:Buffer.from(type==="application/json"?JSON.stringify(body):body).toString("base64")},event.sessionId);
      })().catch(error=>{errors.push(error.stack);writes.push("unexpected request")});
    });
    const target=(await send("Target.createTarget",{url:"about:blank"},null)).targetId;
    session=(await send("Target.attachToTarget",{targetId:target,flatten:true},null)).sessionId;
    await send("Page.enable");await send("Runtime.enable");await send("Fetch.enable",{patterns:[{urlPattern:"*"}]});
    const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value};
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error(`Timed out: ${expression}`)};
    const origin=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}`:"http://127.0.0.1:5000";
    for(const lang of ["ar","en"])for(const width of [390,768,1440]){
      await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await send("Page.navigate",{url:`${origin}/__order-field-test?lang=${lang}&width=${width}`});
      await wait(`document.querySelector('#order-number')?.textContent==='O0001'`);
      const fields=await evaluate(`(()=>{const style=id=>getComputedStyle(document.querySelector(id));return {
        number:style('#order-number').justifyContent,date:style('#order-created-date').justifyContent,
        days:style('#order-delivery-days').textAlign,quantity:style('#order-quantity-1').textAlign,
        left:style('#order-quantity-1').paddingLeft,right:style('#order-quantity-1').paddingRight,
        hint:!!document.querySelector('#order-delivery-days-hint'),description:document.querySelector('#order-delivery-days').getAttribute('aria-describedby'),
        fits:document.documentElement.scrollWidth<=innerWidth+1}})()`);
      for(const field of ["number","date","days","quantity"])assert.equal(fields[field],"center",`${lang} ${width}: ${field}`);
      assert.equal(fields.left,fields.right);assert.equal(fields.hint,false);assert.equal(fields.description,null);assert.equal(fields.fits,true);
      await evaluate(`(()=>{const e=document.querySelector('#order-quantity-1');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12.50');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      assert.equal(await evaluate("document.querySelector('#order-quantity-1').value"),"12.50");
      if(lang==="ar"&&width===390){const image=await send("Page.captureScreenshot",{format:"png"});await fs.writeFile(path.join(temp,"order-fields-ar-390.png"),Buffer.from(image.data,"base64"))}
      console.log(`PASS ${lang} ${width}: number preview, centered fields, symmetric quantity padding, removed helper, decimal editing and viewport fit`);
    }
    const before=previews;
    await send("Page.navigate",{url:`${origin}/__order-field-test?editId=77`});await wait("document.querySelector('#order-number')?.textContent==='OLD-77'");
    assert.equal(previews,before);
    failPreview=true;await send("Page.navigate",{url:`${origin}/__order-field-test?retry=1`});await wait("!!document.querySelector('.order-create-number [role=alert]')");
    await evaluate("document.querySelector('.order-create-number button').click()");await wait("document.querySelector('#order-number')?.textContent==='O0001'");
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    console.log("PASS historical edit number preserved, preview failure retry, no runtime errors and no business writes.");
  }finally{
    ws?.close();
    if(chrome&&chrome.exitCode===null){
      await new Promise(resolve=>{
        const timer=setTimeout(()=>chrome.kill("SIGKILL"),5000);
        chrome.once("exit",()=>{clearTimeout(timer);resolve()});
        chrome.kill("SIGTERM");
      });
    }
    await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
