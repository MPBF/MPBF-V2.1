// This test never imports or connects to the application's database.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DataTransferService } from "../server/data-transfer/service";
import { discover, hash, type TransferPool } from "../server/data-transfer/schema";
import { makeBundle, parseFile, csvExport } from "../server/data-transfer/files";
import { valueFor } from "../server/data-transfer/validation";
import { FinishedDeliveryService } from "../server/production/delivery";
import { ProductionWarehouseService } from "../server/production/warehouse";
import type { TransferFile, TransferMapping, TransferPreview } from "../shared/data-transfer";
import { deliveryPrintHtml } from "../client/src/lib/delivery-print";

if (!process.argv.includes("--isolated")) throw Error("Run only with --isolated against the disposable local PostgreSQL cluster.");
const pool = new Pool({host:"127.0.0.1",port:55441,user:"runner",database:"safe_tools_test"});
const tools = new DataTransferService(pool);
let tests=0;
const test=async(name:string,action:()=>Promise<void>)=>{await action();console.log(`PASS ${name}`);tests++;};
const query=async(text:string,values:any[]=[]) => (await pool.query(text,values)).rows;
let version="";
const file=async(table:string,headers:string[],rows:Record<string,string|null>[])=>tools.readFile(1,Buffer.from(csvExport(headers,rows)),`${table}.csv`);
const mapping=(table:string,headers:string[],fileTable="file",nullColumns:string[]=[]):TransferMapping=>({
  table,fileTable,columns:Object.fromEntries(headers.map(h=>[h,h])),matchKey:["id"],nullColumns,
});
const preview=async(table:string,rows:Record<string,string|null>[],nullColumns:string[]=[])=>{
  const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  return tools.preview(1,version,await file(table,headers,rows),[mapping(table,headers,"file",nullColumns)]);
};
const counts=async()=>query(`SELECT (SELECT count(*) FROM customers)::int customers,
 (SELECT count(*) FROM categories)::int categories,(SELECT count(*) FROM items)::int items`);
