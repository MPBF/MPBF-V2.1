// Synthetic browser fixtures intercept every API call: no sign-in or real writes.
const assert = require("node:assert/strict");
const {spawn,execFileSync}=require("node:child_process");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const WebSocket=require("ws");
const literal=JSON.stringify;
(async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),"mix-screw-browser-"));
  const chrome=spawn(process.env.CHROMIUM_PATH||execFileSync("which",["chromium"],{encoding:"utf8"}).trim(),
    ["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],
    {stdio:["ignore","ignore","pipe"]});
  // Saved composition belongs to management, not the film-operator surface.
  let ws,session,serial=0,passed=0,language="en",permissions=["manage_mixing"],acceptDialog=false,dialogs=0;
  let loseResponse=false,holdResponse=false,held=null;
  const pending=new Map(),ledger=new Map(),writes=[],errors=[];
  const materials=[
    {id:1,item_id:"ITM001",code:"CODE-HIDDEN-1",name:"High density resin",name_ar:"خام عالي الكثافة",quantity_kg:"1.00",is_active:true},
    {id:2,item_id:"ITM002",code:"CODE-HIDDEN-2",name:"Low density resin",name_ar:"خام منخفض الكثافة",quantity_kg:"0.00",is_active:true},
    {id:3,item_id:"ITM003",code:"CODE-HIDDEN-3",name:"",name_ar:"",quantity_kg:"0.00",is_active:true},
  ];
  const machines=[
    {id:"F1",name:"Single film",name_ar:"فيلم منفرد",status:"active",screw_type:null},
    {id:"F2",name:"ABA film",name_ar:"فيلم مزدوج",status:"active",screw_type:"ABA"},
    {id:"F3",name:"Partial film",name_ar:"فيلم جزئي",status:"active",screw_type:"ABA"},
    {id:"F4",name:"Empty film",name_ar:"فيلم فارغ",status:"active",screw_type:"ABA"},
  ];
  const mix=(id,machine_id,screw,weights)=>({id,machine_id,screw,machine_name:machines.find(m=>m.id===machine_id).name,
    machine_name_ar:machines.find(m=>m.id===machine_id).name_ar,created_by:42,actor_name:"Fixture operator",actor_name_ar:"مشغل تجريبي",
    created_at:"2026-10-10T08:00:00Z",notes:null,total_kg:weights.reduce((s,[,kg])=>s+Number(kg),0).toFixed(2),
    items:weights.map(([material_id,quantity_kg])=>({...materials.find(m=>m.id===material_id),material_id,quantity_kg}))});
  const latest=[mix(1,"F1","A",[[1,"9"],[2,"1"]]),mix(2,"F2","A",[[1,"9"],[2,"1"]]),
    mix(3,"F2","B",[[1,"2"],[2,"18"]]),mix(4,"F3","A",[[1,"5"]])];
  const history=Array.from({length:50},(_,i)=>mix(100-i,"F2",null,[[3,"1"]]));
  const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);console.log(`PASS ${name}`);passed++;};
  try{
    const address=await new Promise((resolve,reject)=>{
      let output="";const timer=setTimeout(()=>reject(Error("Chromium timeout")),15000);
      chrome.stderr.on("data",chunk=>{output+=chunk;const m=output.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      chrome.once("error",reject);
    });
    ws=new WebSocket(address);
    await new Promise((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});
    const send=(method,params={},sessionId=session)=>new Promise((resolve,reject)=>{
      const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
    const fulfill=(requestId,body,status=200)=>send("Fetch.fulfillRequest",{requestId,responseCode:status,
      responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
    ws.on("message",raw=>{
      const event=JSON.parse(String(raw));
      if(event.id){const item=pending.get(event.id);if(item){pending.delete(event.id);event.error?item.reject(Error(JSON.stringify(event.error))):item.resolve(event.result);}return;}
      if(event.method==="Page.javascriptDialogOpening"){dialogs++;void send("Page.handleJavaScriptDialog",{accept:acceptDialog});}
      if(event.method==="Runtime.exceptionThrown")errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);
      if(event.method!=="Fetch.requestPaused")return;
      void(async()=>{
        const {request,requestId}=event.params;
        const url=new URL(request.url),route=url.pathname;
        let body=[];
        if(route==="/api/me")body={user:{id:42,username:"fixture",display_name:"Fixture",display_name_ar:"تجريبي",permissions,preferred_language:language}};
        else if(route==="/api/public-branding")body={companyNameEn:"MPBF",companyNameAr:"MPBF",logoSrc:null};
        else if(route==="/api/production/mixing"&&request.method==="GET")
          body={materials,machines,latest_mixes:latest,records:url.searchParams.has("before")?[mix(5,"F2","A",[[2,"100"]])]:history,next_before:url.searchParams.has("before")?null:51,raw_vouchers:[]};
        else if(route==="/api/production/mixing"&&request.method==="POST"){
          const input=JSON.parse(request.postData);writes.push(input);
          if(ledger.has(input.request_id)){
            const committed=ledger.get(input.request_id);assert.deepEqual(input,committed.input,"exact replay payload");body=committed.body;
          }else{
            const machine=machines.find(m=>m.id===input.machine_id);
            assert.ok(input.screw==="A"||(machine.screw_type==="ABA"&&input.screw==="B"),"compatible screw");
            const record=mix(200+ledger.size,input.machine_id,input.screw,input.items.map(i=>[i.material_id,i.quantity_kg]));
            record.notes=input.notes||null;history.unshift(record);
            const old=latest.findIndex(r=>r.machine_id===input.machine_id&&r.screw===input.screw);
            if(old>=0)latest.splice(old,1);latest.push(record);
            input.items.forEach(i=>{const material=materials.find(m=>m.id===i.material_id);material.quantity_kg=(Number(material.quantity_kg)-Number(i.quantity_kg)).toFixed(2);});
            body={id:record.id,balances:materials.map(m=>({id:m.id,quantity_kg:m.quantity_kg}))};
            ledger.set(input.request_id,{input,body});
          }
          if(holdResponse){held={requestId,body};return;}
          if(loseResponse){loseResponse=false;await send("Fetch.failRequest",{requestId,errorReason:"ConnectionClosed"});return;}
        }
        await fulfill(requestId,body);
      })().catch(e=>errors.push(e.message));
    });
    const target=(await send("Target.createTarget",{url:"about:blank"},null)).targetId;
    session=(await send("Target.attachToTarget",{targetId:target,flatten:true},null)).sessionId;
    for(const method of ["Page.enable","Runtime.enable"])await send(method);
    await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
    const evaluate=async expression=>{
      const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
    };
    const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timeout: ${expression}`);};
    const origin=process.env.FACTORY_BROWSER_ORIGIN||(process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}`:"http://127.0.0.1:5000");
    const navigate=async()=>{
      await send("Page.navigate",{url:origin+"/production/mixing"});
      await wait("!!document.querySelector('.raw-ops') && document.querySelectorAll('.raw-ops-record').length>0");
      await wait("!document.querySelector('.raw-ops-skeleton')");
    };
    const input=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${literal(selector)});if(!e)throw Error('Missing '+${literal(selector)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${literal(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const click=selector=>evaluate(`document.querySelector(${literal(selector)}).click()`);
    const button=label=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${literal(label)}).click()`);
    const submit=()=>evaluate("document.querySelector('.raw-ops form').requestSubmit()");
    const combined=()=>evaluate("[...document.querySelectorAll('.raw-mix-composition')].at(-1).innerText");
    for(const lang of ["ar","en"]){
      language=lang;
      for(const width of [390,768,1280]){
        await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width===390});
        await navigate();
        check(`${lang} ${width}: notes opt-in`,await evaluate("!document.querySelector('#mix-notes')"));
        await button(lang==="ar"?"إضافة مادة":"Add material");
        check(`${lang} ${width}: one shared heading for multiple material rows`,await evaluate(`(()=>{
          const list=document.querySelector('.raw-mix-entry-list');
          return list.querySelectorAll('.raw-ops-item').length===2&&list.querySelectorAll('#mix-material-heading').length===1&&
            list.querySelectorAll('#mix-weight-heading').length===1&&!list.querySelector('label')&&
            [...list.querySelectorAll('select')].every(e=>e.getAttribute('aria-labelledby')==='mix-material-heading')&&
            [...list.querySelectorAll('input')].every(e=>e.getAttribute('aria-labelledby')==='mix-weight-heading');
        })()`));
        check(`${lang} ${width}: compact material fields and spacing`,await evaluate(`(()=>{
          const list=document.querySelector('.raw-mix-entry-list'),row=list.querySelector('.raw-ops-item');
          return [...row.querySelectorAll('input,select')].every(e=>e.getBoundingClientRect().height<=38)&&getComputedStyle(row).columnGap==='6px'&&
            (innerWidth<701||list.getBoundingClientRect().width<=720);
        })()`));
        await click(".raw-mix-entry-list .raw-ops-item:last-of-type .raw-ops-remove");
        check(`${lang} ${width}: history starts collapsed`,await evaluate("!document.querySelector('.raw-mix-history').open"));
        await click(".raw-mix-history > summary");
        check(`${lang} ${width}: history opens`,await evaluate("document.querySelector('.raw-mix-history').open"));
        check(`${lang} ${width}: save label and icon`,await evaluate(`document.querySelector('.raw-mix-primary-actions button[type=submit]').textContent.trim()===${literal(lang==="ar"?"حفظ":"Save")}&&!!document.querySelector('.raw-mix-primary-actions button[type=submit] .lucide-save')`));
        check(`${lang} ${width}: correct text direction`,await evaluate("getComputedStyle(document.querySelector('.raw-ops')).direction"),lang==="ar"?"rtl":"ltr");
        check(`${lang} ${width}: production chrome and navigation parity`,await evaluate(`(()=>{
          const header=document.querySelector('.raw-mix-heading'),refresh=header?.querySelector('.prod-header-refresh');
          const nav=document.querySelector('.raw-mix-nav'),links=[...nav.querySelectorAll('a')];
          return header?.classList.contains('prod-heading')&&header.querySelector('.prod-eyebrow')&&header.querySelector('h2')&&
            refresh?.classList.contains('prod-btn')&&nav.classList.contains('prod-view-nav')&&
            links.length>0&&links.every(link=>link.classList.contains('prod-btn')&&parseFloat(getComputedStyle(link).minHeight)>=44)&&
            nav.querySelector('[aria-current="page"]')?.textContent.trim()===${literal(lang==="ar"?"خلط مواد الخام":"Raw material mixing")};
        })()`));
        if(width===390)check(`${lang} ${width}: two primary actions stay on one phone row`,await evaluate(`(()=>{
          const buttons=[...document.querySelectorAll('.raw-mix-primary-actions > .raw-btn')];
          const boxes=buttons.map(button=>button.getBoundingClientRect());
          return buttons.length===2&&boxes.every(box=>box.width>0&&Math.abs(box.top-boxes[0].top)<2)&&
            getComputedStyle(document.querySelector('.raw-mix-primary-actions')).display==="grid"&&
            getComputedStyle(document.querySelector('.raw-mix-primary-actions')).gridTemplateColumns.split(" ").length===2;
        })()`));
        await input("#mix-machine","F2");
        check(`${lang} ${width}: ABA explicit screw`,await evaluate("document.querySelector('#mix-screw').value"),"");
        check(`${lang} ${width}: weighted combined, not average or layer ratio`,(await combined()).includes("36.67%")&&(await combined()).includes("63.33%"));
        check(`${lang} ${width}: A+B title and final totals`,await evaluate(`(()=>{
          const cards=[...document.querySelectorAll('.raw-mix-saved-grid .raw-mix-composition')];
          return cards.length===3&&cards[2].querySelector('.raw-mix-composition-head strong').textContent==='A+B'&&
            cards.every((card,index)=>{
              const total=card.querySelector('.raw-mix-composition-lines > :last-child');
              return total.classList.contains('raw-mix-composition-total')&&total.querySelector('b').textContent===[ '10 kg','20 kg','30 kg'][index]&&total.querySelector('small').textContent==='100%';
            });
        })()`));
        check(`${lang} ${width}: composition columns stay compact on one row`,await evaluate(`(()=>{
          return [...document.querySelectorAll('.raw-mix-composition-line')].every(row=>{
            const [name,weight,percent]=[...row.children].map(child=>child.getBoundingClientRect());
            return Math.abs(weight.top-percent.top)<3&&getComputedStyle(row.parentElement).columnGap==='6px'&&percent.width>0&&name.width>0;
          });
        })()`));
        check(`${lang} ${width}: English-only materials everywhere without codes`,await evaluate("document.querySelector('.raw-ops').innerText.includes('High density resin')&&!document.querySelector('.raw-ops').textContent.includes('خام عالي الكثافة')&&!document.querySelector('.raw-ops').textContent.includes('خام منخفض الكثافة')&&!document.querySelector('.raw-ops').innerText.includes('CODE-HIDDEN')"));
        check(`${lang} ${width}: missing English name indicator`,await evaluate("document.querySelector('#mix-material-0 option[value=\"3\"]').textContent"), "—");
        check(`${lang} ${width}: history names are English with compact screw`,await evaluate(`(()=>{
          const records=[...document.querySelectorAll('.raw-ops-record')];
          return records.every(record=>!/[\\u0600-\\u06ff]/.test(record.querySelector('.raw-ops-record-machine').textContent)&&
            [...record.querySelectorAll('.raw-ops-material-chip > span')].every(e=>!/[\\u0600-\\u06ff]/.test(e.textContent)))&&
            records[0].querySelector('.raw-ops-record-machine').textContent.endsWith('-—');
        })()`));
        check(`${lang} ${width}: machine and screw share a row`,await evaluate(`(()=>{
          const machine=document.querySelector('#mix-machine').getBoundingClientRect(),screw=document.querySelector('#mix-screw').getBoundingClientRect();
          return Math.abs(machine.top-screw.top)<2;
        })()`));
        check(`${lang} ${width}: A, B and combined share a row`,await evaluate(`(()=>{
          const cards=[...document.querySelector('.raw-mix-saved-grid').children];
          return cards.length===3&&cards.every(card=>Math.abs(card.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<2);
        })()`));
        check(`${lang} ${width}: repetitive deletion explanation removed`,await evaluate("!document.querySelector('[id^=mix-delete-note-]')"));
        await input("#mix-screw","A");await input("#mix-material-0","1");await input("#mix-quantity-0","10");
        check(`${lang} ${width}: draft substitution preserves B`,await evaluate("document.querySelector('.raw-mix-live-preview').innerText.includes('40%')&&document.querySelector('.raw-mix-live-preview').innerText.includes('60%')"));
        check(`${lang} ${width}: draft per-material share`,await evaluate("document.querySelector('.raw-mix-live-preview').innerText.includes('100%')"));
        await input("#mix-quantity-0","NaN");
        check(`${lang} ${width}: invalid draft has no preview`,await evaluate("!document.querySelector('.raw-mix-live-preview')"));
        await input("#mix-quantity-0","10");
        check(`${lang} ${width}: add note button removed`,await evaluate("document.querySelectorAll('.raw-mix-primary-actions button').length===2"));
        acceptDialog=false;await input("#mix-screw","B");
        check(`${lang} ${width}: cancelling screw switch preserves target/weights`,await evaluate("[document.querySelector('#mix-screw').value,document.querySelector('#mix-quantity-0').value]"),["A","10"]);
        acceptDialog=true;await input("#mix-machine","F1");
        check(`${lang} ${width}: confirmed machine change clears populated draft`,await evaluate("document.querySelector('#mix-quantity-0').value"),"");
        check(`${lang} ${width}: single screw total equals A`,(await combined()).includes("90%")&&(await combined()).includes("10%"));
        await input("#mix-machine","F3");
        check(`${lang} ${width}: missing B explicitly partial`,await evaluate(`document.querySelector('.raw-mix-partial').textContent.includes(${literal(lang==="ar"?"إجمالي جزئي":"Partial total")})&&!!document.querySelector('.raw-mix-missing')`));
        await input("#mix-machine","F4");
        check(`${lang} ${width}: empty composition`,await evaluate(`document.querySelector('.raw-ops').innerText.includes(${literal(lang==="ar"?"لا توجد تركيبات محفوظة بعد.":"No saved compositions yet.")})`));
        await input("#mix-machine","F2");
        const beforeCombined=await combined();
        await button(lang==="ar"?"تحميل سجلات أقدم":"Load older records");
        await wait("document.querySelectorAll('.raw-ops-record').length===51");
        check(`${lang} ${width}: pagination never changes latest`,await combined(),beforeCombined);
        check(`${lang} ${width}: viewport has no horizontal overflow`,await evaluate("document.documentElement.scrollWidth<=innerWidth+1"));
        if(width===390){
          const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
          await fs.writeFile(`/tmp/mixing-screws-${lang}.png`,Buffer.from(shot.data,"base64"));
        }
      }
    }
    language="en";permissions=["view_mixing"];await navigate();
    check("read-only can select composition but cannot submit",await evaluate("!!document.querySelector('#mix-read-machine')&&!document.querySelector('.raw-ops form')"));
    await input("#mix-read-machine","F2");check("read-only combined composition", (await combined()).includes("36.67%"));
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await evaluate("document.querySelector('.raw-mix-saved-grid').scrollIntoView()");
    const summaryShot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await fs.writeFile("/tmp/mixing-screws-composition.png",Buffer.from(summaryShot.data,"base64"));
    permissions=["operate_film"];await navigate();
    await input("#mix-machine","F2");await input("#mix-screw","B");await input("#mix-material-0","1");await input("#mix-quantity-0","2.50");
    const balance=Number(materials[0].quantity_kg),count=ledger.size;
    loseResponse=true;await submit();await wait("document.querySelector('#mix-quantity-0').disabled");
    const original=writes.at(-1);
    check("lost response commits once",ledger.size,count+1);
    await navigate();
    check("empty recovered notes stay hidden",await evaluate("!document.querySelector('#mix-notes')"));
    check("recovered target stays B",await evaluate("document.querySelector('#mix-screw').value"),"B");
    await click(".raw-ops-banner.error button");await wait("!!document.querySelector('.raw-ops-banner.success')");
    check("retry immutable payload",writes.at(-1),original);
    check("retry one deduction",Number(materials[0].quantity_kg),balance-2.5);
    check("retry clears submitted rows and session",await evaluate("document.querySelector('#mix-quantity-0').value===''&&sessionStorage.getItem('mpbf:raw-mixing:pending:42')===null"));
    // A response lost after later edits must recover those edits, not clear them.
    await input("#mix-material-0","1");await input("#mix-quantity-0","1.25");holdResponse=true;await submit();
    await wait("document.querySelector('button[type=submit]').disabled");
    for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,50));
    assert.ok(held,"request committed and response held");
    await input("#mix-quantity-0","7.75");
    await input("#mix-machine","F1"); // confirmation discards only the newer draft.
    await input("#mix-material-0","2");await input("#mix-quantity-0","3.75");
    const oldPayload=writes.at(-1);
    holdResponse=false;await send("Fetch.failRequest",{requestId:held.requestId,errorReason:"ConnectionClosed"});held=null;
    await wait("document.querySelector('#mix-quantity-0').disabled");await navigate();
    check("reload preserves newer draft target/weights",await evaluate("[document.querySelector('#mix-machine').value,document.querySelector('#mix-quantity-0').value]"),["F1","3.75"]);
    await click(".raw-ops-banner.error button");await wait("!!document.querySelector('.raw-ops-banner.success')");
    check("newer draft cannot mutate original retry",writes.at(-1),oldPayload);
    check("confirmed retry preserves newer edit",await evaluate("[document.querySelector('#mix-machine').value,document.querySelector('#mix-quantity-0').value]"),["F1","3.75"]);
    check("session cleared after newer-draft retry",await evaluate("sessionStorage.getItem('mpbf:raw-mixing:pending:42')"),null);
    // An exact pre-upgrade committed request has no screw in its payload.
    const legacyInput={request_id:"b93e9516-694e-4cc9-b290-d244aec5fd6e",machine_id:"F2",notes:"legacy note",items:[{material_id:1,quantity_kg:"1.00"}]};
    ledger.set(legacyInput.request_id,{input:legacyInput,body:{id:150,balances:[]}});
    const legacyDraft={machine:"F2",rows:[{materialId:"1",quantity:"1.00"}],notes:"legacy note"};
    await evaluate(`sessionStorage.setItem('mpbf:raw-mixing:pending:42',${literal(JSON.stringify({id:legacyInput.request_id,payload:legacyInput,fingerprint:JSON.stringify(legacyDraft),draft:legacyDraft}))})`);
    await navigate();
    check("legacy recovered note preserved",await evaluate("document.querySelector('#mix-notes').value"),"legacy note");
    await click(".raw-ops-banner.error button");await wait("!!document.querySelector('.raw-ops-banner.success')");
    check("legacy pending request never acquires a guessed screw",writes.at(-1),legacyInput);
    check("legacy confirmed retry clears original draft",await evaluate("document.querySelector('#mix-quantity-0').value"),"");
    check("selection changes required confirmations",dialogs>=13);
    check("browser runtime errors",errors,[]);
    console.log(`Mixing screws browser verification passed: ${passed} assertions.`);
  }finally{
    ws?.close();chrome.kill("SIGTERM");await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
