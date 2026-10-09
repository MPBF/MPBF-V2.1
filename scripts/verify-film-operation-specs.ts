// Synthetic operation-spec records in the disposable integration schema only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionReadService } from "../server/production/read";
import type { ConnectionPool } from "../server/production/core";
import type { ProductionUser } from "../shared/production";

export async function verifyFilmOperationSpecs(pool: ConnectionPool,
  query: (sql: string, values?: unknown[]) => Promise<any[]>) {
  const actor: ProductionUser = { id: 1, permissions: ["admin"] };
  const exec = new ProductionExecutionService(pool), read = new ProductionReadService(pool);
  await query(`INSERT INTO master_batch_colors VALUES
    ('SPEC-BLUE','Blue','أزرق','#2463EB'),('SPEC-RED','Red','أحمر','#EF4444')`);
  await query(`INSERT INTO customer_products(id,customer_id,item_id,width,left_facing,right_facing,
    universal_thickness,cutting_length_cm,raw_material,is_printed,status,size_caption,master_batch_id)
    VALUES(940001,'C1','BAG',28,7,7,35,40,'HDPE',false,'active','28 + 7 + 7','SPEC-BLUE'),
      (940002,'C1','BAG',28,0,0,35,40,'HDPE',false,'active',NULL,NULL),
      (940003,'C1','BAG',28,0,0,35,40,'HDPE',false,'active','28','SPEC-MISSING')`);
  for (const id of [940001, 940002, 940003]) {
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1','for_production')", [id, `SPEC-${id}`]);
    await query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,
      quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,$1,100,100,'pending')`, [id, `SPEC-PO-${id}`]);
    if (id !== 940003) await exec.start(actor, id, { request_id: randomUUID() });
  }
  const before = await query("SELECT * FROM factory_execution WHERE production_order_id IN (940001,940002) ORDER BY production_order_id");
  const original = (await read.state(actor, "film")).orders.find(order => order.id === 940001)!.product!;
  assert.equal(original.size_caption, "28 + 7 + 7");
  assert.deepEqual(original.master_batch, { id: "SPEC-BLUE", name: "Blue", name_ar: "أزرق", color_hex: "#2463EB" });
  assert.equal(original.raw_material, "HDPE");
  assert.equal(original.universal_thickness, "35");
  await query(`UPDATE customer_products SET size_caption='99',width=99,raw_material='LDPE',
    universal_thickness=99,master_batch_id='SPEC-RED' WHERE id=940001`);
  await query("UPDATE customer_products SET size_caption='28',master_batch_id='SPEC-RED' WHERE id=940002");
  await query("UPDATE master_batch_colors SET name='Changed Blue',color_hex='#000000' WHERE id='SPEC-BLUE'");
  let state = await read.state(actor, "film");
  assert.deepEqual(state.orders.find(order => order.id === 940001)!.product, original,
    "new executions freeze size, color and original operation specs");
  assert.equal(state.orders.find(order => order.id === 940002)!.product!.master_batch, null,
    "an explicitly saved absent color must not become a later product color");
  assert.equal(state.orders.find(order => order.id === 940002)!.product!.size_caption, null);
  assert.equal(state.orders.find(order => order.id === 940003)!.product!.master_batch, null,
    "a missing referenced color is unrecorded, never fabricated");
  assert.deepEqual(await query("SELECT * FROM factory_execution WHERE production_order_id IN (940001,940002) ORDER BY production_order_id"), before,
    "display lookups do not persist supplemental values or rewrite executions");
  // Simulate a pre-feature snapshot: no saved size/color keys. Read-only fallback
  // can use the current product, but must retain all older frozen dimensions.
  await query(`UPDATE factory_execution SET product=product-'size_caption'-'master_batch'
    WHERE production_order_id=940001`);
  const legacyBefore = await query("SELECT * FROM factory_execution WHERE production_order_id=940001");
  state = await read.state(actor, "film");
  const legacy = state.orders.find(order => order.id === 940001)!.product!;
  assert.equal(legacy.size_caption, null, "do not supplement a caption contradicting frozen dimensions");
  assert.equal(legacy.master_batch?.id, "SPEC-RED");
  assert.equal(legacy.width, "28");
  assert.equal(legacy.raw_material, "HDPE");
  assert.equal(legacy.universal_thickness, "35");
  assert.deepEqual(await query("SELECT * FROM factory_execution WHERE production_order_id=940001"), legacyBefore);
  assert.deepEqual((await read.history(actor, "orders", { search: "SPEC-PO-940001" })).records[0].product, legacy);
  console.log("PASS film size/master-batch specs, frozen values and nulls, missing color and read-only legacy supplementation");
}
