import { kgHundredths, kgString, type ProductionUser } from "../../shared/production";
import { canRecordMixing, canViewMixing, canViewRawInventory, type MixingInput, type MixingRecord, type MixingState, type RawMaterial, type RawMaterialInput } from "../../shared/raw-mixing";
import { mutate, one, permission, ProductionError, rows, type ConnectionPool } from "./core";

const filmTypes = ["extruder"];
export class RawMixingService {
  constructor(readonly pool: ConnectionPool) {}
  async state(actor: ProductionUser, before?: number): Promise<MixingState> {
    if (!canViewMixing(actor) && !canViewRawInventory(actor))
      throw new ProductionError("لا تملك صلاحية عرض الخلط أو مخزون الخام", "You cannot view mixing or raw inventory.", 403);
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const materials = await rows<RawMaterial>(tx, "SELECT id,code,name,name_ar,quantity_kg::text,is_active FROM factory_raw_materials ORDER BY code,id");
      const machines = canViewMixing(actor) ? await rows<MixingState["machines"][number]>(tx,
        "SELECT id,name,name_ar,status FROM machines WHERE lower(type)=ANY($1::text[]) ORDER BY id", [filmTypes]) : [];
      const history = canViewMixing(actor) ? await rows<MixingRecord>(tx, `SELECT m.id,m.machine_id,m.created_by,m.created_at,m.notes,m.total_kg::text,
        ma.name machine_name,ma.name_ar machine_name_ar,
        COALESCE(NULLIF(u.display_name,''),u.username) actor_name,
        COALESCE(NULLIF(u.display_name_ar,''),NULLIF(u.full_name,''),u.username) actor_name_ar,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('material_id',i.material_id,'code',r.code,
          'name',r.name,'name_ar',r.name_ar,'quantity_kg',i.quantity_kg::text) ORDER BY i.id)
          FROM factory_mix_items i JOIN factory_raw_materials r ON r.id=i.material_id WHERE i.mix_id=m.id),'[]'::jsonb) items
        FROM factory_mixes m JOIN machines ma ON ma.id=m.machine_id JOIN users u ON u.id=m.created_by
        WHERE ($1::int IS NULL OR m.id<$1) ORDER BY m.id DESC LIMIT 51`, [before ?? null]) : [];
      await tx.query("COMMIT");
      return { materials, machines, records: history.slice(0,50), next_before: history.length > 50 ? history[49].id : null };
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { tx.release(); }
  }
  record(actor: ProductionUser, input: MixingInput) {
    if (!canRecordMixing(actor)) throw new ProductionError("لا تملك صلاحية تسجيل الخلطات", "You cannot record mixes.", 403);
    return mutate(this.pool, actor, "raw-mixing", input, async tx => {
      if (!input.items.length || new Set(input.items.map(i => i.material_id)).size !== input.items.length)
        throw new ProductionError("أدخل مادة واحدة على الأقل دون تكرار", "Enter at least one material without duplicates.", 400);
      const machine = await one<{ type: string | null; status: string }>(tx, "SELECT type,status FROM machines WHERE id=$1 FOR SHARE", [input.machine_id]);
      if (!filmTypes.includes(String(machine.type).toLowerCase()) || machine.status !== "active")
        throw new ProductionError("اختر ماكينة فيلم نشطة", "Choose an active film machine.", 400);
      const ids = input.items.map(i => i.material_id).sort((a,b) => a-b);
      const materials = await rows<{ id: number; is_active: boolean }>(tx,
        "SELECT id,is_active FROM factory_raw_materials WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
      if (materials.length !== ids.length || materials.some(r => !r.is_active))
        throw new ProductionError("اختر مواد خام نشطة وصحيحة", "Choose valid active raw materials.", 400);
      const quantities = input.items.map(i => kgHundredths(i.quantity_kg));
      if (quantities.some(q => q<=0n)) throw new ProductionError("كميات المواد يجب أن تكون موجبة", "Material weights must be positive.", 400);
      const total = kgString(quantities.reduce((sum,q) => sum+q,0n));
      const mix = await one<{ id: number; created_by: number; created_at: string; total_kg: string }>(tx,
        "INSERT INTO factory_mixes(machine_id,created_by,notes,total_kg) VALUES($1,$2,$3,$4) RETURNING id,created_by,created_at,total_kg::text",
        [input.machine_id,actor.id,input.notes || null,total]);
      const balances = [];
      for (const item of [...input.items].sort((a,b) => a.material_id-b.material_id)) {
        const quantity = kgString(kgHundredths(item.quantity_kg));
        await tx.query("INSERT INTO factory_mix_items(mix_id,material_id,quantity_kg) VALUES($1,$2,$3)", [mix.id,item.material_id,quantity]);
        const material = await one<{ id: number; quantity_kg: string }>(tx,
          "UPDATE factory_raw_materials SET quantity_kg=quantity_kg-$2::numeric WHERE id=$1 RETURNING id,quantity_kg::text", [item.material_id,quantity]);
        await tx.query(`INSERT INTO factory_raw_movements(material_id,mix_id,kind,quantity_kg,balance_after_kg,created_by)
          VALUES($1,$2,'mixing',-$3::numeric,$4,$5)`, [item.material_id,mix.id,quantity,material.quantity_kg,actor.id]);
        balances.push(material);
      }
      return { ...mix, balances };
    });
  }
  createMaterial(actor: ProductionUser, input: RawMaterialInput) {
    permission(actor,"manage_raw_materials");
    return mutate(this.pool, actor, "raw-material-create", input, async tx => {
      const opening = kgHundredths(input.opening_kg);
      if (opening<0n) throw new ProductionError("الرصيد الافتتاحي لا يكون سالبًا", "Opening stock cannot be negative.", 400);
      const material = await one<RawMaterial>(tx, `INSERT INTO factory_raw_materials(code,name,name_ar,quantity_kg,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING id,code,name,name_ar,quantity_kg::text,is_active`,
        [input.code,input.name,input.name_ar,kgString(opening),actor.id]);
      await tx.query(`INSERT INTO factory_raw_movements(material_id,kind,quantity_kg,balance_after_kg,created_by)
        VALUES($1,'opening',$2,$2,$3)`, [material.id,kgString(opening),actor.id]);
      return material;
    });
  }
}
