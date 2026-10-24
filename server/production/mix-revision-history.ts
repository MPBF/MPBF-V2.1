import type { ProductionUser } from "../../shared/production";
import { canManageMixing, type MixRevision, type MixRevisionPage, type MixRevisionSnapshot } from "../../shared/raw-mixing";
import { rows, ProductionError, type ConnectionPool } from "./core";

type StoredSnapshot = Pick<MixRevisionSnapshot, "machine_id" | "screw" | "notes" | "total_kg"> & {
  items: { material_id: number; quantity_kg: string | number }[];
};
type StoredRevision = Omit<MixRevision, "before_data" | "after_data"> & {
  before_data: StoredSnapshot; after_data: StoredSnapshot;
};

/** Read the audit ledger, never the operational (non-cancelled) mix list. */
export async function mixRevisionHistory(
  pool: ConnectionPool, actor: ProductionUser, mixId?: number, before?: [number, number],
): Promise<MixRevisionPage> {
  if (!canManageMixing(actor)) throw new ProductionError(
    "سجل التصحيحات متاح لإدارة الخلطات فقط", "Only mixing managers can view correction history.", 403);
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const history = await rows<StoredRevision>(tx, `SELECT r.mix_id,r.revision,r.action,r.before_data,r.after_data,
      r.created_by,r.created_at,COALESCE(NULLIF(u.display_name,''),u.username) actor_name,
      COALESCE(NULLIF(u.display_name_ar,''),NULLIF(u.full_name,''),u.username) actor_name_ar,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'material_id',a.material_id,'code',COALESCE(NULLIF(i.code,''),i.id,m.code),
        'name',COALESCE(i.name,NULLIF(m.name,m.code),''),
        'name_ar',COALESCE(i.name_ar,NULLIF(m.name_ar,m.code),''),
        'quantity_kg',a.quantity_kg::text,'balance_after_kg',a.balance_after_kg::text) ORDER BY a.material_id)
        FROM factory_mix_stock_adjustments a LEFT JOIN factory_raw_materials m ON m.id=a.material_id
        LEFT JOIN items i ON i.id=m.item_id
        WHERE a.mix_id=r.mix_id AND a.revision=r.revision),'[]'::jsonb) stock_adjustments
      FROM factory_mix_revisions r LEFT JOIN users u ON u.id=r.created_by
      WHERE ($1::int IS NULL OR r.mix_id=$1)
        AND ($2::int IS NULL OR (r.mix_id,r.revision)<($2,$3::int))
      ORDER BY r.mix_id DESC,r.revision DESC LIMIT 26`, [mixId ?? null, before?.[0] ?? null, before?.[1] ?? null]);
    const page = history.slice(0, 25);
    const snapshots = page.flatMap(record => [record.before_data, record.after_data]);
    const materialIds = [...new Set(snapshots.flatMap(snapshot => snapshot.items.map(item => item.material_id)))];
    const machineIds = [...new Set(snapshots.map(snapshot => snapshot.machine_id))];
    const materials = await rows<MixRevisionSnapshot["items"][number]>(tx, `SELECT m.id material_id,
      COALESCE(NULLIF(i.code,''),i.id,m.code) code,
      COALESCE(i.name,NULLIF(m.name,m.code),'') name,COALESCE(i.name_ar,NULLIF(m.name_ar,m.code),'') name_ar
      FROM factory_raw_materials m LEFT JOIN items i ON i.id=m.item_id WHERE m.id=ANY($1::int[])`, [materialIds]);
    const machines = await rows<{ id: string; name: string | null; name_ar: string | null }>(tx,
      "SELECT id,name,name_ar FROM machines WHERE id=ANY($1::varchar[])", [machineIds]);
    const materialMap = new Map(materials.map(material => [material.material_id, material]));
    const machineMap = new Map(machines.map(machine => [machine.id, machine]));
    const snapshot = (saved: StoredSnapshot): MixRevisionSnapshot => ({
      machine_id: saved.machine_id, machine_name: machineMap.get(saved.machine_id)?.name ?? null,
      machine_name_ar: machineMap.get(saved.machine_id)?.name_ar ?? null,
      screw: saved.screw, notes: saved.notes, total_kg: String(saved.total_kg),
      // Quantities always come from the saved revision, not current mix items.
      items: saved.items.map(item => ({
        code: "", name: "", name_ar: "", ...materialMap.get(item.material_id),
        material_id: item.material_id, quantity_kg: String(item.quantity_kg),
      })),
    });
    const records = page.map(record => ({
      ...record, before_data: snapshot(record.before_data), after_data: snapshot(record.after_data),
    }));
    await tx.query("COMMIT");
    const last = page.at(-1);
    return { records, next_before: history.length > 25 && last ? `${last.mix_id}:${last.revision}` : null };
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { tx.release(); }
}
