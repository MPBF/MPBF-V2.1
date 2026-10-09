// Synthetic identities and records only, in the disposable test schema.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionReadService } from "../server/production/read";
import type { ConnectionPool } from "../server/production/core";
import type { ProductionUser } from "../shared/production";

export async function verifyRollActors(pool: ConnectionPool,
  query: (sql: string, values?: unknown[]) => Promise<any[]>) {
  const exec = new ProductionExecutionService(pool), read = new ProductionReadService(pool);
  const creator: ProductionUser = { id: 1, permissions: ["admin"] };
  const printer: ProductionUser = { id: 2, permissions: ["operate_printing", "operate_film"] };
  const cutter: ProductionUser = { id: 3, permissions: ["operate_cutting"] };
  const unnamed: ProductionUser = { id: 4, permissions: ["operate_film"] };
  const key = () => ({ request_id: randomUUID() });
  await query(`UPDATE users SET username='creator',display_name='Creator Person',
    display_name_ar='منشئ الاختبار',full_name='Creator Full Name',password='fixture-secret',
    email='private@example.test',phone='fixture-private' WHERE id=1`);
  await query(`INSERT INTO users(id,username,display_name,display_name_ar,full_name,password,email,phone)
    VALUES(2,'printer','Printer Person','عامل الطباعة','Printer Full Name','fixture-secret','private@example.test','fixture-private'),
      (3,'cutter','Cutter Person','عامل القص','Cutter Full Name','fixture-secret','private@example.test','fixture-private'),
      (4,NULL,NULL,NULL,NULL,'fixture-secret','private@example.test','fixture-private')`);
  // Earlier regressions deliberately edit product 1; use independent products.
  await query(`INSERT INTO customer_products(id,customer_id,item_id,width,universal_thickness,
    cutting_length_cm,raw_material,printing_cylinder,is_printed,status)
    VALUES(920001,'C1','BAG',28,25,41,'HDPE','16',true,'active'),
      (920002,'C1','BAG',28,25,41,'HDPE','16',false,'active')`);
  const plan = async (id: number, product: number) => {
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1','for_production')", [id, `ACTOR-${id}`]);
    await query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,
      quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,$3,100,100,'pending')`, [id, `ACTOR-PO-${id}`, product]);
    await exec.start(creator, id, key());
  };
  await plan(920001, 920001);
  const roll = await exec.film(creator, 920001, { ...key(), machine_id: "F1", weight_kg: "10" });
  await exec.print(printer, roll.id, { ...key(), machine_id: "P1" });
  await exec.cut(cutter, roll.id, { ...key(), machine_id: "C1", net_weight_kg: "9" });
  const snapshot = await query("SELECT * FROM factory_rolls WHERE id=$1", [roll.id]);
  const detail = await read.roll(creator, roll.id);
  assert.deepEqual([detail.created_by, detail.printed_by, detail.cut_by], [1, 2, 3]);
  for (const [actor, id, name] of [[detail.created_actor, 1, "Creator Person"],
    [detail.printed_actor, 2, "Printer Person"], [detail.cut_actor, 3, "Cutter Person"]] as const) {
    assert.equal(actor?.id, id);
    assert.equal(actor?.display_name, name);
    assert.deepEqual(Object.keys(actor!).sort(), ["display_name", "display_name_ar", "full_name", "id", "username"]);
  }
  assert.equal("received_actor" in detail, false);
  assert.equal("received_by" in detail, false);
  const history = await read.history(creator, "rolls", { order_id: 920001 });
  assert.equal("created_actor" in history.records[0], false, "history remains a thin roll record");
  const labels = await read.labelRolls(creator, [roll.id]);
  assert.equal("created_actor" in labels[0], false, "labels unchanged");
  assert.deepEqual(await query("SELECT * FROM factory_rolls WHERE id=$1", [roll.id]), snapshot,
    "identity reads do not rewrite timestamps, actor IDs or stages");
  await plan(920002, 920001);
  const inline = await exec.film(printer, 920002, { ...key(), machine_id: "F1", weight_kg: "10", inline_printed: true, is_last_roll: true });
  const inlineDetail = await read.roll(creator, inline.id);
  assert.equal(inlineDetail.created_actor?.id, 2);
  assert.equal(inlineDetail.printed_actor?.id, 2);
  assert.deepEqual(inlineDetail.created_at, inlineDetail.printed_at);
  assert.equal(inlineDetail.cut_actor, null);
  assert.ok((await read.state(creator)).orders.find(order => order.id === 920002)?.film_closed_at,
    "final-roll checkbox still closes film");
  await plan(920003, 920002);
  const unnamedRoll = await exec.film(unnamed, 920003, { ...key(), machine_id: "F1", weight_kg: "10" });
  const unnamedDetail = await read.roll(creator, unnamedRoll.id);
  assert.equal(unnamedDetail.created_actor?.id, 4);
  assert.equal(unnamedDetail.created_actor?.display_name, null);
  assert.equal(unnamedDetail.printed_actor, null);
  assert.equal(unnamedDetail.cut_actor, null);
  await query("UPDATE factory_rolls SET created_by=NULL WHERE id=$1", [unnamedRoll.id]);
  assert.equal((await read.roll(creator, unnamedRoll.id)).created_actor, null);
  await assert.rejects(read.roll({ id: 1, permissions: ["view_orders"] }, roll.id),
    (error: any) => error.status === 403);
  console.log("PASS distinct roll actors, inline/final roll, missing identities, allowlisted privacy, permissions and unchanged history/labels");
}
