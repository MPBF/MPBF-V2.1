import { kgHundredths, kgString, type ProductionUser } from "../../shared/production";
import { canManageMixing, type MixingInput, type MixingUpdateInput } from "../../shared/raw-mixing";
import { mutate, one, rows, ProductionError, type Connection, type ConnectionPool } from "./core";
import { lockMixMachine } from "./mix-consumption";

type StoredMix = {
  id: number; machine_id: string; screw: string | null; notes: string | null;
  total_kg: string; revision: number; deleted_at: string | null;
  items: { material_id: number; quantity_kg: string }[];
};
type Validator = (tx: Connection, items: MixingInput["items"], oldIds: number[]) => Promise<string>;
const changed = () => new ProductionError("تغيّرت الخلطة؛ أعد تحميل السجل قبل المحاولة", "The mix changed. Reload the history before trying again.");
const protectedMix = () => new ProductionError(
  "الخلطة مستخدمة في الإنتاج أو تاريخية لا يمكن التحقق من استهلاكها؛ يمكن تعديل الملاحظات فقط",
  "This mix is used in production or its historical consumption cannot be verified. Only notes can be edited.");
// Full totals may exceed the single-line input limit; do not round through Number.
const recordedWeight = (value: string) => {
  if (!/^\d{1,16}\.\d{2}$/.test(value)) throw new Error("Invalid recorded mix weight");
  return BigInt(value.replace(".", ""));
};
const signedWeight = (value: bigint) => value < 0n ? `-${kgString(-value)}` : kgString(value);

export function correctMix(
  pool: ConnectionPool, actor: ProductionUser, mixId: number,
  input: MixingUpdateInput, deleting: boolean, validate: Validator,
) {
  if (!canManageMixing(actor)) throw new ProductionError(
    "تعديل الخلطات وحذفها متاح لإدارة الخلطات فقط", "Only mixing managers can edit or delete mixes.", 403);
  const payload = { ...input, mix_id: mixId };
  return mutate(pool, actor, deleting ? "mix-delete" : "mix-edit", payload, async tx => {
    const reference = await one<{ machine_id: string }>(tx, "SELECT machine_id FROM factory_mixes WHERE id=$1", [mixId]);
    // Same order as both film and mix writers: request -> machine -> rows.
    for (const machine of [...new Set([reference.machine_id, input.contents?.machine_id ?? reference.machine_id])].sort())
      await lockMixMachine(tx, machine);
    const current = await one<StoredMix>(tx, `SELECT m.id,m.machine_id,m.screw,m.notes,m.total_kg::text,m.revision,m.deleted_at,m.created_by,m.created_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('material_id',i.material_id,'quantity_kg',i.quantity_kg::text)
      ORDER BY i.material_id) FROM factory_mix_items i WHERE i.mix_id=m.id),'[]'::jsonb) items
      FROM factory_mixes m WHERE m.id=$1 FOR UPDATE OF m`, [mixId]);
    if (current.machine_id !== reference.machine_id || current.revision !== input.expected_revision || current.deleted_at)
      throw changed();
    const changingContents = deleting || !!input.contents;
    if (changingContents) {
      const allowed = await one<{ allowed: boolean }>(tx, `SELECT
        EXISTS(SELECT 1 FROM factory_mix_activation WHERE $1>last_mix_id)
        AND NOT EXISTS(SELECT 1 FROM factory_mix_allocations WHERE mix_id=$1) allowed`, [mixId]);
      if (!allowed.allowed) throw protectedMix();
    }
    let total = current.total_kg;
    let newItems = current.items;
    let machineId = current.machine_id, screw = current.screw;
    if (!deleting && input.contents) {
      machineId = input.contents.machine_id;
      const machine = await one<{ type: string; status: string; screw_type: string | null }>(tx,
        "SELECT type,status,screw_type FROM machines WHERE id=$1 FOR SHARE", [machineId]);
      if (String(machine.type).toLowerCase() !== "extruder" || machine.status !== "active")
        throw new ProductionError("اختر ماكينة فيلم نشطة", "Choose an active film machine.", 400);
      screw = input.contents.screw ?? (machine.screw_type === "ABA" ? null : "A");
      if (!screw || !["A", "B"].includes(screw) || screw === "B" && machine.screw_type !== "ABA")
        throw new ProductionError("اختر لولباً متوافقاً مع ماكينة الفيلم", "Choose a screw compatible with the film machine.", 400);
      total = await validate(tx, input.contents.items, current.items.map(i => i.material_id));
      newItems = input.contents.items.map(i => ({
        material_id: i.material_id, quantity_kg: kgString(kgHundredths(i.quantity_kg)),
      })).sort((a,b) => a.material_id-b.material_id);
    } else if (deleting) {
      // Refund old catalogue items even if inactive; never erase their identities.
      await tx.query("SELECT id FROM factory_raw_materials WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
        [current.items.map(i => i.material_id)]);
      newItems = [];
    }
    const revision = current.revision + 1;
    const updated = await one<Record<string, unknown>>(tx, `UPDATE factory_mixes SET
      machine_id=$2,screw=$3,notes=$4,total_kg=$5,revision=$6,
      updated_at=clock_timestamp(),updated_by=$7::integer,
      deleted_at=CASE WHEN $8::boolean THEN clock_timestamp() ELSE NULL END,
      deleted_by=CASE WHEN $8::boolean THEN $7::integer ELSE NULL END
      WHERE id=$1 RETURNING id,machine_id,screw,notes,total_kg::text,revision,deleted_at,created_at,created_by`,
      [mixId,machineId,screw,input.notes === undefined ? current.notes : input.notes || null,total,revision,actor.id,deleting]);
    await tx.query(`INSERT INTO factory_mix_revisions(mix_id,revision,action,before_data,after_data,created_by)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
      mixId,revision,deleting ? "delete" : "edit",JSON.stringify(current),
      JSON.stringify({ ...updated, items: newItems }),actor.id,
    ]);
    const balances = [];
    if (changingContents) {
      const oldById = new Map(current.items.map(i => [i.material_id, recordedWeight(i.quantity_kg)]));
      const nextById = new Map(newItems.map(i => [i.material_id, recordedWeight(i.quantity_kg)]));
      for (const materialId of [...new Set([...oldById.keys(), ...nextById.keys()])].sort((a,b) => a-b)) {
        const delta = (oldById.get(materialId) ?? 0n) - (nextById.get(materialId) ?? 0n);
        if (!delta) continue;
        const balance = await one<{ id: number; quantity_kg: string }>(tx,
          "UPDATE factory_raw_materials SET quantity_kg=quantity_kg+$2::numeric WHERE id=$1 RETURNING id,quantity_kg::text",
          [materialId,signedWeight(delta)]);
        await tx.query(`INSERT INTO factory_mix_stock_adjustments(mix_id,revision,material_id,quantity_kg,balance_after_kg,created_by)
          VALUES($1,$2,$3,$4,$5,$6)`, [mixId,revision,materialId,signedWeight(delta),balance.quantity_kg,actor.id]);
        balances.push(balance);
      }
      if (!deleting) {
        await tx.query("DELETE FROM factory_mix_items WHERE mix_id=$1", [mixId]);
        for (const item of newItems) await tx.query(
          "INSERT INTO factory_mix_items(mix_id,material_id,quantity_kg) VALUES($1,$2,$3)", [mixId,item.material_id,item.quantity_kg]);
      }
    }
    return { id: mixId, revision, deleted: deleting, balances };
  });
}
