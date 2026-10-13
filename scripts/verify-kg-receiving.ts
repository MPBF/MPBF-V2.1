import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ReceiptInput, ProductionUser } from "../shared/production";
import type { ConnectionPool } from "../server/production/core";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionWarehouseService } from "../server/production/warehouse";
import { ProductionReadService } from "../server/production/read";

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;
/** Called only inside the parent suite's disposable schema. */
export async function verifyKgReceiving(pool: ConnectionPool, query: Query) {
  const actor: ProductionUser={id:1,permissions:["admin"]};
  const service=new ProductionExecutionService(pool), warehouse=new ProductionWarehouseService(pool), read=new ProductionReadService(pool);
  const key=()=>({request_id:randomUUID()});
  for (const id of [901,902]) {
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1','for_production')",[id,`KG-${id}`]);
    await query("INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,2,100,100,'pending')",[id,`KG-PO-${id}`]);
    await service.start(actor,id,key());
    const roll=await service.film(actor,id,{...key(),machine_id:"F1",weight_kg:"80",is_last_roll:false});
    await service.cut(actor,roll.id,{...key(),machine_id:"C1",net_weight_kg:"70"});
  }
  const request:ReceiptInput={...key(),items:[{production_order_id:901,quantity_kg:"2.50"}]};
  const original=await warehouse.receive(actor,request) as any;

  // Reconstruct the former schema/data ONLY in the disposable fixture to
  // exercise retirement against real records, cached responses and unit stock.
  await query(readFileSync("migrations/0016_finished_inventory_units.sql","utf8"));
  await query("ALTER TABLE factory_receipt_items ADD COLUMN IF NOT EXISTS packaging jsonb");
  const packing={unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"2.500000"};
  await query("UPDATE factory_receipt_items SET packing=$1::jsonb,packaging=$2::jsonb WHERE receipt_id=$3",
    [JSON.stringify(packing),JSON.stringify({roll_weight_grams:"2500",rolls_per_unit:1,units:1}),original.id]);
  await query(`INSERT INTO factory_inventory_units(inventory_id,packing_key,specification,unit_quantity,quantity_kg)
    SELECT id,'legacy-test',$1::jsonb,1,2.50 FROM factory_inventory WHERE production_order_id=901`,
    [JSON.stringify(packing)]);
  await query("UPDATE factory_operations SET result=jsonb_set(result,'{items,0,packing}',$1::jsonb) WHERE request_id=$2",
    [JSON.stringify(packing),request.request_id]);
  const protectedFingerprint=async()=>await query(`
    SELECT 'customers' relation,md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) hash FROM customers r
    UNION ALL SELECT 'customer_products',md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) FROM customer_products r
    UNION ALL SELECT 'items',md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) FROM items r
    UNION ALL SELECT 'categories',md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) FROM categories r`);
  const protectedBefore=await protectedFingerprint();
  await query(readFileSync("migrations/0019_finished_receipts_kg_only.sql","utf8"));
  await query(readFileSync("migrations/0019_finished_receipts_kg_only.sql","utf8"));
  assert.deepEqual(await protectedFingerprint(),protectedBefore);
  assert.equal((await query("SELECT to_regclass('factory_inventory_units') relation"))[0].relation,null);
  assert.equal((await query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='factory_receipt_items' AND column_name IN ('packing','packaging')"))[0].n,0);
  const replay=await warehouse.receive(actor,request) as any;
  assert.equal(replay.id,original.id);
  assert.equal(replay.items[0].quantity_kg,"2.50");
  assert.ok(!("packing" in replay.items[0]) && !("packaging" in replay.items[0]));
  console.log("PASS kg-only migration retires populated unit data, preserves all ledger fields and protected catalogues, and supports exact replay");

  const batch:ReceiptInput={...key(),items:[{production_order_id:901,quantity_kg:"10.10"},{production_order_id:902,quantity_kg:"20.20"}]};
  const saved=await warehouse.receive(actor,batch) as any;
  assert.deepEqual(saved.items.map((item:any)=>item.quantity_kg),["10.10","20.20"]);
  assert.equal((await warehouse.receive(actor,batch) as any).id,saved.id);
  const order901=(await read.history(actor,"orders",{search:"KG-PO-901"})).records[0];
  const order902=(await read.history(actor,"orders",{search:"KG-PO-902"})).records[0];
  assert.equal(order901.received_kg,"12.60");
  assert.equal(order902.received_kg,"20.20");
  const inventory=(await read.history(actor,"inventory",{search:"KG-PO-901"})).records[0] as any;
  assert.equal(inventory.quantity_kg,"12.60");
  assert.ok(!("unit_balances" in inventory) && !("legacy_quantity_kg" in inventory));
  console.log("PASS multi-order partial receipt stores exact kg once, without unit DTOs or manufacturing completion");

  const before=await query("SELECT count(*)::int n FROM factory_receipts");
  for (const quantity_kg of ["0","-1","1.001","1e3","1000000000000"]) {
    await assert.rejects(warehouse.receive(actor,{...key(),items:[{production_order_id:901,quantity_kg}]}));
  }
  for (const metadata of [{packing},{packaging:{units:1}}, {unit:"packet"},{unit_quantity:"3"}]) {
    await assert.rejects(warehouse.receive(actor,{...key(),items:[{production_order_id:901,quantity_kg:"1",...metadata}]} as ReceiptInput));
  }
  await assert.rejects(warehouse.receive(actor,{...key(),items:[
    {production_order_id:901,quantity_kg:"30"}, {production_order_id:901,quantity_kg:"30"},
  ]}));
  await assert.rejects(warehouse.receive(actor,{...key(),items:[
    {production_order_id:901,quantity_kg:"1"}, {production_order_id:902,quantity_kg:"50"},
  ]}));
  assert.deepEqual(await query("SELECT count(*)::int n FROM factory_receipts"),before);
  console.log("PASS invalid units, precision, cumulative over-receipt and mixed-batch errors cannot create partial stock");

  const concurrent=await Promise.allSettled([0,1].map(()=>warehouse.receive(actor,{...key(),items:[{production_order_id:901,quantity_kg:"40"}]})));
  assert.equal(concurrent.filter(result=>result.status==="fulfilled").length,1);
  assert.equal(concurrent.filter(result=>result.status==="rejected").length,1);
  const final=(await read.history(actor,"orders",{search:"KG-PO-901"})).records[0];
  assert.equal(final.received_kg,"52.60");
  assert.equal(final.remaining_kg,"17.40");
  assert.equal(final.completed_at,null);
  console.log("PASS concurrent kg receipts share order locks and cannot overdraw the production hall or close manufacturing");
}
