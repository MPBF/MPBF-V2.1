// Actual HR audit component with synthetic attendance only; never uses live sessions.
const {build}=require("esbuild");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs/promises");
const {spawn,execFileSync}=require("node:child_process");
const WebSocket=require("ws");
(async()=>{
  const temp=await fs.mkdtemp("/tmp/hr-hours-");let server,chrome,ws;
  try{
    await build({stdin:{contents:`
      import React from 'react';import{createRoot}from'react-dom/client';
      import Page from './client/src/pages/HumanResourcesOperations';
      import i18n from './client/src/i18n';import './client/src/pages/human-resources.css';
      import './client/src/styles/theme-tokens.css';
      const en=new URLSearchParams(location.search).has('en');await i18n.changeLanguage(en?'en':'ar');
      document.documentElement.dir=en?'ltr':'rtl';
      const employee={id:7,username:'test',display_name:'Test employee',display_name_ar:'موظف تجريبي',section_id:null};
      const sessions=[
        {id:1,date:'2026-10-16',expected:450,times:['08:00','12:00','12:30','17:00']},
        {id:2,date:'2026-10-17',expected:450,times:['08:00',null,null,null]},
        {id:3,date:'2026-10-18',expected:450,times:['20:00','23:00','23:30','05:00']},
        {id:4,date:'2026-10-19',expected:null,times:['08:00',null,null,'15:00']}
      ];
      const actions=['check_in','break_start','break_end','check_out'];
      const events=sessions.flatMap(s=>s.times.flatMap((time,i)=>time?[{...employee,id:s.id*10+i,user_id:7,session_id:s.id,
        shift_date:s.date,expected_minutes:s.expected,shift_id:'N',shift_name_ar:'وردية تجريبية',shift_name_en:'Test shift',
        action:actions[i],occurred_at:(s.id===3&&i===3?'2026-10-19':s.date)+'T'+time+':00+03:00'}]:[]));
      window.calls=[];window.fetch=async(path,options={})=>{
        if(options.method&&options.method!=='GET')throw Error('Unexpected write');
        window.calls.push(String(path));
        return{ok:true,json:async()=>String(path).includes('/attendance-events?')?events:[]};
      };
      createRoot(document.getElementById('root')).render(<main className="hr-page"><Page tab="audit" employees={[employee]}/></main>);
    `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,platform:"browser",format:"esm",jsx:"automatic",outfile:temp+"/check.js",logLevel:"silent"});
    server=http.createServer(async(req,res)=>{
      const name=req.url.split("?")[0];if(name==="/check.js"||name==="/check.css"){
        res.setHeader("Content-Type",name.endsWith("css")?"text/css":"text/javascript");return res.end(await fs.readFile(temp+name));
      }
      res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/check.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}main{padding:16px;min-width:0}</style></head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>');
    });await new Promise(r=>server.listen(0,"127.0.0.1",r));
    chrome=spawn(execFileSync("which",["chromium"],{encoding:"utf8"}).trim(),["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${temp}/profile`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
    const address=await new Promise((resolve,reject)=>{let text="";const timer=setTimeout(()=>reject(Error("Chrome timeout")),20000);chrome.stderr.on("data",c=>{text+=c;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
    ws=new WebSocket(address);await new Promise(r=>ws.once("open",r));
    let serial=0,session;const pending=new Map(),errors=[];
    ws.on("message",raw=>{const d=JSON.parse(raw);if(d.method==="Runtime.exceptionThrown")errors.push(d.params.exceptionDetails.text);if(!d.id)return;const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);});
    const send=(method,params={},browser=false)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(!browser&&session?{sessionId:session}:{})}));});
    const target=await send("Target.createTarget",{url:"about:blank"},true);session=(await send("Target.attachToTarget",{targetId:target.targetId,flatten:true},true)).sessionId;
    await send("Page.enable");await send("Runtime.enable");
    const evaluate=async expression=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
    const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error("Timeout "+expression);};
    for(const width of [390,768,1280])for(const en of [false,true]){
      await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      await send("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?${en?"en=1":""}`});
      await wait("document.querySelectorAll('.hr-audit-table tbody tr').length===4");
      const headers=await evaluate("[...document.querySelectorAll('.hr-audit-table th')].map(e=>e.textContent)");
      assert.deepEqual(headers.slice(-3),en?["Working hours","Overtime","Actions"]:["ساعات العمل","الإضافي","الإجراءات"]);
      const rows=await evaluate("[...document.querySelectorAll('.hr-audit-table tbody tr')].map(e=>({date:e.children[1].textContent,totals:[...e.querySelectorAll('.hr-audit-minutes')].map(t=>t.textContent),status:!!e.querySelector('button.hr-audit-status')}))");
      assert.deepEqual(rows.map(r=>r.totals),[["07:00","—"],["08:30","01:00"],["—","—"],["08:30","01:00"]]);
      assert.ok(rows.every(r=>r.status));
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"),`page overflow ${width}`);
      assert.ok(await evaluate("document.querySelector('.hr-table-wrap').scrollWidth>document.querySelector('.hr-table-wrap').clientWidth")||width===1280,"table scrolls without page overflow");
      await evaluate("document.querySelectorAll('.hr-audit-status')[2].click()");
      await wait("!!document.querySelector('.hr-correction-modal')");
      assert.equal(await evaluate("document.querySelector('#correction-check_out-minute').value"),"00");
      assert.equal(await evaluate("document.querySelector('#correction-check_out-hour').value"),"");
      assert.equal(await evaluate("document.querySelector('#correction-check_in-hour').value"),"08");
      assert.equal(await evaluate("document.querySelector('.hr-correction-modal').textContent.includes('أدخل وقت الرياض فقط.')"),false);
      assert.ok(await evaluate("document.querySelector('.hr-correction-fields').getBoundingClientRect().width<=Math.max(320,document.querySelector('.hr-correction-modal').clientWidth/2)+1"));
      await evaluate(`(() => {const s=document.querySelector('#correction-check_out-hour');s.value='17';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("document.querySelector('#correction-check_out-hour').value==='17'");
      assert.equal(await evaluate("document.querySelector('#correction-check_out-minute').value"),"00");
      assert.equal(await evaluate("document.querySelector('.hr-correction-modal footer button').disabled"),false,"untouched default break minutes must not create break events");
      assert.ok(await evaluate("[...document.querySelectorAll('.hr-correction-modal select')].every(e=>e.getBoundingClientRect().width>=44)"),"compact selectors remain usable");
      assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"),"no modal page overflow");
      console.log(`PASS ${width}px ${en?"English":"Arabic"} headers, net time, overtime, overnight, incomplete, missing duration, status controls, responsive scroll`);
    }
    assert.deepEqual(errors,[]);
  }finally{
    ws?.close();if(chrome&&chrome.exitCode===null){chrome.kill("SIGKILL");await new Promise(r=>chrome.once("close",r));}
    if(server)await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
