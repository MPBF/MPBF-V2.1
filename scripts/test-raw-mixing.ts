// Run against an isolated local PostgreSQL instance, never factory records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { RawMixingService } from "../server/production/mixing";
import { ProductionError } from "../server/production/core";
import { kgHundredths, type ProductionUser } from "../shared/production";

const pool = new Pool({ host:"127.0.0.1",port:55439,user:"postgres",database:"postgres",max:10 });
const schema=`mixing_test_${process.pid}`;
const scoped={
  async connect() {
    const client=await pool.connect();
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  },
};
const service=new RawMixingService(scoped);
const admin:ProductionUser={id:1,permissions:["admin"]};
const film:ProductionUser={id:2,permissions:["operate_film"]};
const key=()=>({request_id:randomUUID()});
let passed=0;
const check=(name:string, actual:unknown, expected:unknown=true)=>{assert.deepEqual(actual,expected,name);console.log(`PASS ${name}`);passed++;};
const rejected=async(name:string,fn:()=>Promise<unknown>,status?:number)=>{
  await assert.rejects(async()=>fn(),error=>error instanceof ProductionError && (!status || error.status===status));
  console.log(`PASS ${name}`);passed++;
};
async function query(sql:string,params:unknown[]=[]) {
  const tx=await scoped.connect();
  try{return (await tx.query(sql,params)).rows;}finally{tx.release();}
}
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const tx=await scoped.connect();
  try {
    await tx.query(`CREATE TABLE users(id int PRIMARY KEY,username text,full_name text,display_name text,display_name_ar text);
      CREATE TABLE machines(id varchar(20) PRIMARY KEY,name text,name_ar text,type text,status text,screw_type text);
      CREATE TABLE categories(id varchar(20) PRIMARY KEY,name text,name_ar text);
      CREATE TABLE items(id varchar(20) PRIMARY KEY,category_id varchar(20),code text,name text,name_ar text,status text);
      CREATE TABLE factory_operations(actor_id int,request_id uuid,operation text,fingerprint text,result jsonb,PRIMARY KEY(actor_id,request_id));
      CREATE TABLE factory_receipts(id serial PRIMARY KEY);
      INSERT INTO users VALUES(1,'admin','المدير','Admin','مدير'),(2,'operator','المشغل','Film operator','مشغل الفيلم');
      INSERT INTO machines VALUES('F1','Film One','فيلم واحد','extruder','active','A'),
        ('F2','Film Two','فيلم اثنان','Extruder','active','ABA'),('P1','Printer','طابعة','Printer','active',NULL),
        ('STOP','Stopped','متوقفة','extruder','inactive',NULL),
        ('DEFAULT','Default screw','لولب افتراضي','extruder','active',NULL);
      INSERT INTO categories VALUES('RAW','Raw Materials','المواد الخام'),('BAG','Bags','أكياس');
      INSERT INTO items VALUES('ITM001','RAW','HDPE','HDPE','بولي إيثيلين','active'),
        ('ITM002','RAW','LDPE','LDPE','خام منخفض','active'),('ITM003','BAG','BAG','Bag','كيس','active');`);
    await tx.query(readFileSync("migrations/0014_raw_material_mixing.sql","utf8"));
    await tx.query("CREATE TABLE factory_mix_activation(id integer PRIMARY KEY,last_mix_id integer); CREATE TABLE factory_mix_allocations(mix_id integer);");
    await tx.query(readFileSync("migrations/0023_mix_corrections.sql","utf8"));
    await tx.query(readFileSync("migrations/0017_raw_mixing_screws.sql","utf8"));
    await tx.query(readFileSync("migrations/0017_raw_mixing_screws.sql","utf8"));
    await tx.query(readFileSync("migrations/0015_raw_catalogue_movements.sql","utf8"));
    await tx.query(readFileSync("migrations/0015_raw_catalogue_movements.sql","utf8"));
    await tx.query(readFileSync("migrations/0014_raw_material_mixing.sql","utf8"));
  }finally{tx.release();}
  const catalogue=await service.state(admin);
  const hdpe=catalogue.materials.find(r=>r.item_id==="ITM001")!;
  const ldpe=catalogue.materials.find(r=>r.item_id==="ITM002")!;
  check("only predefined raw-category items appear",catalogue.materials.map(r=>r.item_id),["ITM001","ITM002"]);
  check("catalogue provision starts at zero",catalogue.materials.every(r=>r.quantity_kg==="0.00"));
  check("zero-history materials have exact zero warehouse totals",catalogue.materials.every(r=>r.total_received_kg==="0" && r.total_issued_kg==="0"));
  const initialReceipt=await service.movement(admin,{...key(),kind:"receipt",items:[{material_id:hdpe.id,quantity_kg:"10.00"}]});
  check("raw receipt stock and audit",await query("SELECT quantity_kg::text FROM factory_raw_materials ORDER BY id"),[{quantity_kg:"10.00"},{quantity_kg:"0.00"}]);
  check("receipt actor is server-authoritative",initialReceipt.created_by,1);
  await service.state(admin);
  check("refresh never resets balances",(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[hdpe.id]))[0].quantity_kg,"10.00");
  const input={...key(),machine_id:"F1",notes:"actual mix",items:[{material_id:hdpe.id,quantity_kg:"12.25"},{material_id:ldpe.id,quantity_kg:"0.01"}]};
  const mix=await service.record(film,input);
  check("single screw legacy input defaults to A",(await query("SELECT screw FROM factory_mixes WHERE id=$1",[mix.id]))[0].screw,"A");
  await rejected("ABA requires explicit screw",()=>service.record(film,{...input,...key(),machine_id:"F2"}),400);
  await rejected("single screw rejects B",()=>service.record(film,{...input,...key(),screw:"B"}),400);
  await rejected("invalid screw rejected at service",()=>service.record(film,{...input,...key(),screw:"C" as "A"}),400);
  const defaultMix=await service.record(film,{...input,...key(),machine_id:"DEFAULT"});
  check("null machine configuration is single A",(await query("SELECT screw FROM factory_mixes WHERE id=$1",[defaultMix.id]))[0].screw,"A");
  check("insufficient raw stock accepted at exact weight",mix.balances,[{id:hdpe.id,quantity_kg:"-2.25"},{id:ldpe.id,quantity_kg:"-0.01"}]);
  check("mix actor and actual total", [mix.created_by,mix.total_kg],[film.id,"12.26"]);
  check("no receipt vouchers generated",(await query("SELECT count(*)::int n FROM factory_receipts"))[0].n,0);
  const retried=await service.record(film,input);
  check("lost-response replay returns one mix",retried.id,mix.id);
  check("replay never deducts again",(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[hdpe.id]))[0].quantity_kg,"-14.50");
  await rejected("screw participates in committed request conflict",()=>service.record(film,{...input,screw:"A"}),409);
  // Seed the exact pre-upgrade request fingerprint/result. Replay must precede
  // screw validation, even when a historical machine is now ABA or stopped.
  const legacy={...key(),machine_id:"F2",items:[{material_id:hdpe.id,quantity_kg:"2"}]};
  const canonical=(v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v==="object" ? `{${Object.entries(v).filter(([k])=>k!=="request_id").sort(([a],[b])=>a.localeCompare(b)).map(([k,val])=>`${JSON.stringify(k)}:${canonical(val)}`).join(",")}}`
    : JSON.stringify(v) ?? "null";
  const legacyResult={id:876,total_kg:"2.00",balances:[]};
  await query("INSERT INTO factory_operations VALUES($1,$2,'raw-mixing',$3,$4)",[film.id,legacy.request_id,createHash("sha256").update(canonical(legacy)).digest("hex"),JSON.stringify(legacyResult)]);
  check("committed unlabeled legacy replay remains exact",await service.record(film,legacy),legacyResult);
  await rejected("changed request payload cannot reuse committed key",()=>service.record(film,{...input,notes:"different"}),409);
  const duplicate={...key(),machine_id:"F1",items:[{material_id:hdpe.id,quantity_kg:"1"},{material_id:hdpe.id,quantity_kg:"1"}]};
  await rejected("duplicate material rejected",()=>service.record(film,duplicate),400);
  await rejected("wrong machine rejected",()=>service.record(film,{...input,...key(),machine_id:"P1"}),400);
  await rejected("inactive machine rejected",()=>service.record(film,{...input,...key(),machine_id:"STOP"}),400);
  await rejected("missing machine rejected",()=>service.record(film,{...input,...key(),machine_id:"missing"}),404);
  await rejected("unknown material rolls back",()=>service.record(film,{...input,...key(),items:[{material_id:999,quantity_kg:"1"}]}),400);
  await rejected("zero weight rejected",()=>service.record(film,{...input,...key(),items:[{material_id:hdpe.id,quantity_kg:"0"}]}),400);
  await query("UPDATE factory_raw_materials SET is_active=false WHERE id=$1",[ldpe.id]);
  await rejected("inactive material rejected",()=>service.record(film,{...input,...key()}),400);
  await query("UPDATE factory_raw_materials SET is_active=true WHERE id=$1",[ldpe.id]);
  for (const permission of ["operate_printing","operate_cutting","view_mixing","view_raw_inventory"]) {
    await rejected(`${permission} cannot submit mixes`,()=>service.record({...film,permissions:[permission]},{...input,...key()}),403);
  }
  await rejected("film operator cannot issue or receive raw stock",()=>service.movement(film,{...key(),kind:"receipt",items:[{material_id:hdpe.id,quantity_kg:"1"}]}),403);
  await rejected("unrelated read denied",()=>service.state({...film,permissions:["operate_printing"]}),403);
  const view=await service.state(film);
  check("history actor, machine, material details", [view.records.find(r=>r.id===mix.id)!.actor_name_ar,view.records.find(r=>r.id===mix.id)!.machine_name,view.records.find(r=>r.id===mix.id)!.items.length],["مشغل الفيلم","Film One",2]);
  const rawOnly=await service.state({...film,permissions:["view_raw_inventory"]});
  check("raw readers get stock, not mixes or machine lists",[rawOnly.materials.length,rawOnly.records.length,rawOnly.machines.length,rawOnly.latest_mixes.length],[2,0,0,0]);
  const before=(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[hdpe.id]))[0].quantity_kg;
  const concurrent=Array.from({length:12},(_,i)=>service.record(film,{...key(),machine_id:i%2?"F1":"F2",screw:i%2?"A":"B",items:[
    {material_id:hdpe.id,quantity_kg:"0.01"},{material_id:ldpe.id,quantity_kg:"0.02"},
  ].reverse().slice().sort((a,b)=>i%2?a.material_id-b.material_id:b.material_id-a.material_id)}));
  await Promise.all(concurrent);
  check("concurrent mixes preserve every deduction",(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[hdpe.id]))[0].quantity_kg,(Number(before)-0.12).toFixed(2));
  const repeated={...key(),machine_id:"F1",items:[{material_id:hdpe.id,quantity_kg:"1"}]};
  const replays=await Promise.all(Array.from({length:6},()=>service.record(film,repeated)));
  check("concurrent same-request replay creates once",new Set(replays.map(r=>r.id)).size,1);
  const totals=async()=>(await query(`SELECT (SELECT count(*)::int FROM factory_mixes) mixes,
    (SELECT count(*)::int FROM factory_raw_movements) movements,
    (SELECT sum(quantity_kg)::text FROM factory_raw_materials) quantity`))[0];
  const previous=await totals();
  await query(`CREATE FUNCTION fail_raw_movement() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind='mixing' THEN RAISE EXCEPTION 'injected audit write failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_audit BEFORE INSERT ON factory_raw_movements FOR EACH ROW EXECUTE FUNCTION fail_raw_movement();`);
  const recover={...key(),machine_id:"F1",items:[{material_id:hdpe.id,quantity_kg:"1"}]};
  await assert.rejects(()=>service.record(film,recover),/injected/);
  check("audit failure rolls back whole mix and balance",await totals(),previous);
  await query("DROP TRIGGER fail_audit ON factory_raw_movements");
  await service.record(film,recover);
  check("same request can recover after rollback",(await totals()).mixes,previous.mixes+1);
  const savedA=await service.record(film,{...key(),machine_id:"F2",screw:"A",items:[{material_id:hdpe.id,quantity_kg:"9"},{material_id:ldpe.id,quantity_kg:"1"}]});
  const savedB=await service.record(film,{...key(),machine_id:"F2",screw:"B",items:[{material_id:hdpe.id,quantity_kg:"2"},{material_id:ldpe.id,quantity_kg:"18"}]});
  // Highest ID wins even if timestamp is older, and null identities do not win.
  await query("UPDATE factory_mixes SET created_at='2000-01-01' WHERE id=$1",[savedA.id]);
  await query("INSERT INTO factory_mixes(machine_id,created_by,total_kg) SELECT 'F2',2,1 FROM generate_series(1,60)");
  const page1=await service.state(admin);
  const page2=await service.state(admin,page1.next_before!);
  check("bounded history first page",page1.records.length,50);
  check("next page has no duplicate IDs",page2.records.every(r=>!page1.records.some(p=>p.id===r.id)),true);
  const latest=page1.latest_mixes.filter(r=>r.machine_id==="F2");
  check("latest per screw is independent of 50-row history",latest.map(r=>[r.screw,r.id]),[["A",savedA.id],["B",savedB.id]]);
  check("older history does not redefine latest",page2.latest_mixes,page1.latest_mixes);
  check("legacy history stays unidentified",page1.records.every(r=>r.screw===null));
  check("latest carries precise weights",latest.map(r=>r.items.map(i=>i.quantity_kg)),[["9.00","1.00"],["2.00","18.00"]]);
  await query("UPDATE machines SET screw_type='A' WHERE id='F2'");
  check("configuration change never rewrites historical B",(await service.state(film)).latest_mixes.some(r=>r.id===savedB.id&&r.screw==="B"));
  check("committed B replay survives configuration change",(await service.record(film,{request_id:(await query("SELECT request_id FROM factory_operations WHERE result->>'id'=$1",[String(savedB.id)]))[0].request_id,machine_id:"F2",screw:"B",items:[{material_id:hdpe.id,quantity_kg:"2"},{material_id:ldpe.id,quantity_kg:"18"}]})).id,savedB.id);
  await query("UPDATE machines SET screw_type='ABA' WHERE id='F2'");
  await query("UPDATE items SET name='',name_ar=NULL WHERE id='ITM002'");
  const unnamed=await service.state(film);
  check("mixing catalog never replaces missing names with IDs",[unnamed.materials.find(r=>r.id===ldpe.id)!.name,unnamed.materials.find(r=>r.id===ldpe.id)!.name_ar],["",""]);
  check("history missing names stay blank",unnamed.latest_mixes.find(r=>r.id===savedB.id)!.items.find(r=>r.material_id===ldpe.id)!.name,"");
  await query("UPDATE items SET name='LDPE',name_ar='خام منخفض' WHERE id='ITM002'");
  check("stock audit matches current signed balances",await query(`SELECT r.id FROM factory_raw_materials r
    WHERE r.quantity_kg <> COALESCE((SELECT sum(quantity_kg) FROM factory_raw_movements m WHERE m.material_id=r.id),0)`),[]);
  const beforeIssue=(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[hdpe.id]))[0].quantity_kg;
  const issue={...key(),kind:"issue" as const,items:[{material_id:hdpe.id,quantity_kg:"100.25"}]};
  const issued=await service.movement(admin,issue);
  check("issue permits negative raw stock",issued.balances[0].quantity_kg,(Number(beforeIssue)-100.25).toFixed(2));
  check("issue retry creates exactly one voucher",(await service.movement(admin,issue)).id,issued.id);
  await rejected("changed issue payload conflicts",()=>service.movement(admin,{...issue,notes:"changed"}),409);
  for(const grant of ["view_raw_inventory","operate_film","view_mixing"]) {
    await rejected(`${grant} cannot post raw vouchers`,()=>service.movement({id:2,permissions:[grant]},{...key(),kind:"issue",items:[{material_id:hdpe.id,quantity_kg:"1"}]}),403);
  }
  const unlinked=(await query("INSERT INTO factory_raw_materials(code,name,name_ar) VALUES('legacy','Legacy','قديم') RETURNING id"))[0].id;
  await rejected("legacy free-form material cannot be newly selected",()=>service.record(film,{...key(),machine_id:"F1",items:[{material_id:unlinked,quantity_kg:"1"}]}),400);
  await query("UPDATE items SET category_id='BAG' WHERE id='ITM002'");
  await rejected("reclassified non-raw item cannot be mixed",()=>service.record(film,{...key(),machine_id:"F1",items:[{material_id:ldpe.id,quantity_kg:"1"}]}),400);
  await rejected("reclassified non-raw item cannot be received",()=>service.movement(admin,{...key(),kind:"receipt",items:[{material_id:ldpe.id,quantity_kg:"1"}]}),400);
  await query("UPDATE items SET category_id='RAW',status='inactive' WHERE id='ITM002'");
  await rejected("catalogue inactive item cannot be issued",()=>service.movement(admin,{...key(),kind:"issue",items:[{material_id:ldpe.id,quantity_kg:"1"}]}),400);
  await query("UPDATE items SET status='active' WHERE id='ITM002'");
  const common={...key(),kind:"receipt" as const,items:[{material_id:ldpe.id,quantity_kg:"7.25"}]};
  const concurrentReceipts=await Promise.all(Array.from({length:6},()=>service.movement(admin,common)));
  check("concurrent identical receipt commits once",new Set(concurrentReceipts.map(r=>r.id)).size,1);
  const startConcurrent=Number((await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[ldpe.id]))[0].quantity_kg);
  await Promise.all(Array.from({length:12},(_,i)=>i%3===0
    ? service.record(film,{...key(),machine_id:"F1",items:[{material_id:ldpe.id,quantity_kg:"0.25"}]})
    : service.movement(admin,{...key(),kind:i%3===1?"receipt":"issue",items:[{material_id:ldpe.id,quantity_kg:"0.50"}]})));
  check("receipts issues and mixing serialize without lost balance",(await query("SELECT quantity_kg::text FROM factory_raw_materials WHERE id=$1",[ldpe.id]))[0].quantity_kg,(startConcurrent-1).toFixed(2));
  const complete=(await service.state(admin)).raw_vouchers!;
  check("voucher history includes real actor and predefined items",complete.some(v=>v.id===issued.id&&v.created_by===1&&v.items[0].code==="HDPE"));
  check("film gets no raw voucher history",(await service.state(film)).raw_vouchers,[]);
  check("combined movement ledger matches balances",await query(`SELECT r.id FROM factory_raw_materials r
    WHERE r.quantity_kg <> COALESCE((SELECT sum(quantity_kg) FROM factory_raw_movements m WHERE m.material_id=r.id),0)`),[]);
  for (let i=0;i<51;i++) await service.movement(admin,{...key(),kind:"receipt",items:[{material_id:ldpe.id,quantity_kg:"0.01"}]});
  const totalsBefore = await service.state(admin);
  check("warehouse totals fixture exceeds the limited voucher feed",totalsBefore.raw_vouchers!.length,50);
  const totalMap = (snapshot: typeof totalsBefore) => new Map(snapshot.materials.map(r => [r.id, {
    received: kgHundredths(r.total_received_kg!), issued: kgHundredths(r.total_issued_kg!),
  }]));
  const baseTotals = totalMap(totalsBefore);
  const signedWeight = (value: string) => value.startsWith("-") ? -kgHundredths(value.slice(1)) : kgHundredths(value);
  check("all recorded receipt vouchers contribute, not only latest 50", totalsBefore.materials.every(r =>
    kgHundredths(r.total_received_kg!) === signedWeight(r.quantity_kg) + kgHundredths(r.total_issued_kg!)));
  check("mix-only operators do not receive warehouse aggregate fields", (await service.state(film)).materials.every(r =>
    r.total_received_kg === undefined && r.total_issued_kg === undefined));
  check("raw-only viewer receives the same totals", totalMap(await service.state({...film,permissions:["view_raw_inventory"]})),baseTotals);
  await query("INSERT INTO factory_mix_activation VALUES(1,0) ON CONFLICT (id) DO UPDATE SET last_mix_id=0");
  const correctionMix = await service.record(admin,{...key(),machine_id:"F1",items:[
    {material_id:hdpe.id,quantity_kg:"1.23"},{material_id:ldpe.id,quantity_kg:"0.45"},
  ]});
  const checkDelta = async (label: string, high: bigint, low: bigint) => {
    const actual=totalMap(await service.state(admin));
    check(label,[actual.get(hdpe.id)!.issued-baseTotals.get(hdpe.id)!.issued,
      actual.get(ldpe.id)!.issued-baseTotals.get(ldpe.id)!.issued],[high,low]);
    check(`${label}: corrections are not receipts`,[actual.get(hdpe.id)!.received,actual.get(ldpe.id)!.received],
      [baseTotals.get(hdpe.id)!.received,baseTotals.get(ldpe.id)!.received]);
  };
  await checkDelta("new mix contributes to total issued",123n,45n);
  await service.update(admin,correctionMix.id,{...key(),expected_revision:0,contents:{
    machine_id:"F1",screw:"A",items:[{material_id:hdpe.id,quantity_kg:"2.34"}],
  }});
  await checkDelta("increased mix and removed ingredient use net corrections",234n,0n);
  await service.update(admin,correctionMix.id,{...key(),expected_revision:1,contents:{
    machine_id:"F1",screw:"A",items:[{material_id:hdpe.id,quantity_kg:"0.10"},{material_id:ldpe.id,quantity_kg:"0.30"}],
  }});
  await checkDelta("decreased mix and re-added ingredient retain decimal totals",10n,30n);
  const cancellation = {...key(),expected_revision:2};
  await service.delete(admin,correctionMix.id,cancellation);
  await service.delete(admin,correctionMix.id,cancellation);
  await checkDelta("cancellation and lost-response retry restore outgoing totals exactly once",0n,0n);
  console.log(`Raw mixing PostgreSQL verification passed: ${passed} assertions.`);
}finally{
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>{});
  await pool.end();
}
