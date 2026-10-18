// Render the actual app; intercept every API, including synthetic corrections.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os"), path = require("node:path"), WebSocket = require("ws");
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mix-corrections-browser-"));
  const chrome = spawn(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    ["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${temp}`,"about:blank"],
    { stdio: ["ignore","ignore","pipe"] });
  let ws, session, serial = 0, language = "ar", permission = "admin", mode = "normal", lost = false, passed = 0;
  let records, materials;
  const errors = [], writes = [], ledger = new Map(), pending = new Map();
  const reset = () => {
    materials = [
      {id:1,item_id:"I1",code:"HD",name:"High density",name_ar:"خام عالي الكثافة",quantity_kg:"-10.25",is_active:true},
      {id:2,item_id:"I2",code:"LD",name:"Low density",name_ar:"خام منخفض",quantity_kg:"0.00",is_active:true},
    ];
    records = [1,2,10000].map((id, i) => ({id,machine_id:"F1",screw:"A",machine_name:"Film",machine_name_ar:"فيلم",
      created_by:2,actor_name:"Operator",actor_name_ar:"مشغل",created_at:"2026-10-18T08:00:00Z",notes:"Original",
      total_kg:"10.25",revision:0,can_edit_contents:i !== 1,
      items:[{material_id:1,code:"HD",name:"High density",name_ar:"خام عالي الكثافة",quantity_kg:"10.25"}]}));
    ledger.clear(); lost = false;
  };
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); passed++; console.log(`PASS ${name}`); };
  reset();
  try {
    const address = await new Promise((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(Error("Chromium startup timeout")),15000);
      chrome.stderr.on("data", chunk => { output += String(chunk); const match=output.match(/DevTools listening on (ws:\/\/\S+)/);
        if(match){clearTimeout(timer);resolve(match[1]);} });
      chrome.on("error",reject);
    });
    ws = new WebSocket(address); await new Promise(resolve => ws.once("open",resolve));
    const send = (method, params={}, attached=true) => new Promise((resolve,reject) => {
      const id=++serial; pending.set(id,{resolve,reject});
      ws.send(JSON.stringify({id,method,params,...(attached&&session?{sessionId:session}:{})}));
    });
    const fulfill = (requestId, body, responseCode=200) => send("Fetch.fulfillRequest", {
      requestId,responseCode,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64"),
    });
    const intercept = async event => {
      const {request,requestId}=event.params, url=new URL(request.url), route=url.pathname;
      let body=[];
      if(route==="/api/me") body={user:{id:42,username:"fixture",permissions:[permission],preferred_language:language}};
      else if(route==="/api/public-branding") body={companyNameAr:"مصنع الاختبار",companyNameEn:"Fixture factory"};
      else if(route==="/api/production/mixing"&&request.method==="GET") body={
        materials,machines:[{id:"F1",name:"Film",name_ar:"فيلم",status:"active",screw_type:"A"}],
        records,latest_mixes:records.slice(0,1),next_before:null,raw_vouchers:[],
      };
      else if(/^\/api\/production\/mixing\/\d+$/.test(route)&&["PATCH","DELETE"].includes(request.method)){
        const payload=JSON.parse(request.postData), id=Number(route.split("/").pop());
        writes.push({method:request.method,payload,id});
        if(mode==="conflict")return fulfill(requestId,{message:"تغيرت الخلطة",message_en:"Mix changed"},409);
        if(!ledger.has(payload.request_id)){
          const record=records.find(r=>r.id===id);
          assert(record); assert.equal(payload.expected_revision,record.revision);
          if(request.method==="DELETE")records=records.filter(r=>r.id!==id);
          else { record.revision++;record.notes=payload.notes;
            if(payload.contents){record.items=payload.contents.items.map(i=>({...materials.find(m=>m.id===i.material_id),...i}));
              record.total_kg=payload.contents.items.reduce((s,i)=>s+Number(i.quantity_kg),0).toFixed(2);
              materials[0].quantity_kg=(-Number(record.total_kg)).toFixed(2);}
          }
          ledger.set(payload.request_id,{id,revision:payload.expected_revision+1,deleted:request.method==="DELETE",balances:[]});
        }
        if(mode==="lose"&&!lost){lost=true;return send("Fetch.failRequest",{requestId,errorReason:"ConnectionReset"});}
        return fulfill(requestId,ledger.get(payload.request_id));
      } else if(request.method!=="GET") throw Error(`Unexpected write ${route}`);
      await fulfill(requestId,body);
    };
    ws.on("message",raw=>{
      const event=JSON.parse(raw);
      if(event.id&&pending.has(event.id)){const task=pending.get(event.id);pending.delete(event.id);event.error?task.reject(Error(event.error.message)):task.resolve(event.result);}
      else if(event.method==="Fetch.requestPaused")intercept(event).catch(error=>errors.push(error.stack));
      else if(event.method==="Runtime.exceptionThrown")errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);
    });
    const target=await send("Target.createTarget",{url:"about:blank"},false);
    session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},false)).sessionId;
    await send("Runtime.enable");await send("Page.enable");await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
    const evaluate=async expression=>{
      const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true,userGesture:true});
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      return result.result.value;
    };
    const wait=async expression=>{
      const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}
      throw Error(`Timeout ${expression}`);
    };
    const navigate=async()=>{await send("Page.navigate",{url:"http://127.0.0.1:5000/production/mixing"});await wait("document.querySelectorAll('.raw-ops-record').length===3");};
    const change=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const openEdit=async index=>{await evaluate(`document.querySelectorAll('.raw-mix-admin-buttons')[${index}].querySelector('button').click()`);await wait("!!document.querySelector('[role=dialog]')");};
    const close=async()=>{await evaluate("document.querySelector('.raw-mix-dialog-head button').click()");await wait("!document.querySelector('[role=dialog]')");};
    const save=()=>evaluate("document.querySelector('.raw-mix-dialog .raw-ops-form-actions button').click()");
    for(language of ["ar","en"])for(const width of [390,768,1440]){
      reset();mode="normal";permission="admin";
      await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<700});
      await navigate();const context=`${language} ${width}`;
      check(`${context} numbers stable and not grouped`,await evaluate("[...document.querySelectorAll('.raw-ops-record-meta .raw-ops-number')].map(e=>e.textContent)"),["Mix-0001","Mix-0002","Mix-10000"]);
      check(`${context} used delete disabled`,await evaluate("document.querySelectorAll('.raw-mix-admin-buttons')[1].querySelectorAll('button')[1].disabled"));
      await openEdit(1);
      check(`${context} used notes-only`,await evaluate("!document.querySelector('.raw-mix-edit-toggle')&&!!document.querySelector('#mix-edit-notes')"));
      await close();await openEdit(0);
      await evaluate("document.querySelector('.raw-mix-edit-toggle input').click()");
      await wait("!!document.querySelector('#mix-edit-quantity-0')");
      check(`${context} no free material entry`,await evaluate("document.querySelector('#mix-edit-material-0').tagName"),"SELECT");
      check(`${context} dialog fits`,await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})()"));
      check(`${context} modal stays opaque above navigation`,await evaluate("(()=>{const dialog=document.querySelector('[role=dialog]'),overlay=dialog.parentElement,s=getComputedStyle(overlay),r=dialog.getBoundingClientRect();return s.opacity==='1'&&s.transform==='none'&&dialog.contains(document.elementFromPoint(r.left+25,r.bottom-20))})()"));
      await evaluate("document.querySelector('[role=dialog]').scrollTop=0");
      const image=await send("Page.captureScreenshot",{format:"png"});await fs.writeFile(path.join(temp,`${language}-${width}.png`),Buffer.from(image.data,"base64"));
      await change("#mix-edit-quantity-0","15.30");await save();
      await wait("!document.querySelector('[role=dialog]')&&document.querySelector('.raw-ops-record-total').textContent.includes('15.3')");
      check(`${context} content correction request`,writes.at(-1).payload.contents.items,[{material_id:1,quantity_kg:"15.30"}]);
      await openEdit(1);await change("#mix-edit-notes","New note");await save();await wait("!document.querySelector('[role=dialog]')");
      check(`${context} notes-only request never replaces recipe`,Object.hasOwn(writes.at(-1).payload,"contents"),false);
      await evaluate("document.querySelector('.raw-mix-admin-buttons button:nth-child(2)').click()");
      await wait("!!document.querySelector('[role=dialog]')");
      const before=writes.length;await close();check(`${context} cancelling delete is read-only`,writes.length,before);
      await evaluate("document.querySelector('.raw-mix-admin-buttons button:nth-child(2)').click()");
      await wait("!!document.querySelector('[role=dialog]')");await save();
      await wait("document.querySelectorAll('.raw-ops-record').length===2&&!document.querySelector('[role=dialog]')");
      check(`${context} confirmed delete removes only selected`,records.map(r=>r.id),[2,10000]);
      check(`${context} no page overflow`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
    }
    reset();mode="lose";await navigate();await openEdit(0);await change("#mix-edit-notes","Lost reply");await save();
    await wait("!!document.querySelector('.raw-mix-dialog [role=alert]')");
    const original=writes.at(-1);
    await save();await wait("!document.querySelector('[role=dialog]')");
    check("lost-response retry preserves exact ID/payload",writes.at(-1),original);
    check("lost-response retry commits once",ledger.size,1);
    reset();mode="conflict";await navigate();await openEdit(0);await change("#mix-edit-notes","Stale");await save();
    await wait("!!document.querySelector('.raw-mix-dialog [role=alert]')");
    check("conflict freezes stale form",await evaluate("document.querySelector('#mix-edit-notes').disabled"));
    mode="normal";await save();await wait("!document.querySelector('[role=dialog]')");
    check("conflict reload does not overwrite",records[0].notes,"Original");
    for(permission of ["operate_film","view_mixing","manage_production","manage_mixing"]){
      reset();await navigate();
      check(`${permission} action visibility`,await evaluate("!!document.querySelector('.raw-mix-admin-actions')"),permission==="manage_mixing");
    }
    check("no browser exceptions",errors,[]);
    console.log(`Mix correction UI passed ${passed} checks; screenshots: ${temp}`);
  }finally{ws?.close();chrome.kill("SIGTERM");}
})().catch(error=>{console.error(error);process.exitCode=1;});
