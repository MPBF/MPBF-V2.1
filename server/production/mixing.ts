import { kgHundredths, kgString, type ProductionUser } from "../../shared/production";
import { canRecordMixing, canViewMixing, canViewRawInventory, type MixingInput, type MixingRecord, type MixingState, type RawMaterial, type RawMovementInput, type RawVoucher } from "../../shared/raw-mixing";
import { mutate, one, permission, ProductionError, rows, type ConnectionPool, type Connection } from "./core";

const filmTypes = ["extruder"];
// The catalogue owns material identities; stock and operational forms cannot
// introduce definitions. Matching category labels accommodates existing IDs.
const rawCategorySQL = `(lower(trim(c.name)) IN ('raw','raw material','raw materials')
  OR trim(c.name_ar) IN ('خام','الخامات','مواد خام','المواد الخام'))`;
export class RawMixingService {
  constructor(readonly pool: ConnectionPool) {}
  private async syncCatalogue() {
    // Provision only zero-balance identity links. Existing quantities/history
    // are never overwritten, nor are legacy names heuristically reassigned.
    const connection = await this.pool.connect();
    try {
      await connection.query(`INSERT INTO factory_raw_materials(item_id,code,name,name_ar)
        SELECT i.id,'item:'||i.id,COALESCE(NULLIF(i.name,''),i.id),COALESCE(NULLIF(i.name_ar,''),i.id)
        FROM items i JOIN categories c ON c.id=i.category_id WHERE ${rawCategorySQL}
        ORDER BY i.id ON CONFLICT (item_id) DO NOTHING`);
    } finally { connection.release(); }
  }
  private async lockMaterials(tx: Connection, items: MixingInput["items"]) {
    if (!items.length || items.length > 100 || new Set(items.map(i => i.material_id)).size !== items.length)
      throw new ProductionError("اختر مواد من القائمة دون تكرار", "Select catalogue materials without duplicates.", 400);
    const ids = items.map(i => i.material_id).sort((a,b) => a-b);
    const eligible = await rows<{id:number}>(tx, `SELECT r.id FROM factory_raw_materials r
      JOIN items i ON i.id=r.item_id JOIN categories c ON c.id=i.category_id
      WHERE r.id=ANY($1::int[]) AND r.is_active AND COALESCE(i.status,'active')='active' AND ${rawCategorySQL}
      ORDER BY r.id FOR SHARE OF i,c`, [ids]);
    if (eligible.length !== ids.length)
      throw new ProductionError("اختر أصنافًا نشطة من فئة المواد الخام المعرّفة مسبقًا", "Select active predefined raw-category items.", 400);
    const locked = await rows<{id:number; is_active:boolean}>(tx,
      "SELECT id,is_active FROM factory_raw_materials WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
    if (locked.length!==ids.length || locked.some(r => !r.is_active))
      throw new ProductionError("الصنف غير نشط", "The item is inactive.", 400);
    const quantities = items.map(i => kgHundredths(i.quantity_kg));
    if (quantities.some(q => q<=0n)) throw new ProductionError("كميات المواد يجب أن تكون موجبة", "Material weights must be positive.", 400);
    return kgString(quantities.reduce((sum,q) => sum+q,0n));
  }
  async state(actor: ProductionUser, before?: number): Promise<MixingState> {
    if (!canViewMixing(actor) && !canViewRawInventory(actor))
      throw new ProductionError("لا تملك صلاحية عرض الخلط أو مخزون الخام", "You cannot view mixing or raw inventory.", 403);
    await this.syncCatalogue();
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const materials = await rows<RawMaterial>(tx, `SELECT r.id,i.id item_id,COALESCE(NULLIF(i.code,''),i.id) code,
        COALESCE(NULLIF(i.name,''),i.id) name,COALESCE(NULLIF(i.name_ar,''),i.id) name_ar,r.quantity_kg::text,
        (r.is_active AND COALESCE(i.status,'active')='active') is_active
        FROM factory_raw_materials r JOIN items i ON i.id=r.item_id JOIN categories c ON c.id=i.category_id
        WHERE ${rawCategorySQL} ORDER BY i.code NULLS LAST,i.id`);
      const machines = canViewMixing(actor) ? await rows<MixingState["machines"][number]>(tx,
        "SELECT id,name,name_ar,status FROM machines WHERE lower(type)=ANY($1::text[]) ORDER BY id", [filmTypes]) : [];
      const history = canViewMixing(actor) ? await rows<MixingRecord>(tx, `SELECT m.id,m.machine_id,m.created_by,m.created_at,m.notes,m.total_kg::text,
        ma.name machine_name,ma.name_ar machine_name_ar,
        COALESCE(NULLIF(u.display_name,''),u.username) actor_name,
        COALESCE(NULLIF(u.display_name_ar,''),NULLIF(u.full_name,''),u.username) actor_name_ar,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('material_id',i.material_id,'code',COALESCE(NULLIF(ci.code,''),ci.id,r.code),
          'name',r.name,'name_ar',r.name_ar,'quantity_kg',i.quantity_kg::text) ORDER BY i.id)
          FROM factory_mix_items i JOIN factory_raw_materials r ON r.id=i.material_id
          LEFT JOIN items ci ON ci.id=r.item_id WHERE i.mix_id=m.id),'[]'::jsonb) items
        FROM factory_mixes m JOIN machines ma ON ma.id=m.machine_id JOIN users u ON u.id=m.created_by
        WHERE ($1::int IS NULL OR m.id<$1) ORDER BY m.id DESC LIMIT 51`, [before ?? null]) : [];
      const raw_vouchers = canViewRawInventory(actor) ? await rows<RawVoucher>(tx, `SELECT v.id,v.kind,v.total_kg::text,
        v.created_at,v.created_by,v.notes,COALESCE(NULLIF(u.display_name,''),u.username) actor_name,
        COALESCE(NULLIF(u.display_name_ar,''),NULLIF(u.full_name,''),u.username) actor_name_ar,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('material_id',l.material_id,
          'code',COALESCE(NULLIF(ci.code,''),ci.id,r.code),'name',r.name,'name_ar',r.name_ar,
          'quantity_kg',abs(l.quantity_kg)::text) ORDER BY l.id)
          FROM factory_raw_movements l JOIN factory_raw_materials r ON r.id=l.material_id
          LEFT JOIN items ci ON ci.id=r.item_id WHERE l.voucher_id=v.id),'[]'::jsonb) items
        FROM factory_raw_vouchers v JOIN users u ON u.id=v.created_by ORDER BY v.id DESC LIMIT 50`) : [];
      await tx.query("COMMIT");
      return { materials, machines, records: history.slice(0,50), next_before: history.length > 50 ? history[49].id : null, raw_vouchers };
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { tx.release(); }
  }
  record(actor: ProductionUser, input: MixingInput) {
    if (!canRecordMixing(actor)) throw new ProductionError("لا تملك صلاحية تسجيل الخلطات", "You cannot record mixes.", 403);
    return mutate(this.pool, actor, "raw-mixing", input, async tx => {
      const machine = await one<{ type: string | null; status: string }>(tx, "SELECT type,status FROM machines WHERE id=$1 FOR SHARE", [input.machine_id]);
      if (!filmTypes.includes(String(machine.type).toLowerCase()) || machine.status !== "active")
        throw new ProductionError("اختر ماكينة فيلم نشطة", "Choose an active film machine.", 400);
      const total = await this.lockMaterials(tx,input.items);
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
  movement(actor: ProductionUser, input: RawMovementInput) {
    permission(actor,"manage_raw_materials");
    if (!["receipt","issue"].includes(input.kind)) throw new ProductionError("اختر إدخال أو صرف", "Choose receipt or issue.", 400);
    return mutate(this.pool, actor, "raw-stock-movement", input, async tx => {
      const total = await this.lockMaterials(tx,input.items);
      const voucher = await one<{id:number; kind: "receipt"|"issue"; total_kg:string; created_at:string; created_by:number}>(tx,
        `INSERT INTO factory_raw_vouchers(kind,total_kg,notes,created_by) VALUES($1,$2,$3,$4)
          RETURNING id,kind,total_kg::text,created_at,created_by`, [input.kind,total,input.notes || null,actor.id]);
      const balances = [];
      for (const item of [...input.items].sort((a,b) => a.material_id-b.material_id)) {
        // kgString formats nonnegative weights. Prefix the sign after
        // formatting, otherwise BigInt's negative remainder yields "-100.-25".
        const positive = kgString(kgHundredths(item.quantity_kg));
        const quantity = input.kind==="issue" ? `-${positive}` : positive;
        const material = await one<{id:number; quantity_kg:string}>(tx,
          "UPDATE factory_raw_materials SET quantity_kg=quantity_kg+$2::numeric WHERE id=$1 RETURNING id,quantity_kg::text", [item.material_id,quantity]);
        await tx.query(`INSERT INTO factory_raw_movements(material_id,voucher_id,kind,quantity_kg,balance_after_kg,created_by)
          VALUES($1,$2,$3,$4,$5,$6)`, [item.material_id,voucher.id,input.kind,quantity,material.quantity_kg,actor.id]);
        balances.push(material);
      }
      return {...voucher,balances};
    });
  }
}
