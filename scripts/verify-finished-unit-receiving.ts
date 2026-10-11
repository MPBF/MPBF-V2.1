import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ReceiptInput, ProductionUser } from "../shared/production";
import type { ConnectionPool } from "../server/production/core";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionWarehouseService } from "../server/production/warehouse";
import { ProductionReadService } from "../server/production/read";

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;
export async function verifyFinishedUnitReceiving(pool: ConnectionPool, query: Query) {
  const actor: ProductionUser={id:1,permissions:["admin"]};
  const service=new ProductionExecutionService(pool), warehouse=new ProductionWarehouseService(pool), read=new ProductionReadService(pool);
  const key=()=>({request_id:randomUUID()});
  await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES(901,'UNIT-901','C1','for_production')");
  await query("INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,quantity_kg,final_quantity_kg,status) VALUES(901,901,'UNIT-PO-901',2,100,100,'pending')");
  await service.start(actor,901,key());
  const roll=await service.film(actor,901,{...key(),machine_id:"F1",weight_kg:"80",is_last_roll:true});
  await service.cut(actor,roll.id,{...key(),machine_id:"C1",net_weight_kg:"70"});
  const [{id:locationId}]=await query("SELECT id FROM factory_locations WHERE is_active ORDER BY id LIMIT 1");
  const item=(packing: NonNullable<ReceiptInput["items"][number]["packing"]>)=>({
    production_order_id:901,location_id:locationId,packing,
  });
  const legacy=await warehouse.receive(actor,{...key(),items:[{production_order_id:901,location_id:locationId,quantity_kg:"1"}]}) as any;
  const request:ReceiptInput={...key(),items:[
    item({unit:"packet",method:"unit_weight",quantity:"2",unit_weight_kg:"20"}),
    item({unit:"roll",method:"piece_weight",quantity:"3",pieces_per_unit:10,piece_weight_grams:"100"}),
    item({unit:"piece",method:"unit_weight",quantity:"10",unit_weight_kg:"0.2"}),
    item({unit:"kg",method:"unit_weight",quantity:"1.23"}),
  ]};
  const receipt=await warehouse.receive(actor,request) as any;
  assert.deepEqual(receipt.items.map((line:any)=>line.line_number),[1,2,3,4]);
  assert.deepEqual(receipt.items.map((line:any)=>line.quantity_kg),["40.00","3.00","2.00","1.23"]);
  assert.deepEqual(receipt.items.map((line:any)=>line.packing.unit),["packet","roll","piece","kg"]);
  assert.ok(receipt.voucher_number.startsWith("FR-"));
  const replay=await warehouse.receive(actor,request);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)),JSON.parse(JSON.stringify(receipt)));
  const counts=await query("SELECT count(*)::int n FROM factory_receipt_items WHERE receipt_id=$1",[receipt.id]);
  assert.equal(counts[0].n,4);
  let hall=await read.state(actor,"hall");
  assert.equal(hall.orders.find(order=>order.id===901)?.remaining_kg,"22.77");
  const completion=hall.orders.find(order=>order.id===901)?.completed_at;
  assert.ok(completion);
  let inventory=(await read.history(actor,"inventory",{limit:100})).records.find(row=>row.production_order_id===901)!;
  assert.equal(inventory.quantity_kg,"47.23");
  assert.equal(inventory.legacy_quantity_kg,"1.00");
  assert.equal(inventory.unit_balances?.length,4);
  assert.equal(inventory.unit_balances?.find(balance=>balance.unit==="packet")?.unit_quantity,"2.0000");
  assert.equal((await query("SELECT packing FROM factory_receipt_items WHERE receipt_id=$1",[legacy.id]))[0].packing,null);
  console.log("PASS mixed-unit numbered receipt, automatic kg conservation, replay and historical preservation");

  const prior=(await query("SELECT count(*)::int n FROM factory_receipts"))[0].n;
  await assert.rejects(warehouse.receive(actor,{...key(),items:[{
    ...item({unit:"packet",method:"unit_weight",quantity:"2",unit_weight_kg:"20"}),quantity_kg:"0.01",
  }]}),/لا يطابق/);
  await assert.rejects(warehouse.receive(actor,{...key(),items:[
    item({unit:"kg",method:"unit_weight",quantity:"12"}),
    item({unit:"piece",method:"unit_weight",quantity:"12",unit_weight_kg:"1"}),
  ]}),/تتجاوز/);
  await assert.rejects(warehouse.receive(actor,{...key(),items:[request.items[0],request.items[0]]}),/مكرر/);
  assert.throws(()=>warehouse.receive({id:1,permissions:["view_finished_inventory"]},request),/صلاحية/);
  assert.equal((await query("SELECT count(*)::int n FROM factory_receipts"))[0].n,prior);
  console.log("PASS forged kg, combined over-receipt, exact duplicate and read-only denial leave no stock writes");

  await warehouse.receive(actor,{...key(),items:[item({unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"1"})]});
  await warehouse.receive(actor,{...key(),items:[item({unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"020.000000"})]});
  inventory=(await read.history(actor,"inventory",{limit:100})).records.find(row=>row.production_order_id===901)!;
  const packets=inventory.unit_balances!.filter(balance=>balance.unit==="packet");
  assert.equal(packets.length,2);
  assert.equal(packets.find(balance=>balance.unit_weight_kg==="20.000000")?.unit_quantity,"3.0000");
  assert.equal(packets.find(balance=>balance.unit_weight_kg==="1.000000")?.unit_quantity,"1.0000");
  const results=await Promise.allSettled([1,2].map(()=>warehouse.receive(actor,{...key(),items:[item({unit:"kg",method:"unit_weight",quantity:"1"})]})));
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  hall=await read.state(actor,"hall");
  assert.equal(hall.orders.find(order=>order.id===901)?.remaining_kg,"0.77");
  assert.equal(String(hall.orders.find(order=>order.id===901)?.completed_at),String(completion));
  console.log("PASS identical specs accumulate, different weights stay separate and concurrent receipts cannot overdraw");

  const before=await query("SELECT quantity_kg FROM factory_inventory WHERE production_order_id=901");
  const headers=(await query("SELECT count(*)::int n FROM factory_receipts"))[0].n;
  await query("CREATE FUNCTION refuse_unit_balance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unit balance unavailable'; END $$");
  await query("CREATE TRIGGER refuse_unit_balance BEFORE INSERT OR UPDATE ON factory_inventory_units FOR EACH ROW EXECUTE FUNCTION refuse_unit_balance()");
  try {
    await assert.rejects(warehouse.receive(actor,{...key(),items:[item({unit:"kg",method:"unit_weight",quantity:"0.50"})]}),/unit balance unavailable/);
    assert.deepEqual(await query("SELECT quantity_kg FROM factory_inventory WHERE production_order_id=901"),before);
    assert.equal((await query("SELECT count(*)::int n FROM factory_receipts"))[0].n,headers);
  } finally { await query("DROP TRIGGER refuse_unit_balance ON factory_inventory_units"); }
  assert.equal((await query(`SELECT count(*)::int n FROM factory_inventory inv
    WHERE inv.production_order_id=901 AND inv.quantity_kg<>1+(SELECT sum(u.quantity_kg) FROM factory_inventory_units u WHERE u.inventory_id=inv.id)`))[0].n,0);
  console.log("PASS unit-stock failure rolls back voucher, lines, movements and kilogram balance atomically");
}
