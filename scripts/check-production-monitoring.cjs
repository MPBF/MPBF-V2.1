// Synthetic intercepted APIs only. No real authentication or business writes.
const assert=require("node:assert/strict");
const {spawn,execFileSync}=require("node:child_process");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const WebSocket=require("ws");
(async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),"monitor-browser-"));
  const chrome=spawn(execFileSync("which",["chromium"],{encoding:"utf8"}).trim(),
    ["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  let ws,session,serial=0,language="en",permissions=["admin"],failed=false,passed=0;
  const pending=new Map(),errors=[],calls=[];
  const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}`:"http://127.0.0.1:5000";
  const machines=[
    {machine_id:"F1",machine_name:"Film one",machine_name_ar:"فيلم واحد",mixed_kg:"1200.25",consumed_kg:"1000.00",remaining_kg:"200.25",film_kg:"1040.50",uncovered_kg:"40.50"},
    {machine_id:"F2",machine_name:"اسم عربي فقط",machine_name_ar:"ماكينة عربية",mixed_kg:"0.00",consumed_kg:"0.00",remaining_kg:"0.00",film_kg:"3.00",uncovered_kg:"3.00"},
  ];
  const directory=[...machines,{machine_id:"P1",machine_name:"Printer",machine_name_ar:"طابعة"},{machine_id:"C1",machine_name:"Cutter",machine_name_ar:"قص"}];
  const event=(id,stage="film")=>({id:String(id),stage,registered_at:"2026-10-10T08:00:00Z",roll_id:id===102?101:id,
    roll_number:`JO-1-R${id===102?101:id}`,machine_id:stage==="printing"?"P1":stage==="cutting"?"C1":"F1",
    machine_name:stage==="printing"?"Printer":stage==="cutting"?"Cutter":"Film one",machine_name_ar:"ماكينة التشغيل",
    actor_id:2,actor_name:"Operator",actor_name_ar:"مشغل",order_number:"O-1",production_order_number:"JO-1",
    weight_kg:"1040.50",net_weight_kg:stage==="cutting"?"1000.00":null,waste_kg:stage==="cutting"?"40.50":null});
  const events=[event(103,"cutting"),event(102,"printing"),event(101),event(100)];
  const mix=(id,tracked=true)=>({id,machine_id:"F1",machine_name:"Film one",machine_name_ar:"فيلم واحد",screw:id%2?"A":"B",
    created_by:2,created_at:"2026-10-10T07:00:00Z",actor_name:"Operator",actor_name_ar:"مشغل",total_kg:"1200.25",
    consumed_kg:tracked?"1000.00":"0.00",remaining_kg:tracked?"200.25":null,tracked,notes:null,
    items:[{material_id:1,code:"HDPE",name:"High density resin",name_ar:"خام عالي الكثافة",quantity_kg:"1200.25"}]});
  const allocation=(id)=>({mix_id:id,roll_id:101,roll_number:"JO-1-R101",allocated_kg:"500.00",screw:id%2?"A":"B",mix_registered_at:"2026-10-10T07:00:00Z"});
  const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);console.log(`PASS ${name}`);passed++;};
  let send;
  try{
    const address=await new Promise((resolve,reject)=>{
      let text="";const timer=setTimeout(()=>reject(Error("Chromium startup timeout")),15000);
      chrome.stderr.on("data",data=>{text+=data;const match=text.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
      chrome.once("error",reject);
    });
    ws=new WebSocket(address);await new Promise((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});
    send=(method,params={},sessionId=session)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
    const fulfill=(requestId,body,status=200)=>send("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
    ws.on("message",raw=>{
      const e=JSON.parse(String(raw));
      if(e.id){const p=pending.get(e.id);if(p){pending.delete(e.id);e.error?p.reject(Error(JSON.stringify(e.error))):p.resolve(e.result);}return;}
      if(e.method==="Runtime.exceptionThrown")errors.push(e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);
      if(e.method!=="Fetch.requestPaused")return;
      void(async()=>{
        const {request,requestId}=e.params,url=new URL(request.url),route=url.pathname;
        calls.push({route,query:url.search,method:request.method});
        let body=[],status=200;
        if(route==="/api/me")body={user:{id:42,username:"fixture",display_name:"Fixture",display_name_ar:"تجريبي",permissions,preferred_language:language,
          role_name:"Administrator",role_id:10,role_preview:{active:!permissions.includes("admin"),original_role:{id:10,name:"Administrator"},original_permissions:["admin"]}}};
        else if(route==="/api/public-branding")body={companyNameEn:"MPBF",companyNameAr:"MPBF",logoSrc:null};
        else if(route==="/api/production/monitoring/summary")body={activated_at:"2026-10-10T06:00:00Z",machines,production_machines:directory};
        else if(route==="/api/production/monitoring/log"){
          if(failed){body={message:"تعذر تحميل السجل",message_en:"Fixture load failure"};status=500;}
          else{
            const cursor=url.searchParams.get("cursor"),stage=url.searchParams.get("stage"),search=url.searchParams.get("search");
            body={records:search==="none"?[]:cursor?[event(99)]:stage?events.filter(e=>e.stage===stage):events,next:cursor||search==="none"?null:"log-next"};
          }
        }else if(route==="/api/production/monitoring/mixes"){
          body={records:url.searchParams.get("cursor")?[mix(9,false)]:[mix(11),mix(10)],next:url.searchParams.get("cursor")?null:"mix-next"};
        }else if(/^\/api\/production\/monitoring\/mixes\/\d+$/.test(route)){
          body={mix:mix(Number(route.split("/").pop()),!route.endsWith("/9")),allocations:{records:[allocation(11)],next:url.searchParams.get("cursor")?null:"detail-next"}};
        }else if(/^\/api\/production\/monitoring\/rolls\/\d+$/.test(route)){
          const id=Number(route.split("/").pop());
          body={roll_id:id,roll_number:`JO-1-R${id}`,weight_kg:"1040.50",tracked:id!==100,
            uncovered_kg:id===100?null:"40.50",allocations:{records:id===100?[]:url.searchParams.get("cursor")?[allocation(9)]:[allocation(11),allocation(10)],next:id===100||url.searchParams.get("cursor")?null:"roll-next"}};
        }
        await fulfill(requestId,body,status);
      })().catch(err=>errors.push(err.message));
    });
    const target=await send("Target.createTarget",{url:"about:blank"},null);
    session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},null)).sessionId;
    await send("Page.enable");await send("Runtime.enable");await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    await send("Page.addScriptToEvaluateOnNewDocument",{source:`window.__monitorTicks=[];const schedule=window.setInterval.bind(window);
      window.setInterval=(fn,ms,...args)=>{if(ms===30000)window.__monitorTicks.push(fn);return schedule(fn,ms,...args)};`});
    const evaluate=async(expression)=>(await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result.value;
    const wait=async(expression)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timeout: ${expression}`);};
    const click=async(expression)=>{await evaluate(`(${expression}).click()`);await new Promise(r=>setTimeout(r,180));};
    const button=text=>click(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`);
    const input=async(selector,value)=>{await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
    const navigate=async()=>{await send("Page.navigate",{url:`${base}/planning/monitoring`});await wait("!!document.querySelector('.pm-page')");};
    if(!process.argv.includes("--behavior-only"))for(const lang of ["ar","en"])for(const width of [390,768,1280]){
      language=lang;permissions=["admin"];
      await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      await navigate();await wait("document.querySelectorAll('.pm-event').length===4");
      check(`${lang} ${width}: direction`,await evaluate("getComputedStyle(document.querySelector('.pm-page')).direction"),lang==="en"?"ltr":"rtl");
      check(`${lang} ${width}: monitoring navigation appears once`,await evaluate("document.querySelectorAll('.planning-nav a[href=\"/planning/monitoring\"]').length"),1);
      const fits=await evaluate("document.documentElement.scrollWidth<=innerWidth+1");
      if(!fits)console.log(await evaluate("Array.from(document.querySelectorAll('.pm-page *')).map(e=>({c:e.className,x:e.getBoundingClientRect().left,w:e.getBoundingClientRect().width,s:e.scrollWidth})).filter(e=>e.x<0||e.x+e.w>innerWidth+1).slice(0,18)"));
      check(`${lang} ${width}: no page overflow`,fits);
      check(`${lang} ${width}: all stages plus grouped gross/net/waste`,await evaluate(`document.querySelector('.pm-page').innerText.includes('1,040.5')&&document.querySelector('.pm-page').innerText.includes(${JSON.stringify(lang==="en"?"Cutting net":"الصافي بعد القص")})&&document.querySelector('.pm-page').innerText.includes(${JSON.stringify(lang==="en"?"Cutting waste":"هالك القص")})`));
      check(`${lang} ${width}: printer and cutter filters`,await evaluate("Array.from(document.querySelector('#pm-log-machine').options).map(o=>o.value).includes('P1')&&Array.from(document.querySelector('#pm-log-machine').options).map(o=>o.value).includes('C1')"));
      await click("document.querySelectorAll('.pm-event .pm-expand')[1]");await wait("!!document.querySelector('.pm-detail .pm-allocation')");
      check(`${lang} ${width}: multiple factual source screws and uncovered amount`,await evaluate("document.querySelector('.pm-detail').innerText.includes('A')&&document.querySelector('.pm-detail').innerText.includes('B')&&document.querySelector('.pm-detail').innerText.includes('40.5')"));
      check(`${lang} ${width}: unique accessible element IDs`,await evaluate("(()=>{const ids=Array.from(document.querySelectorAll('[id]')).map(e=>e.id);return ids.length===new Set(ids).size})()"));
      await button(lang==="en"?"Mix monitoring":"مراقبة الخلط");await wait("!!document.querySelector('.pm-balance')");
      check(`${lang} ${width}: lifetime balances and no negative remaining`,await evaluate("document.querySelector('.pm-balances').innerText.includes('1,200.25')&&document.querySelector('.pm-balances').innerText.includes('200.25')&&!document.querySelector('.pm-balances').innerText.includes('-3')"));
      if(lang==="en")check(`${lang} ${width}: no Arabic fallback names`,await evaluate("!/[\\u0600-\\u06ff]/.test(document.querySelector('.pm-balances').innerText)"));
      await click("document.querySelector('.pm-mix-card .pm-expand')");await wait("!!document.querySelector('.pm-detail .pm-allocation')");
      check(`${lang} ${width}: mix original material lines and linked rolls`,await evaluate("!!document.querySelector('.pm-material')&&document.querySelector('.pm-detail').innerText.includes('JO-1-R101')"));
      await click("document.querySelector('.pm-mixes > .pm-pager button:last-child')");await wait("!!document.querySelector('.pm-tracking:not(.is-tracked)')");
      check(`${lang} ${width}: pretracking stock explicitly excluded`,await evaluate(`document.querySelector('.pm-mix-card').innerText.includes(${JSON.stringify(lang==="en"?"Before tracking":"قبل بدء التتبع")})&&document.querySelector('.pm-mix-card').innerText.includes('—')`));
      check(`${lang} ${width}: phone/tablet metrics don't overlap`,await evaluate("Array.from(document.querySelectorAll('.pm-balance-cell')).every(e=>e.scrollWidth<=e.clientWidth+1)"));
      await fs.writeFile(`/tmp/monitoring-ui-${lang}-${width}.jpg`,Buffer.from((await send("Page.captureScreenshot",{format:"jpeg",quality:75})).data,"base64"));
    }
    language="en";await navigate();await wait("document.querySelectorAll('.pm-event').length===4");
    await click("document.querySelector('.pm-events > .pm-pager button:last-child')");await wait("document.querySelectorAll('.pm-event').length===1");
    check("bounded cursor next page",calls.filter(c=>c.route.endsWith("/monitoring/log")).at(-1).query.includes("cursor=log-next"));
    await click("document.querySelector('.pm-events > .pm-pager button:first-child')");await wait("document.querySelectorAll('.pm-event').length===4");
    check("previous resets to first snapshot without empty cursor",!calls.filter(c=>c.route.endsWith("/monitoring/log")).at(-1).query.includes("cursor="));
    await input("#pm-stage","printing");await wait("document.querySelectorAll('.pm-event').length===1");
    check("stage filter starts fresh bounded page",calls.filter(c=>c.route.endsWith("/monitoring/log")).at(-1).query.includes("stage=printing"));
    await input("#pm-stage","");await wait("document.querySelectorAll('.pm-event').length===4");
    await click("document.querySelector('.pm-event:last-of-type .pm-expand')");await wait("document.querySelector('.pm-detail').innerText.includes('Before tracking')");
    check("pretracking roll explicitly excludes fabricated uncovered quantity",await evaluate("document.querySelector('.pm-detail').innerText.includes('Before tracking')"));
    await input("#pm-search","none");await wait("document.querySelector('.pm-page').innerText.includes('No production events')");
    check("localized empty log",true);
    await input("#pm-search","");await wait("document.querySelectorAll('.pm-event').length===4");
    failed=true;await button("Refresh");await wait("document.querySelector('.pm-page').innerText.includes('Fixture load failure')");
    failed=false;await button("Retry");await wait("!document.querySelector('.pm-page').innerText.includes('Fixture load failure')");
    check("error and retry",true);
    const before=calls.filter(c=>c.route==="/api/production/monitoring/log").length;
    await evaluate("window.dispatchEvent(new Event('production-data-changed'))");
    await wait(`true`);await new Promise(r=>setTimeout(r,250));
    check("save events refresh bounded current page",calls.filter(c=>c.route==="/api/production/monitoring/log").length>before);
    const periodicBefore=calls.filter(c=>c.route.endsWith("/monitoring/log")).length;
    const inactiveMixBefore=calls.filter(c=>c.route.endsWith("/monitoring/mixes")).length;
    await evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});window.__monitorTicks.forEach(tick=>tick())");
    await new Promise(r=>setTimeout(r,200));
    check("hidden-page periodic tick performs no monitoring download",calls.filter(c=>c.route.endsWith("/monitoring/log")).length,periodicBefore);
    await evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});window.__monitorTicks.forEach(tick=>tick());window.__monitorTicks.forEach(tick=>tick())");
    await new Promise(r=>setTimeout(r,250));
    check("visible periodic ticks coalesce into one bounded log refresh",calls.filter(c=>c.route.endsWith("/monitoring/log")).length,periodicBefore+1);
    check("periodic refresh leaves inactive mix archive alone",calls.filter(c=>c.route.endsWith("/monitoring/mixes")).length,inactiveMixBefore);
    await evaluate("delete document.visibilityState");
    const archiveRequests=calls.filter(c=>c.route==="/api/production/state");
    check("monitoring never loads operator/management state",archiveRequests.length,0);
    for(const grant of ["manage_production","view_mixing","*"]){
      await send("Page.navigate",{url:"about:blank"});await wait("!document.querySelector('.pm-page')");
      permissions=[grant];const before=calls.filter(c=>c.route.includes("/monitoring/")).length;
      await navigate();await wait("!!document.querySelector('.pm-page .raw-ops-banner.error')");
      check(`${grant}: direct UI denied without requests`,calls.filter(c=>c.route.includes("/monitoring/")).length,before);
    }
    check("no browser runtime errors",errors,[]);
    console.log(`Monitoring browser verification: ${passed} checks passed.`);
  }finally{
    if(ws)ws.close();chrome.kill("SIGTERM");
    await new Promise(resolve=>chrome.once("exit",resolve));
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
