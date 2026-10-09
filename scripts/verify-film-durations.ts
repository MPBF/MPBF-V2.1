// All mutations here target the disposable integration-test schema.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionReadService } from "../server/production/read";
import { ProductionWarehouseService } from "../server/production/warehouse";
import type { ConnectionPool } from "../server/production/core";
import type { FilmInput, ProductionUser } from "../shared/production";

export async function verifyFilmDurations(pool: ConnectionPool,
  query: (sql: string, values?: unknown[]) => Promise<any[]>) {
  const actor: ProductionUser = { id: 1, permissions: ["admin"] };
  const execution = new ProductionExecutionService(pool);
  const read = new ProductionReadService(pool);
  const warehouse = new ProductionWarehouseService(pool);
  const key = () => ({ request_id: randomUUID() });
  const ids = [910001, 910002, 910003, 910004];
  await query(`INSERT INTO machines(id,name,name_ar,type,status)
    VALUES('F2','Film Two','فيلم اثنان','extruder','active') ON CONFLICT(id) DO NOTHING`);
  for (const id of ids) {
    await query("INSERT INTO orders(id,order_number,customer_id,status) VALUES($1,$2,'C1','for_production')", [id, `DURATION-${id}`]);
    await query(`INSERT INTO production_orders(id,order_id,production_order_number,customer_product_id,
      quantity_kg,final_quantity_kg,status) VALUES($1,$1,$2,4,100,100,'pending')`, [id, `DURATION-PO-${id}`]);
    await execution.start(actor, id, key());
  }
  const film = (id: number, machine_id = "F1", extra = {}) =>
    execution.film(actor, id, { ...key(), machine_id, weight_kg: "1.00", ...extra } as FilmInput);
  const last = await film(ids[0]);
  const first = await film(ids[0]);
  const otherMachine = await film(ids[0], "F2");
  const sameA = await film(ids[1]);
  const sameB = await film(ids[1]);
  const direct = await film(ids[3], "F1", { production_minutes: 999 });
  assert.equal(direct.production_minutes, null, "direct callers cannot persist manual duration");
  assert.equal((await read.roll(actor, direct.id)).film_duration.duration_seconds, null);
  await query(`UPDATE factory_rolls SET created_at=CASE id
    WHEN $1 THEN '2026-10-03T02:00:02Z'::timestamptz
    WHEN $2 THEN '2026-10-01T20:59:59Z'::timestamptz
    WHEN $3 THEN '2026-10-02T12:00:00Z'::timestamptz
    ELSE '2026-10-02T10:01:00Z'::timestamptz END,
    production_minutes=CASE WHEN id=$1 THEN 12 WHEN id=$2 THEN 23 ELSE 44 END
    WHERE id=ANY($4::integer[])`, [last.id, first.id, otherMachine.id, [last.id, first.id, otherMachine.id, sameA.id, sameB.id]]);
  const before = await query("SELECT * FROM factory_rolls WHERE id=ANY($1::integer[]) ORDER BY id",
    [[last.id, first.id, otherMachine.id, sameA.id, sameB.id]]);
  const state = await read.state(actor, "film");
  const a = state.orders.find(order => order.id === ids[0])!;
  const b = state.orders.find(order => order.id === ids[1])!;
  assert.equal(state.rolls.filter(roll => roll.production_order_id === ids[0]).length, 3,
    "film shows all recorded rolls of an open order, including downstream completed rolls");
  assert.equal(a.produced_kg, "3.00");
  assert.equal(a.ready_kg, "3.00");
  assert.equal(a.roll_count, 3);
  assert.equal(a.film_durations.length, 2);
  const f1 = a.film_durations.find(group => group.machine_id === "F1")!;
  const f2 = a.film_durations.find(group => group.machine_id === "F2")!;
  assert.equal(f1.roll_count, 2);
  assert.equal(f1.duration_seconds, 104403, "29 hours and 3 seconds across midnight, not daily or per-roll");
  assert.equal(new Date(f1.first_roll_at).toISOString(), "2026-10-01T20:59:59.000Z");
  assert.equal(new Date(f1.last_roll_at).toISOString(), "2026-10-03T02:00:02.000Z");
  assert.equal(f2.roll_count, 1);
  assert.equal(f2.duration_seconds, null);
  assert.equal(f2.machine_name, "Film Two");
  assert.equal(b.film_durations[0].duration_seconds, 0, "same timestamp is a valid zero span, different order stays separate");
  assert.deepEqual(state.orders.find(order => order.id === ids[2])!.film_durations, []);
  assert.deepEqual((await read.roll(actor, first.id)).film_duration, f1);
  assert.deepEqual((await read.roll(actor, last.id)).film_duration, f1);
  assert.deepEqual((await read.roll(actor, otherMachine.id)).film_duration, f2);
  const rollPage = await read.history(actor, "rolls", { order_id: ids[0], limit: 1 });
  assert.equal(rollPage.records.length, 1);
  assert.ok(rollPage.next);
  assert.equal("film_duration" in rollPage.records[0], false, "history rows do not repeat aggregates");
  const history = await read.history(actor, "orders", { search: `DURATION-PO-${ids[0]}`, limit: 1 });
  assert.deepEqual(history.records[0].film_durations, a.film_durations, "history duration is not page-local");
  assert.deepEqual(await query("SELECT * FROM factory_rolls WHERE id=ANY($1::integer[]) ORDER BY id",
    [[last.id, first.id, otherMachine.id, sameA.id, sameB.id]]), before, "reads preserve old minutes, timestamps and stages");
  await execution.closeFilm(actor, ids[0], key());
  await warehouse.receive(actor, { ...key(), items: [{ production_order_id: ids[0], location_id: 1, quantity_kg: "3.00" }] });
  const completed = await read.history(actor, "orders", { search: `DURATION-PO-${ids[0]}`, limit: 1 });
  assert.equal(completed.records[0].received_kg, "3.00");
  assert.deepEqual(completed.records[0].film_durations, a.film_durations, "closure and full receipt do not change endpoints");
  assert.deepEqual((await read.roll(actor, first.id)).film_duration, f1);
  await assert.rejects(read.roll({ id: 1, permissions: ["view_orders"] }, first.id), /صلاحية/);
  console.log("PASS full-source order/machine durations: empty, single, equal, overnight, done/received, history/detail, preserved legacy and direct manual-field immunity");
}
