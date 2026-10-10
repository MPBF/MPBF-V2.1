// This harness connects only to disposable local PostgreSQL, never app data.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { ProductionExecutionService } from "../server/production/execution";
import { RawMixingService } from "../server/production/mixing";
import { ProductionMonitoringService } from "../server/production/monitoring";
import { kgHundredths } from "../shared/production";
import type { ConnectionPool } from "../server/production/core";

const pool=new Pool({host:"127.0.0.1",port:55439,user:"runner",database:"factory_isolated_test",max:12});
const schema=`monitor_test_${randomUUID().replaceAll("-","")}`;
const scoped:ConnectionPool={async connect(){const tx=await pool.connect();await tx.query(`SET search_path TO "${schema}"`);return tx;}};
const execution=new ProductionExecutionService(scoped), mixing=new RawMixingService(scoped), monitor=new ProductionMonitoringService(scoped);
const admin={id:1,permissions:["admin"]}, operator={id:2,permissions:["operate_film"]};
const key=()=>({request_id:randomUUID()});
let passed=0;
async function check(name:string,action:()=>Promise<void>){await action();console.log(`PASS ${name}`);passed++;}
async function query(sql:string,params:unknown[]=[]){const tx=await scoped.connect();try{return (await tx.query(sql,params)).rows;}finally{tx.release();}}
async function plan(id:number,product=1){
  await query("INSERT INTO orders VALUES($1,$2,'C1','for_production',NULL)",[id,`O-${id}`]);
  await query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status)
    VALUES($1,$1,$2,$3,1000,1000,'pending')`,[id,`JO-${id}`,product]);
  await execution.start(admin,id,key());
}
const film=(id:number,weight="10",machine_id="F1",inline=false)=>execution.film(operator,id,{...key(),machine_id,weight_kg:weight,inline_printed:inline});
let material:number;
const mix=(weight:string,machine_id="F1",screw:"A"|"B"="A")=>mixing.record(operator,{...key(),machine_id,screw,items:[{material_id:material,quantity_kg:weight}]});
const migration=readFileSync("migrations/0018_production_monitoring.sql","utf8");
try{
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await query(`
    CREATE TABLE users(id integer PRIMARY KEY,username text,display_name text,display_name_ar text,full_name text);
    CREATE TABLE customers(id varchar(20) PRIMARY KEY,name text,name_ar text,plate_drawer_code text);
    CREATE TABLE categories(id varchar(20) PRIMARY KEY,name text,name_ar text);
    CREATE TABLE items(id varchar(20) PRIMARY KEY,name text,name_ar text,code text,category_id varchar(20),status text);
    CREATE TABLE master_batch_colors(id varchar(20) PRIMARY KEY,name text,name_ar text,color_hex text);
    CREATE TABLE customer_products(id integer PRIMARY KEY,customer_id varchar(20),item_id varchar(20),
      width numeric,left_facing numeric,right_facing numeric,universal_thickness numeric,cutting_length_cm integer,
      raw_material text,printing_cylinder text,punching text,notes text,front_print_colors text[],back_print_colors text[],
      is_printed boolean,status text,size_caption text,master_batch_id varchar(20));
    CREATE TABLE machines(id varchar(20) PRIMARY KEY,name text,name_ar text,type text,status text,inline_printer_id varchar(20),
      min_thickness numeric,max_thickness numeric,min_width_cm numeric,max_width_cm numeric,raw_material_type text,
      max_print_colors integer,min_cylinder_inch numeric,max_cylinder_inch numeric,min_length_cm numeric,max_length_cm numeric,screw_type text);
    CREATE TABLE orders(id integer PRIMARY KEY,order_number text,customer_id varchar(20),status text,previous_status text);
    CREATE TABLE production_orders(id integer PRIMARY KEY,order_id integer REFERENCES orders(id),
      production_order_number varchar(50),customer_product_id integer,quantity_kg numeric(14,2),final_quantity_kg numeric(14,2),
      status text,batch_number varchar(50),previous_status text,overrun_percentage numeric DEFAULT 0);
    INSERT INTO users VALUES(1,'admin','Admin','مدير',NULL),(2,'operator','Operator','مشغل',NULL);
    INSERT INTO customers VALUES('C1','Customer','عميل',NULL);
    INSERT INTO categories VALUES('RAW','Raw Materials','المواد الخام');
    INSERT INTO items VALUES('BAG','Bag','كيس',NULL,NULL,'active'),('ROLL','Plastic Roll','رول بلاستيك',NULL,NULL,'active'),
      ('RAW','HDPE','خام','HDPE','RAW','active');
    INSERT INTO customer_products(id,customer_id,item_id,width,universal_thickness,cutting_length_cm,raw_material,printing_cylinder,is_printed,status)
    VALUES(1,'C1','BAG',28,25,41,'HDPE','16',true,'active'),(2,'C1','ROLL',28,25,41,'HDPE','16',false,'active');
    INSERT INTO machines(id,name,type,status,screw_type,inline_printer_id) VALUES
      ('F1','Film one','extruder','active','ABA','P1'),('F2','Film two','extruder','active','A',NULL),
      ('P1','Printer','Printer','active',NULL,NULL),('C1','Cutter','cutting','active',NULL,NULL);
  `);
  for(const file of ["0011_factory_roll_production.sql","0013_order_number_allocations.sql","0014_raw_material_mixing.sql","0015_raw_catalogue_movements.sql","0017_raw_mixing_screws.sql"])
    await query(readFileSync(`migrations/${file}`,"utf8"));
  material=(await mixing.state(admin)).materials[0].id;
  const historicalMix=await mix("100");
  await plan(1);
  // Historical film registered before activation, with genuine inline printing.
  await query(`INSERT INTO factory_rolls(production_order_id,sequence,roll_number,weight_kg,stage,film_machine_id,created_by,
    printing_machine_id,printed_by,printed_at) VALUES(1,1,'HIST',7,'printing','F1',2,'P1',2,clock_timestamp())`);
  await check("activation waits for pre-existing concurrent roll/mix writes",async()=>{
    const writer=await scoped.connect();
    await writer.query("BEGIN");
    await writer.query(`INSERT INTO factory_rolls(production_order_id,sequence,roll_number,weight_kg,stage,film_machine_id,created_by)
      VALUES(1,2,'HIST-RACE',1,'film','F1',2)`);
    await writer.query("INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw) VALUES('F1',2,9,'B')");
    const activate=query(migration);
    await new Promise(resolve=>setTimeout(resolve,40));
    await writer.query("COMMIT");writer.release();
    await activate;
    const boundary=(await query("SELECT * FROM factory_mix_activation"))[0];
    assert.equal(boundary.last_roll_id,2);assert.equal(boundary.last_mix_id,2);
  });
  const boundary=(await query("SELECT * FROM factory_mix_activation"))[0];
  await check("migration repeat keeps exact activation and no historical stock or consumption",async()=>{
    await query(migration);assert.deepEqual((await query("SELECT * FROM factory_mix_activation"))[0],boundary);
    assert.equal((await monitor.mix(admin,historicalMix.id)).mix.tracked,false);
    assert.equal((await monitor.mix(admin,historicalMix.id)).mix.remaining_kg,null);
    assert.equal((await monitor.summary(admin)).machines[0].mixed_kg,"0");
    assert.equal((await monitor.roll(admin,1)).tracked,false);
    assert.equal((await query("SELECT count(*)::int n FROM factory_roll_mix_tracking"))[0].n,0);
    const history=(await monitor.log(admin)).records;
    assert.deepEqual(new Set(history.map(e=>e.stage)),new Set(["film","printing"]));
  });
  await plan(2);
  const a=await mix("2.25","F1","A"),b=await mix("3.50","F1","B"),c=await mix("4.25","F1","A");
  await query("UPDATE factory_mixes SET created_at='2026-01-01T00:00:00Z' WHERE id=ANY($1::int[])",[[a.id,b.id,c.id]]);
  let rollId=0;
  await check("FIFO exact decimal multi-mix A/B interleaving and ID ties",async()=>{
    const rawBefore=await query("SELECT quantity_kg::text FROM factory_raw_materials");
    const roll=await film(2,"8.01");rollId=roll.id;
    assert.deepEqual(roll.mix_tracking,{consumed_kg:"8.01",uncovered_kg:"0.00"});
    const links=(await monitor.roll(admin,roll.id)).allocations.records.sort((x,y)=>x.mix_id-y.mix_id);
    assert.deepEqual(links.map(x=>[x.mix_id,x.allocated_kg,x.screw]),[[a.id,"2.25","A"],[b.id,"3.50","B"],[c.id,"2.26","A"]]);
    assert.deepEqual(await query("SELECT quantity_kg::text FROM factory_raw_materials"),rawBefore);
  });
  await check("partial shortage saves successfully; later mix cannot cover old deficit",async()=>{
    const shortage=await film(2,"5.00");
    assert.deepEqual(shortage.mix_tracking,{consumed_kg:"1.99",uncovered_kg:"3.01"});
    await mix("2.00");
    assert.equal((await monitor.roll(admin,shortage.id)).uncovered_kg,"3.01");
    const balance=(await monitor.summary(admin)).machines.find(m=>m.machine_id==="F1")!;
    assert.equal(kgHundredths(balance.mixed_kg),kgHundredths(balance.consumed_kg)+kgHundredths(balance.remaining_kg));
    assert.equal(kgHundredths(balance.film_kg),kgHundredths(balance.consumed_kg)+kgHundredths(balance.uncovered_kg));
    assert.equal(balance.remaining_kg,"2.00");
  });
  await plan(3);await plan(4);
  await check("concurrent orders consume one machine pool without over-allocation",async()=>{
    const results=await Promise.all([film(3,"2"),film(4,"2")]);
    assert.equal(results.reduce((n,r)=>n+kgHundredths(r.mix_tracking.consumed_kg),0n),200n);
    assert.equal(results.reduce((n,r)=>n+kgHundredths(r.mix_tracking.uncovered_kg),0n),200n);
    assert.equal((await monitor.summary(admin)).machines.find(m=>m.machine_id==="F1")!.remaining_kg,"0.00");
  });
  await check("machine isolation and no-mix film keeps uncovered quantity",async()=>{
    const roll=await film(3,"1.23","F2");
    assert.deepEqual(roll.mix_tracking,{consumed_kg:"0.00",uncovered_kg:"1.23"});
    const f2=await mix("1.23","F2");
    assert.equal((await monitor.mix(admin,f2.id)).mix.remaining_kg,"1.23");
    assert.equal((await monitor.roll(admin,roll.id)).uncovered_kg,"1.23");
  });
  await check("lost response concurrent same-request replay is immutable",async()=>{
    await mix("8");
    const input={...key(),machine_id:"F1",weight_kg:"3.21"};
    const before=(await query("SELECT count(*)::int n FROM factory_rolls"))[0].n;
    const [one,two]=await Promise.all([execution.film(operator,3,input),execution.film(operator,3,input)]);
    assert.equal(one.id,two.id);assert.deepEqual(JSON.parse(JSON.stringify(one)),JSON.parse(JSON.stringify(two)));
    assert.equal((await query("SELECT count(*)::int n FROM factory_rolls"))[0].n,before+1);
    const saved=(await query("SELECT result FROM factory_operations WHERE request_id=$1",[input.request_id]))[0].result;
    assert.deepEqual(await execution.film(operator,3,input),saved);
    const previous={...key(),machine_id:"F1",weight_kg:"5"};
    const canonical=(value:any):string=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`
      :value&&typeof value==="object"?`{${Object.entries(value).filter(([k])=>k!=="request_id").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`:JSON.stringify(value);
    const oldResult={id:876,weight_kg:"5.00"};
    await query("INSERT INTO factory_operations(actor_id,request_id,operation,fingerprint,result) VALUES(2,$1,'film:3',$2,$3)",
      [previous.request_id,createHash("sha256").update(canonical(previous)).digest("hex"),JSON.stringify(oldResult)]);
    assert.deepEqual(await execution.film(operator,3,previous),oldResult);
  });
  await check("printing/cutting/page refresh neither consume again nor deduct raw",async()=>{
    const tracking=await query("SELECT * FROM factory_mix_allocations ORDER BY mix_id,roll_id");
    const raw=await query("SELECT quantity_kg::text FROM factory_raw_materials");
    await execution.print(admin,rollId,{...key(),machine_id:"P1"});
    await execution.cut(admin,rollId,{...key(),machine_id:"C1",net_weight_kg:"7"});
    await monitor.summary(admin);await monitor.log(admin);await monitor.mixes(admin);await mixing.state(admin);
    assert.deepEqual(await query("SELECT * FROM factory_mix_allocations ORDER BY mix_id,roll_id"),tracking);
    assert.deepEqual(await query("SELECT quantity_kg::text FROM factory_raw_materials"),raw);
    const log=(await monitor.log(admin)).records.filter(e=>e.roll_id===rollId);
    assert.equal(log.length,3);
    assert.equal(log.find(e=>e.stage==="cutting")!.net_weight_kg,"7.00");
    assert.equal(log.find(e=>e.stage==="cutting")!.waste_kg,"1.01");
  });
  await plan(5,2);
  await check("automatic roll-product completion never fabricates cutting/printing events",async()=>{
    const roll=await execution.film(operator,5,{...key(),machine_id:"F1",weight_kg:"1",is_last_roll:true});
    const events=(await monitor.log(admin)).records.filter(e=>e.roll_id===roll.id);
    assert.equal(roll.stage,"done");assert.deepEqual(events.map(e=>e.stage),["film"]);
  });
  await check("inline printing has distinct equal-timestamp identity; stable snapshot while arrivals commit",async()=>{
    const inline=await film(3,"1","F1",true);
    const start=await monitor.log(admin,{limit:2});
    assert.equal(start.records[0].roll_id,inline.id);assert.equal(start.records[1].roll_id,inline.id);
    assert.notEqual(start.records[0].id,start.records[1].id);
    assert.equal(new Date(start.records[0].registered_at).getTime(),new Date(start.records[1].registered_at).getTime());
    const expected=(await monitor.log(admin,{limit:100})).records.map(e=>e.id);
    const late=await scoped.connect();
    await late.query("BEGIN");
    await late.query(`UPDATE factory_rolls SET printed_at=clock_timestamp(),printing_machine_id='P1',printed_by=1 WHERE id=(SELECT max(id) FROM factory_rolls WHERE printed_at IS NULL AND stage='film')`);
    const snapshot=await monitor.log(admin,{limit:2});
    await late.query("COMMIT");late.release();
    await film(3,"1");
    const seen=snapshot.records.map(e=>e.id);
    let cursor=snapshot.next;
    while(cursor){const page=await monitor.log(admin,{limit:2,cursor});seen.push(...page.records.map(e=>e.id));cursor=page.next;}
    assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,seen.length);
    await assert.rejects(monitor.log(admin,{cursor:start.next!,stage:"printing"}),{status:400});
    const stage=(await monitor.log(admin,{stage:"cutting",machine_id:"C1",search:"JO-2"})).records;
    assert.equal(stage.length,1);assert.equal(stage[0].roll_id,rollId);
  });
  await check("film transaction failure rolls back roll, allocation, event, transition and request result",async()=>{
    await mix("10");
    const input={...key(),machine_id:"F1",weight_kg:"2",is_last_roll:true};
    const before=await query(`SELECT (SELECT count(*) FROM factory_rolls)::int rolls,
      (SELECT count(*) FROM factory_mix_allocations)::int links,(SELECT count(*) FROM factory_production_events)::int events`);
    const failing:ConnectionPool={async connect(){const tx=await scoped.connect();return{
      release:()=>tx.release(),query:async(sql,values)=>{if(sql.startsWith("INSERT INTO factory_operations"))throw Error("forced result failure");return tx.query(sql,values);}};}};
    await assert.rejects(new ProductionExecutionService(failing).film(operator,3,input),/forced result failure/);
    assert.deepEqual(await query(`SELECT (SELECT count(*) FROM factory_rolls)::int rolls,
      (SELECT count(*) FROM factory_mix_allocations)::int links,(SELECT count(*) FROM factory_production_events)::int events`),before);
    assert.equal((await query("SELECT film_closed_at FROM factory_execution WHERE production_order_id=3"))[0].film_closed_at,null);
    assert.equal((await query("SELECT count(*)::int n FROM factory_operations WHERE request_id=$1",[input.request_id]))[0].n,0);
  });
  await check("mix race: uncommitted mix excluded until machine lock released",async()=>{
    // Drain current stock to make the race observable.
    await film(3,"100");
    const tx=await scoped.connect();await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-mix-pool:F1',0))");
    await tx.query("INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw) VALUES('F1',2,4,'B')");
    const pending=film(3,"5");await new Promise(resolve=>setTimeout(resolve,60));
    await tx.query("COMMIT");tx.release();
    const roll=await pending;
    assert.deepEqual(roll.mix_tracking,{consumed_kg:"4.00",uncovered_kg:"1.00"});
    const tx2=await scoped.connect();await tx2.query("BEGIN");
    await tx2.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-mix-pool:F1',0))");
    await tx2.query("INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw) VALUES('F1',2,100,'A')");
    const rolledBack=film(3,"1");await tx2.query("ROLLBACK");tx2.release();
    assert.equal((await rolledBack).mix_tracking.uncovered_kg,"1.00");
  });
  await check("bounded mix/detail pages and signed cursor rejection",async()=>{
    const page=await monitor.mixes(admin,{limit:2,machine_id:"F1"});
    assert.equal(page.records.length,2);assert.ok(page.next);
    const next=await monitor.mixes(admin,{limit:2,machine_id:"F1",cursor:page.next!});
    assert.ok(next.records.every(row=>!page.records.some(old=>old.id===row.id)));
    await assert.rejects(monitor.mixes(admin,{cursor:"forged"}),{status:400});
    assert.ok((await monitor.mix(admin,a.id)).allocations.records.length);
  });
  await check("FIFO batches, future exclusion, exact totals and multi-page roll sources",async()=>{
    await film(3,"1.23","F2");
    await query(`INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw)
      SELECT 'F2',2,0.01,CASE WHEN n%2=0 THEN 'A' ELSE 'B' END FROM generate_series(1,105) n`);
    const future=(await query(`INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw,created_at)
      VALUES('F2',2,10,'A',clock_timestamp()+interval '1 day') RETURNING id`))[0];
    const roll=await film(3,"1.05","F2");
    assert.deepEqual(roll.mix_tracking,{consumed_kg:"1.05",uncovered_kg:"0.00"});
    const first=await monitor.roll(admin,roll.id);
    const second=await monitor.roll(admin,roll.id,first.allocations.next!);
    const third=await monitor.roll(admin,roll.id,second.allocations.next!);
    assert.deepEqual([first.allocations.records.length,second.allocations.records.length,third.allocations.records.length],[50,50,5]);
    assert.equal(third.allocations.next,null);
    const links=[...first.allocations.records,...second.allocations.records,...third.allocations.records];
    assert.equal(new Set(links.map(link=>link.mix_id)).size,105);
    assert.ok(links.every(link=>link.mix_id!==future.id && link.allocated_kg==="0.01"));
    assert.equal((await monitor.mix(admin,future.id)).mix.remaining_kg,"10.00");
    await assert.rejects(query("UPDATE factory_roll_mix_tracking SET uncovered_kg=0.01 WHERE roll_id=$1",[roll.id]),
      (err:any)=>err.code==="23514");
  });
  await check("multi-page mix links stay bounded without repeated raw deduction",async()=>{
    await film(3,"100","F1");
    const source=await mix("1.00");
    const raw=await query("SELECT quantity_kg::text FROM factory_raw_materials ORDER BY id");
    for(let n=0;n<51;n++)await film(3,"0.01");
    const first=await monitor.mix(admin,source.id);
    const second=await monitor.mix(admin,source.id,first.allocations.next!);
    assert.deepEqual([first.allocations.records.length,second.allocations.records.length],[50,1]);
    assert.equal(second.allocations.next,null);
    assert.equal(new Set([...first.allocations.records,...second.allocations.records].map(link=>link.roll_id)).size,51);
    assert.equal(first.mix.consumed_kg,"0.51");assert.equal(first.mix.remaining_kg,"0.49");
    assert.deepEqual(await query("SELECT quantity_kg::text FROM factory_raw_materials ORDER BY id"),raw);
  });
  console.log(`Monitoring PostgreSQL verification: ${passed} scenarios passed.`);
}finally{
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
