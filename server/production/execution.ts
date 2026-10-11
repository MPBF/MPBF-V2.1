import {
  eligibleForCutting, filmRollReachesTarget, isPlasticRoll, kgHundredths, kgString, stageAfterFilm, stageAfterPrinting,
  type FilmInput, type ProductionRollRecord, type ProductionUser, type ProductionStage,
} from "../../shared/production";
import { available, execution, lockOrders, mutate, one, permission, productSnapshot, ProductionError, rows, type Connection, type ConnectionPool, type LockedOrder } from "./core";
import { machine } from "./machines";
import { productionRollNumber } from "../order-number";
import { consumeMixes, lockMixMachine } from "./mix-consumption";

export class ProductionExecutionService {
  constructor(readonly pool: ConnectionPool) {}
  start(actor: ProductionUser, id: number, input: { request_id: string }) {
    permission(actor, "manage_production", "operate_film");
    return mutate(this.pool, actor, `start:${id}`, input, async tx => {
      const [order] = await lockOrders(tx, [id]);
      if (order.status !== "pending" || order.batch_number || order.previous_status && order.previous_status !== "pending" ||
          (await rows(tx, "SELECT 1 FROM factory_execution WHERE production_order_id=$1", [id])).length)
        throw new ProductionError("أمر الإنتاج بدأ سابقاً أو تاريخي غير قابل للبدء", "The production order is already started or is a historical record.");
      if (kgHundredths(order.final_quantity_kg) <= 0n) throw new ProductionError("الهدف المخطط يجب أن يكون موجباً", "The planned target must be positive.", 400);
      const { product, is_printed } = await productSnapshot(tx, order);
      const rollProduct = isPlasticRoll(product.name, product.name_ar);
      await tx.query(`INSERT INTO factory_execution(production_order_id,customer_product_id,item_id,product,is_printed,is_roll_product,started_by)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`, [id, product.id, product.item_id, JSON.stringify(product), is_printed, rollProduct, actor.id]);
      await tx.query("UPDATE production_orders SET status='active' WHERE id=$1", [id]);
      await tx.query("UPDATE orders SET status='in_production' WHERE id=$1", [order.order_id]);
      return { production_order_id: id, started: true };
    });
  }
  film(actor: ProductionUser, id: number, input: FilmInput) {
    permission(actor, "operate_film");
    return mutate(this.pool, actor, `film:${id}`, input, async tx => {
      await lockMixMachine(tx, input.machine_id);
      const [order] = await lockOrders(tx, [id]);
      const exec = await execution(tx, id);
      if (exec.film_closed_at) throw new ProductionError("الفيلم مغلق؛ لا يمكن إضافة رولات", "Film is closed. No more rolls can be added.");
      const filmMachine = await machine(tx, input.machine_id, "film", exec.product);
      const amount = kgHundredths(input.weight_kg);
      const totals = await available(tx, id);
      if (amount <= 0n)
        throw new ProductionError("وزن الرول يجب أن يكون موجباً", "Roll weight must be positive.", 400);
      const isLastRoll = !!input.is_last_roll || filmRollReachesTarget(order.final_quantity_kg, totals.produced, input.weight_kg);
      let printerId: string | null = null;
      if (input.inline_printed) {
        if (!exec.is_printed || !filmMachine.inline_printer_id)
          throw new ProductionError("الإنلاين يتطلب منتجاً مطبوعاً وطابعة مرتبطة", "Inline printing requires a printed product and a linked printer.", 400);
        printerId = (await machine(tx, filmMachine.inline_printer_id, "printing", exec.product)).id;
      }
      const seq = (await one<{ next: number }>(tx, "SELECT COALESCE(max(sequence),0)+1 next FROM factory_rolls WHERE production_order_id=$1", [id])).next;
      // Keep PostgreSQL microseconds rather than round-tripping through JS Date:
      // an earlier committed mix in the same millisecond must remain eligible.
      const { at } = await one<{ at: string }>(tx, "SELECT clock_timestamp()::text at");
      const roll = await one<ProductionRollRecord>(tx, `INSERT INTO factory_rolls
        (production_order_id,sequence,roll_number,weight_kg,stage,film_machine_id,created_by,is_last_roll,
          printing_machine_id,printed_by,printed_at,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::varchar,$10,CASE WHEN $9::varchar IS NULL THEN NULL ELSE $11::timestamptz END,$11) RETURNING *`,
      [id, seq, productionRollNumber(order.production_order_number, seq, order.compact_roll_numbering === true), kgString(amount),
        stageAfterFilm(exec.is_printed, exec.is_roll_product, !!printerId), filmMachine.id, actor.id,
        isLastRoll, printerId, printerId ? actor.id : null, at]);
      const mix_tracking = await consumeMixes(tx, roll.id, filmMachine.id, kgString(amount));
      if (isLastRoll) await this.close(tx, id, actor.id);
      await recompute(tx, order);
      return { ...roll, mix_tracking };
    });
  }
  closeFilm(actor: ProductionUser, id: number, input: { request_id: string }) {
    permission(actor, "operate_film");
    return mutate(this.pool, actor, `close-film:${id}`, input, async tx => {
      const [order] = await lockOrders(tx, [id]);
      const exec = await execution(tx, id);
      if (exec.film_closed_at) throw new ProductionError("الفيلم مغلق مسبقاً", "Film is already closed.");
      if (!(await available(tx, id)).count) throw new ProductionError("لا يمكن إغلاق الفيلم دون رولات حقيقية", "Film cannot close without real rolls.", 400);
      await this.close(tx, id, actor.id);
      await recompute(tx, order);
      return { production_order_id: id, film_closed: true };
    });
  }
  private close(tx: Connection, id: number, actorId: number) {
    return tx.query("UPDATE factory_execution SET film_closed_at=clock_timestamp(),film_closed_by=$2 WHERE production_order_id=$1", [id, actorId]);
  }
  print(actor: ProductionUser, id: number, input: { request_id: string; machine_id: string }) {
    permission(actor, "operate_printing");
    return mutate(this.pool, actor, `print:${id}`, input, async tx => {
      const ref = await one<{ production_order_id: number }>(tx, "SELECT production_order_id FROM factory_rolls WHERE id=$1", [id]);
      const [order] = await lockOrders(tx, [ref.production_order_id]);
      const exec = await execution(tx, order.id);
      const roll = await one<ProductionRollRecord>(tx, "SELECT * FROM factory_rolls WHERE id=$1 FOR UPDATE", [id]);
      if (!exec.is_printed || roll.printed_at || roll.stage !== "film")
        throw new ProductionError("الرول غير مؤهل للطباعة أو طُبع سابقاً", "This roll is not eligible for printing or was already printed.");
      await machine(tx, input.machine_id, "printing", exec.product);
      const updated = await one<ProductionRollRecord>(tx, `UPDATE factory_rolls SET stage=$2,printing_machine_id=$3,
        printed_by=$4,printed_at=clock_timestamp() WHERE id=$1 RETURNING *`, [id, stageAfterPrinting(exec.is_roll_product), input.machine_id, actor.id]);
      await recompute(tx, order);
      return updated;
    });
  }
  cut(actor: ProductionUser, id: number, input: { request_id: string; machine_id: string; net_weight_kg: string }) {
    permission(actor, "operate_cutting");
    return mutate(this.pool, actor, `cut:${id}`, input, async tx => {
      const ref = await one<{ production_order_id: number }>(tx, "SELECT production_order_id FROM factory_rolls WHERE id=$1", [id]);
      const [order] = await lockOrders(tx, [ref.production_order_id]);
      const exec = await execution(tx, order.id);
      const roll = await one<ProductionRollRecord>(tx, "SELECT * FROM factory_rolls WHERE id=$1 FOR UPDATE", [id]);
      if (!eligibleForCutting({ ...roll, is_printed: exec.is_printed, is_roll_product: exec.is_roll_product }) || roll.cut_completed_at)
        throw new ProductionError("الرول غير مؤهل للقص أو قُص سابقاً", "This roll is not eligible for cutting or was already cut.");
      const net = kgHundredths(input.net_weight_kg), gross = kgHundredths(roll.weight_kg);
      if (net <= 0n || net > gross) throw new ProductionError("الصافي موجب ولا يتجاوز وزن الفيلم", "Net weight must be positive and no greater than film weight.", 400);
      await machine(tx, input.machine_id, "cutting", exec.product);
      const updated = await one<ProductionRollRecord>(tx, `UPDATE factory_rolls SET stage='done',cutting_machine_id=$2,cut_by=$3,
        cut_completed_at=clock_timestamp(),net_weight_kg=$4,waste_kg=$5 WHERE id=$1 RETURNING *`,
      [id, input.machine_id, actor.id, kgString(net), kgString(gross - net)]);
      await recompute(tx, order);
      return updated;
    });
  }
  queue(actor: ProductionUser, input: { request_id: string; production_order_id: number; stage: ProductionStage; machine_id: string; position: number }) {
    permission(actor, "manage_production");
    return mutate(this.pool, actor, "queue", input, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`factory-queue:${input.stage}`]);
      const [order] = await lockOrders(tx, [input.production_order_id]);
      const [exec] = await rows<Awaited<ReturnType<typeof execution>>>(tx, "SELECT * FROM factory_execution WHERE production_order_id=$1", [order.id]);
      const liveProduct = exec ? null : await productSnapshot(tx, order);
      const product = exec?.product ?? liveProduct!.product;
      const printed = exec?.is_printed ?? liveProduct!.is_printed;
      const rollProduct = exec?.is_roll_product ?? isPlasticRoll(product.name, product.name_ar);
      if (input.stage === "printing" && !printed || input.stage === "cutting" && rollProduct ||
          input.stage === "film" && exec?.film_closed_at || exec?.completed_at)
        throw new ProductionError("المرحلة غير مطلوبة لهذا المنتج أو مغلقة", "This stage is not required for this product or is closed.", 400);
      // While film is open, future rolls may still need either downstream stage.
      // Once closed, use the same eligibility rules as the actual roll actions.
      if (exec?.film_closed_at && input.stage !== "film") {
        const rolls = await rows<Pick<ProductionRollRecord, "stage" | "printed_at" | "cut_completed_at">>(tx,
          "SELECT stage,printed_at,cut_completed_at FROM factory_rolls WHERE production_order_id=$1", [order.id]);
        const remaining = rolls.some(roll => input.stage === "printing"
          ? roll.stage === "film" && !roll.printed_at
          : eligibleForCutting({ ...roll, is_printed: printed, is_roll_product: rollProduct }) && !roll.cut_completed_at);
        if (!remaining)
          throw new ProductionError("لا يوجد عمل مؤهل متبقٍ لهذه المرحلة", "There is no eligible work remaining for this stage.", 400);
      }
      await machine(tx, input.machine_id, input.stage, product);
      const saved = await one<{ id: number }>(tx, `INSERT INTO factory_queues(production_order_id,stage,machine_id,position,updated_by)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(production_order_id,stage) DO UPDATE SET
        machine_id=excluded.machine_id,position=excluded.position,updated_by=excluded.updated_by,updated_at=clock_timestamp() RETURNING *`,
      [order.id, input.stage, input.machine_id, input.position, actor.id]);
      const siblings = await rows<{ id: number }>(tx, `SELECT id FROM factory_queues
        WHERE stage=$1 AND machine_id=$2 AND id<>$3 ORDER BY position,id FOR UPDATE`, [input.stage, input.machine_id, saved.id]);
      siblings.splice(Math.min(input.position - 1, siblings.length), 0, saved);
      await normalizeQueue(tx, siblings);
      return one(tx, "SELECT * FROM factory_queues WHERE id=$1", [saved.id]);
    });
  }
  removeQueue(actor: ProductionUser, id: number, input: { request_id: string }) {
    permission(actor, "manage_production");
    return mutate(this.pool, actor, `remove-queue:${id}`, input, async tx => {
      const queue = await one<{ production_order_id: number; stage: string }>(tx, "SELECT production_order_id,stage FROM factory_queues WHERE id=$1", [id]);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`factory-queue:${queue.stage}`]);
      await lockOrders(tx, [queue.production_order_id], false);
      await tx.query("DELETE FROM factory_queues WHERE id=$1", [id]);
      return { removed: true };
    });
  }
  reorderQueue(actor: ProductionUser, input: { request_id: string; first_id: number; second_id: number; first_position: number; second_position: number }) {
    permission(actor, "manage_production");
    return mutate(this.pool, actor, "reorder-queue", input, async tx => {
      if (input.first_id === input.second_id) throw new ProductionError("اختر بندين مختلفين", "Select two different queue entries.", 400);
      const refs = await rows<{ id: number; production_order_id: number; stage: string; machine_id: string }>(tx,
        "SELECT * FROM factory_queues WHERE id=ANY($1::int[])", [[input.first_id, input.second_id]]);
      if (refs.length !== 2 || refs[0].stage !== refs[1].stage || refs[0].machine_id !== refs[1].machine_id)
        throw new ProductionError("تغير الطابور؛ أعد تحميله", "The queue changed. Reload it.");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`factory-queue:${refs[0].stage}`]);
      await lockOrders(tx, refs.map(r => r.production_order_id));
      const siblings = await rows<{ id: number; position: number }>(tx, `SELECT id,position FROM factory_queues
        WHERE stage=$1 AND machine_id=$2 ORDER BY position,id FOR UPDATE`, [refs[0].stage, refs[0].machine_id]);
      const a = siblings.findIndex(q => q.id === input.first_id), b = siblings.findIndex(q => q.id === input.second_id);
      if (a < 0 || b < 0 || siblings[a].position !== input.first_position || siblings[b].position !== input.second_position)
        throw new ProductionError("تغير ترتيب الطابور؛ أعد تحميله", "The queue positions changed. Reload it.");
      [siblings[a], siblings[b]] = [siblings[b], siblings[a]];
      await normalizeQueue(tx, siblings);
      return { reordered: true };
    });
  }
}
async function normalizeQueue(tx: Connection, siblings: { id: number }[]) {
  if (!siblings.length) return;
  await tx.query(`UPDATE factory_queues q SET position=rank.position FROM unnest($1::int[],$2::int[]) AS rank(id,position)
    WHERE q.id=rank.id`, [siblings.map(q => q.id), siblings.map((_, index) => index + 1)]);
}
async function recompute(tx: Connection, order: LockedOrder) {
  const exec = await execution(tx, order.id);
  const rolls = await rows<ProductionRollRecord>(tx, "SELECT * FROM factory_rolls WHERE production_order_id=$1", [order.id]);
  const completed = !!exec.film_closed_at && rolls.length > 0 && rolls.every(r => r.stage === "done");
  const stage = !exec.film_closed_at ? "film" : completed ? "completed" :
    exec.is_printed && rolls.some(r => !r.printed_at) ? "printing" : "cutting";
  let batch: string | null = null;
  if (completed) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-batch-numbers',0))");
    do {
      batch = `FP-${(await one<{ sequence: string }>(tx, "SELECT nextval('factory_batch_number_seq')::text sequence")).sequence.padStart(8, "0")}`;
    } while ((await rows(tx, "SELECT 1 FROM production_orders WHERE batch_number=$1", [batch])).length);
  }
  await tx.query(`UPDATE factory_execution SET stage=$2,completed_at=CASE WHEN $3 THEN COALESCE(completed_at,clock_timestamp()) ELSE NULL END,
    batch_number=CASE WHEN $3 THEN COALESCE(batch_number,$4) ELSE NULL END WHERE production_order_id=$1`, [order.id, stage, completed, batch]);
  await tx.query(`UPDATE production_orders SET status=$2,batch_number=(SELECT batch_number FROM factory_execution WHERE production_order_id=$1)
    WHERE id=$1`, [order.id, completed ? "completed" : "active"]);
  if (exec.film_closed_at) await tx.query("DELETE FROM factory_queues WHERE production_order_id=$1 AND stage='film'", [order.id]);
  if (exec.is_printed && rolls.length && rolls.every(r => !!r.printed_at) && exec.film_closed_at)
    await tx.query("DELETE FROM factory_queues WHERE production_order_id=$1 AND stage='printing'", [order.id]);
  if (completed) {
    await tx.query("DELETE FROM factory_queues WHERE production_order_id=$1", [order.id]);
    await tx.query(`UPDATE orders SET status='completed' WHERE id=$1 AND status='in_production' AND
      NOT EXISTS(SELECT 1 FROM production_orders WHERE order_id=$1 AND status NOT IN ('completed','cancelled','archived'))`, [order.order_id]);
  }
}