try {
  await pool.query(`
    CREATE TABLE users(id integer PRIMARY KEY,password text);
    INSERT INTO users VALUES(1,'never-export'),(2,'never-export');
    CREATE TABLE customers(id varchar(20) PRIMARY KEY,name varchar(200) NOT NULL,name_ar varchar(200),
      tax_number varchar(20),unified_number varchar(10),phone varchar(20),is_active boolean DEFAULT true,
      created_at timestamp DEFAULT now(),sales_rep_id integer REFERENCES users(id));
    CREATE TABLE categories(id varchar(20) PRIMARY KEY,name varchar(100) NOT NULL,name_ar varchar(100),
      parent_id varchar(20),overrun_percentage integer NOT NULL DEFAULT 0 CHECK(overrun_percentage IN(0,5,10,20)));
    CREATE TABLE items(id varchar(20) PRIMARY KEY,name varchar(100),name_ar varchar(100),
      category_id varchar(20) REFERENCES categories(id),status varchar(20) DEFAULT 'active' CHECK(status IN('active','inactive')));
    CREATE TABLE customer_products(id serial PRIMARY KEY,customer_id varchar(20) REFERENCES customers(id),
      item_id varchar(20) REFERENCES items(id),width numeric(18,4),universal_thickness numeric GENERATED ALWAYS AS(width*2) STORED);
    CREATE TABLE machines(id varchar(20) PRIMARY KEY,name text);
    CREATE TABLE orders(id serial PRIMARY KEY,order_number text UNIQUE,customer_id varchar(20) REFERENCES customers(id),
      status text,share_token text);
    CREATE TABLE production_orders(id serial PRIMARY KEY,order_id integer REFERENCES orders(id),customer_product_id integer,
      production_order_number varchar(50),quantity_kg numeric(14,2),final_quantity_kg numeric(14,2),status text,batch_number text);
    CREATE TABLE order_number_allocations(sequence numeric PRIMARY KEY,order_number text);
    CREATE TABLE factory_locations(id serial PRIMARY KEY,name text,name_ar text,is_active boolean DEFAULT true);
    CREATE TABLE factory_execution(production_order_id integer PRIMARY KEY REFERENCES production_orders(id),
      customer_product_id integer,item_id varchar(20),product jsonb,is_printed boolean,is_roll_product boolean,
      film_closed_at timestamptz,completed_at timestamptz);
    CREATE TABLE factory_rolls(id serial PRIMARY KEY,production_order_id integer,weight_kg numeric(14,2),
      net_weight_kg numeric(14,2),waste_kg numeric(14,2) DEFAULT 0,stage text);
    CREATE TABLE factory_inventory(id serial PRIMARY KEY,production_order_id integer,customer_product_id integer,item_id varchar(20),
      location_id integer REFERENCES factory_locations(id),quantity_kg numeric(14,2) NOT NULL CHECK(quantity_kg>=0),
      UNIQUE(customer_product_id,production_order_id,location_id));
    CREATE TABLE factory_receipts(id serial PRIMARY KEY,voucher_number text UNIQUE,created_by integer,notes text,created_at timestamptz DEFAULT now());
    CREATE TABLE factory_receipt_items(id serial PRIMARY KEY,receipt_id integer,production_order_id integer,
      customer_product_id integer,item_id varchar(20),location_id integer,quantity_kg numeric(14,2),line_number integer);
    CREATE TABLE factory_movements(id serial PRIMARY KEY,receipt_id integer,receipt_item_id integer,quantity_kg numeric(14,2));
    CREATE TABLE factory_operations(id serial PRIMARY KEY,actor_id integer,request_id uuid,operation text,fingerprint text,result jsonb,
      UNIQUE(actor_id,request_id));
    CREATE TABLE discovered_business(id text PRIMARY KEY,name text);
    CREATE TABLE sessions(sid text PRIMARY KEY,sess jsonb);
    INSERT INTO customers(id,name,name_ar,phone) VALUES('CID001','Original','الأصلي','0500012345'),('CID002','Second','الثاني','0055');
    INSERT INTO categories(id,name) VALUES('CAT001','Bags');
    INSERT INTO items(id,name,category_id) VALUES('ITM001','Bag','CAT001');
    INSERT INTO customer_products(id,customer_id,item_id,width) VALUES(1,'CID001','ITM001',12345678901234.1234);
    INSERT INTO orders(id,order_number,customer_id,status,share_token) VALUES(1,'O0001','CID001','completed','never-export'),(2,'O0002','CID002','completed','never-export');
    INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status)
      VALUES(1,1,'JO0001',1,100,100,'completed'),(2,2,'JO0002',1,100,100,'completed');
    INSERT INTO factory_locations(name,name_ar) VALUES('Finished-goods hall','صالة المواد التامة');
    INSERT INTO factory_execution(production_order_id,customer_product_id,item_id,product,is_printed,is_roll_product,completed_at)
      VALUES(1,1,'ITM001','{"name":"Bag","name_ar":"كيس","customer_name":"Original","customer_name_ar":"الأصلي","id":1,"item_id":"ITM001"}',false,false,now()),
        (2,1,'ITM001','{"name":"Bag","name_ar":"كيس","id":1,"item_id":"ITM001"}',false,false,now());
    INSERT INTO factory_inventory(production_order_id,customer_product_id,item_id,location_id,quantity_kg) VALUES(1,1,'ITM001',1,100),(2,1,'ITM001',1,20);
    INSERT INTO factory_rolls(production_order_id,weight_kg,net_weight_kg,stage) VALUES(1,150,150,'done'),(2,20,20,'done');
    INSERT INTO factory_receipt_items(receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg) VALUES(1,1,1,'ITM001',1,100),(1,2,1,'ITM001',1,20);
  `);
  await pool.query(readFileSync("migrations/0020_data_transfer.sql","utf8"));
  await pool.query(readFileSync("migrations/0021_finished_deliveries.sql","utf8"));
  version=(await tools.schema()).version;
  await test("dynamic schema excludes authentication, tokens and generated writes; discovered tables stay unapproved",async()=>{
    const s=await tools.schema();
    assert.equal(s.ready,true);assert(!s.tables.some(t=>["users","sessions","data_transfer_previews"].includes(t.name)));
    assert(!s.tables.find(t=>t.name==="orders")!.columns.some(c=>c.name==="share_token"));
    assert.equal(s.tables.find(t=>t.name==="discovered_business")!.exportable,false);
    assert.equal(s.tables.find(t=>t.name==="customer_products")!.columns.find(c=>c.name==="universal_thickness")!.writable,false);
    await assert.rejects(()=>tools.export(1,["users"],"json",version));
    await assert.rejects(()=>tools.export(1,['customers";DROP TABLE items;--'],"csv",version));
  });
  await test("CSV round trip protects formulas, leading zeros, Arabic, quotes, newlines and null",async()=>{
    const original={id:"00001",name:"=HYPERLINK(\"unsafe\")",phone:"005500",name_ar:"عميل\n\"جديد\"",tax_number:null};
    const parsed=await parseFile(Buffer.from(csvExport(Object.keys(original),[original])),"a.csv",async()=>{throw Error("not JSON");});
    assert.deepEqual(parsed.tables[0].rows,[original]);
    await assert.rejects(()=>parseFile(Buffer.from('"id","name"\n"1","unterminated'),"bad.csv",async()=>{throw Error();}));
    await assert.rejects(()=>parseFile(Buffer.alloc(5242881),"big.csv",async()=>{throw Error();}));
  });
  await test("multiple selected CSV tables download as a manifest-backed ZIP with safe cells",async()=>{
    const ex=await tools.export(1,["customers","categories"],"csv",version);
    assert.equal(ex.type,"application/zip");assert.match(ex.filename,/\.zip$/);
    const archive=await JSZip.loadAsync(ex.body);
    const manifest=JSON.parse(await archive.file("_MPBF_manifest.json")!.async("string"));
    assert.equal(manifest.schemaVersion,version);assert.deepEqual(manifest.tables.map((t:any)=>t.name),["customers","categories"]);
    const sheet=await archive.file("customers.csv")!.async("string");
    assert(sheet.includes("0500012345"));assert(sheet.includes("CID001"));
  });
  await test("Excel exact text export/import; formula and decimal-number cells rejected",async()=>{
    const ex=await tools.export(1,["customers"],"xlsx",version);
    const loaded=await tools.readFile(1,ex.body,"valid.xlsx");
    assert.equal(loaded.tables[0].rows[0].phone,"0500012345");
    const wb=new ExcelJS.Workbook();const sheet=wb.addWorksheet("file");sheet.addRow(["id","name"]);sheet.addRow(["CID003",{formula:"1+1"}]);
    const formulaBytes=Buffer.from(await wb.xlsx.writeBuffer());await assert.rejects(()=>tools.readFile(1,formulaBytes,"bad.xlsx"));
    sheet.getRow(2).getCell(2).value=1.12345;
    const decimalBytes=Buffer.from(await wb.xlsx.writeBuffer());
    await assert.rejects(()=>tools.readFile(1,decimalBytes,"bad.xlsx"));
  });
  await test("JSON linked package carries exact decimals and provenance; corruption and unsafe keys fail",async()=>{
    const ex=await tools.export(1,["customer_products"],"json",version);
    const bundle=JSON.parse(ex.body.toString());
    assert(bundle.tables.some((t:any)=>t.name==="customers"));assert(bundle.tables.some((t:any)=>t.name==="items"));
    assert.equal(bundle.tables.find((t:any)=>t.name==="customer_products").rows[0].width,"12345678901234.1234");
    assert.equal((await tools.readFile(1,ex.body,"data.json")).source,"same-database");
    bundle.tables[0].rows[0].id="tampered";await assert.rejects(()=>tools.readFile(1,Buffer.from(JSON.stringify(bundle)),"data.json"));
    await query(`UPDATE factory_execution SET product=product||'{"api_key":"never-export"}'::jsonb WHERE production_order_id=1`);
    await assert.rejects(()=>tools.export(1,["factory_execution"],"json",version));
    await query(`UPDATE factory_execution SET product=product-'api_key' WHERE production_order_id=1`);
  });
  await test("preview old/new cells; default insert only and exact per-column approvals",async()=>{
    const before=await counts();
    const p=await preview("customers",[{id:"CID001",name:"Changed",phone:""},{id:"CID003",name:"New",phone:"00012"}]);
    assert.deepEqual(p.rows.map(r=>r.status),["existing","new"]);assert.equal(p.rows[0].changes.length,1);
    const done=await tools.apply(1,p.id,[],true);
    assert.deepEqual(done.counts,{inserted:1,updated:0});
    assert.equal((await query("SELECT name,phone FROM customers WHERE id='CID001'"))[0].name,"Original");
    assert.equal((await query("SELECT phone FROM customers WHERE id='CID003'"))[0].phone,"00012");
    assert.equal((await counts())[0].customers,before[0].customers+1);
    assert.deepEqual(await tools.apply(1,p.id,[],true),done);await assert.rejects(()=>tools.apply(1,p.id,[],false));
  });
  await test("explicit null clearing and restore approved cells; insertions retained",async()=>{
    const p=await preview("customers",[{id:"CID001",name:"Changed",phone:""}],["phone"]);
    assert.equal(p.rows[0].changes.length,2);
    await tools.apply(1,p.id,[{index:0,columns:["name","phone"]}],false);
    assert.equal((await query("SELECT phone FROM customers WHERE id='CID001'"))[0].phone,null);
    const restore=await tools.restorePreview(1,p.id);assert.equal(restore.rows[0].status,"existing");
    await tools.apply(1,restore.id,[{index:0,columns:["name","phone"]}],false);
    assert.deepEqual((await query("SELECT name,phone FROM customers WHERE id='CID001'"))[0],{name:"Original",phone:"0500012345"});
    await assert.rejects(()=>tools.backup(2,p.id));assert((await tools.backup(1,p.id)).checksum);
  });
  await test("duplicate keys, missing relations, invalid types, required fields and cycles reject full batch",async()=>{
    const before=await counts();
    for(const [table,rows] of [
      ["customers",[{id:"CID004",name:"Valid"},{id:"CID004",name:"Dup"}]],
      ["customers",[{id:"CID004",name:""}]],
      ["customers",[{id:"CID004",name:"Bad",tax_number:"12"}]],
      ["categories",[{id:"CAT002",name:"Bad",parent_id:"missing"}]],
      ["categories",[{id:"CAT002",name:"Cycle",parent_id:"CAT002"}]],
      ["categories",[{id:"CAT002",name:"Fraction",overrun_percentage:"5.1"}]],
      ["items",[{id:"ITM002",category_id:"missing"}]],
    ] as [string,Record<string,string>[]][]){
      const p=await preview(table,rows);assert(p.rows.some(r=>r.errors.length));await assert.rejects(()=>tools.apply(1,p.id,[],true));
    }
    assert.deepEqual(await counts(),before);
    const numeric=(await tools.schema()).tables.find(t=>t.name==="customer_products")!.columns.find(c=>c.name==="width")!;
    assert.throws(()=>valueFor(numeric,"123456789012345.0001"));assert.throws(()=>valueFor(numeric,"0.00001"));
  });
  await test("Arabic header mapping and cross-file relationships are validated together",async()=>{
    const schema=await tools.schema();
    const packageData=makeBundle(schema,{
      categories:[{id:"CAT002",name:"Second",parent_id:null,overrun_percentage:"5"}],
      items:[{id:"ITM002",name:"Second bag",category_id:"CAT002",status:"active"}],
    },"different-database");
    const loaded=await tools.readFile(1,Buffer.from(JSON.stringify(packageData)),"related.json");
    assert.equal(loaded.source,"external");
    const p=await tools.preview(1,version,loaded,[mapping("categories",["id","name","overrun_percentage"],"categories"),mapping("items",["id","name","category_id","status"],"items")]);
    assert(p.rows.every(r=>r.status==="new"));await tools.apply(1,p.id,[],true);
    const csv=await tools.readFile(1,Buffer.from('المعرّف,الاسم بالإنجليزية\nCID005,Arabic mapped'),"ar.csv");
    const m=mapping("customers",[]);m.columns={"المعرّف":"id","الاسم بالإنجليزية":"name"};
    const ar=await tools.preview(1,version,csv,[m]);assert.equal(ar.rows[0].status,"new");
    await assert.rejects(()=>tools.preview(1,version,{...csv,source:"same-database"},[m]));
    const bad={...m,columns:{"المعرّف":"id","الاسم بالإنجليزية":"password"}};
    await assert.rejects(()=>tools.preview(1,version,csv,[bad]));
  });
  await test("data/relations and schema drift invalidate preview without partial writes",async()=>{
    const p=await preview("customers",[{id:"CID006",name:"Never"}]);
    await query("UPDATE customers SET sales_rep_id=2 WHERE id='CID001'");
    await assert.rejects(()=>tools.apply(1,p.id,[],true));
    assert.equal((await query("SELECT count(*)::int n FROM customers WHERE id='CID006'"))[0].n,0);
    const p2=await preview("customers",[{id:"CID006",name:"Never"}]);
    await query("ALTER TABLE customers ADD COLUMN discovered text");
    await assert.rejects(()=>tools.apply(1,p2.id,[],true));
    const s=await tools.schema();assert(!s.tables.find(t=>t.name==="customers")!.columns.find(c=>c.name==="discovered")!.writable);
    version=s.version;
  });
  await test("durable backup failure and SQL save failure leave all business data unchanged",async()=>{
    const p=await preview("customers",[{id:"CID006",name:"Never"}]);
    let failBackup=true;
    const wrapped:TransferPool={query:(t,v)=>pool.query(t,v),async connect(){const q=await pool.connect();return {
      release:()=>q.release(),async query(t,v){if(failBackup&&t.includes('INSERT INTO "public"."data_transfer_backups"'))throw Error("injected backup failure");return q.query(t,v);},
    };}};
    await assert.rejects(()=>new DataTransferService(wrapped).apply(1,p.id,[],true));
    assert.equal((await query("SELECT count(*)::int n FROM customers WHERE id='CID006'"))[0].n,0);
    failBackup=false;let saves=0;
    const badSave:TransferPool={query:(t,v)=>pool.query(t,v),async connect(){const q=await pool.connect();return{release:()=>q.release(),async query(t,v){
      if(t.startsWith('INSERT INTO "public"."customers"')&&++saves===2)throw Error("injected save failure");return q.query(t,v);
    }}}};
    const p2=await preview("customers",[{id:"CID006",name:"Never"},{id:"CID007",name:"Never"}]);
    await assert.rejects(()=>new DataTransferService(badSave).apply(1,p2.id,[],true));
    assert.equal((await query("SELECT count(*)::int n FROM customers WHERE id IN('CID006','CID007')"))[0].n,0);
    assert((await tools.backup(1,p2.id)).checksum);
  });
  await test("restore never overwrites later edits and cannot delete added rows",async()=>{
    const p=await preview("customers",[{id:"CID001",name:"Changed"}]);
    await tools.apply(1,p.id,[{index:0,columns:["name"]}],false);
    await query("UPDATE customers SET phone='newer-edit' WHERE id='CID001'");
    const r=await tools.restorePreview(1,p.id);assert.equal(r.rows[0].status,"conflict");
    await assert.rejects(()=>tools.apply(1,r.id,[{index:0,columns:["name"]}],false));
    assert.equal((await query("SELECT phone FROM customers WHERE id='CID001'"))[0].phone,"newer-edit");
    const n=await preview("customers",[{id:"CID006",name:"Keep"}]);await tools.apply(1,n.id,[],true);
    const nr=await tools.restorePreview(1,n.id);assert.equal(nr.retainedInserts,1);assert.equal(nr.rows.length,0);
  });
  const delivery=new FinishedDeliveryService(pool);
  const manager={id:1,permissions:["manage_finished_warehouse"]};
  const deliver=(inventory_id:number,quantity_kg:string,request_id=randomUUID())=>delivery.deliver(manager,{request_id,items:[{inventory_id,quantity_kg}]});
  await test("delivery binds recipient to actual order customer; exact partial deduction and replay",async()=>{
    const key=randomUUID();const saved=await deliver(1,"12.34",key);
    assert.equal(saved.customer_id,"CID001");assert.equal(saved.voucher_number,"FP-Del0001");
    assert.equal((await query("SELECT quantity_kg FROM factory_inventory WHERE id=1"))[0].quantity_kg,"87.66");
    assert.deepEqual(await deliver(1,"12.34",key),JSON.parse(JSON.stringify(saved)));
    await assert.rejects(()=>deliver(1,"12.35",key));
    assert.equal((await query("SELECT count(*)::int n FROM factory_delivery_movements"))[0].n,1);
    const stock=await delivery.stock(manager);assert.equal(stock.records.find(r=>r.id===1)!.delivered_kg,"12.34");
    const history=await delivery.history(manager);assert.equal(typeof history.records[0].items[0].quantity_kg,"string");
    assert(deliveryPrintHtml(saved,"ar").includes("سند تسليم"));assert(deliveryPrintHtml(saved,"en").includes("Recipient (customer)"));
  });
  await test("delivery rejects overdraw, mixed customers and missing permission without touching receipts",async()=>{
    const before=await query("SELECT count(*)::int n FROM factory_receipt_items");
    await assert.rejects(()=>deliver(1,"99"));
    await assert.rejects(()=>delivery.deliver(manager,{request_id:randomUUID(),items:[{inventory_id:1,quantity_kg:"1"},{inventory_id:2,quantity_kg:"1"}]}));
    assert.throws(()=>delivery.deliver({id:1,permissions:["receive_production"]},{request_id:randomUUID(),items:[{inventory_id:1,quantity_kg:"1"}]}));
    assert.throws(()=>delivery.deliver({id:1,permissions:["view_finished_inventory"]},{request_id:randomUUID(),items:[{inventory_id:1,quantity_kg:"1"}]}));
    assert.deepEqual(await query("SELECT count(*)::int n FROM factory_receipt_items"),before);
  });
  await test("concurrent deliveries cannot overdraw; transaction failure rolls back voucher, movement and stock",async()=>{
    const result=await Promise.allSettled([deliver(1,"60"),deliver(1,"60")]);
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await query("SELECT quantity_kg FROM factory_inventory WHERE id=1"))[0].quantity_kg,"27.66");
    const before=await query("SELECT count(*)::int n FROM factory_deliveries");
    const failing={async connect(){const q=await pool.connect();return {release:()=>q.release(),async query(t:string,v?:any[]){
      if(t.startsWith("INSERT INTO factory_delivery_movements"))throw Error("Injected movement failure");return q.query(t,v);
    }}}};
    await assert.rejects(()=>new FinishedDeliveryService(failing).deliver(manager,{request_id:randomUUID(),items:[{inventory_id:1,quantity_kg:"2"}]}));
    assert.deepEqual(await query("SELECT count(*)::int n FROM factory_deliveries"),before);
    assert.equal((await query("SELECT quantity_kg FROM factory_inventory WHERE id=1"))[0].quantity_kg,"27.66");
  });
  await test("receiving stays cumulative after delivery; new receipt adds stock without changing delivered ledger",async()=>{
    const receive=new ProductionWarehouseService(pool);
    await receive.receive({id:1,permissions:["receive_production"]},{request_id:randomUUID(),items:[{production_order_id:1,quantity_kg:"10"}]});
    assert.equal((await query("SELECT quantity_kg FROM factory_inventory WHERE id=1"))[0].quantity_kg,"37.66");
    assert.equal((await query("SELECT sum(quantity_kg)::text n FROM factory_delivery_movements WHERE inventory_id=1"))[0].n,"72.34");
    await deliver(1,"37.66");assert(!(await delivery.stock(manager)).records.some(r=>r.id===1));
    assert.equal((await query("SELECT quantity_kg FROM factory_inventory WHERE id=1"))[0].quantity_kg,"0.00");
  });
  console.log(`Verified ${tests} isolated PostgreSQL safety suites.`);
} finally {await pool.end();}
