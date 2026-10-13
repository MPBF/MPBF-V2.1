import type { DeliveryInput, DeliveryStock, FinishedDelivery, ProductionUser } from "../../shared/production";
import { kgHundredths, kgString } from "../../shared/production";
import { execution, lockOrders, mutate, one, permission, ProductionError, rows, type Connection, type ConnectionPool } from "./core";

export class FinishedDeliveryService {
  constructor(readonly pool: ConnectionPool) {}
  deliver(actor: ProductionUser, input: DeliveryInput): Promise<FinishedDelivery> {
    permission(actor, "manage_finished_warehouse");
    return mutate(this.pool, actor, "finished-delivery", input, async tx => {
      if (!input.items.length || input.items.length > 100 || new Set(input.items.map(i => i.inventory_id)).size !== input.items.length)
        throw new ProductionError("اختر من 1 إلى 100 رصيد دون تكرار.", "Choose 1–100 distinct balances.", 400);
      const ids = input.items.map(i => i.inventory_id).sort((a, b) => a - b);
      const references = await rows<{id:number;production_order_id:number}>(tx,
        "SELECT id,production_order_id FROM factory_inventory WHERE id=ANY($1::int[])", [ids]);
      if (references.length !== ids.length) throw new ProductionError("أحد الأرصدة غير موجود؛ حدّث المخزون.", "A balance was not found. Refresh inventory.", 404);
      // Identical parent->production->inventory ordering as receiving; no nested transaction.
      const orders = await lockOrders(tx, references.map(r => r.production_order_id), false);
      if (orders.some(o => ["cancelled", "archived"].includes(o.order_status) || ["cancelled", "archived"].includes(o.status)))
        throw new ProductionError("لا يمكن تسليم طلب ملغي أو مؤرشف.", "Cannot deliver a cancelled or archived order.");
      const customers = [...new Set(orders.map(o => o.customer_id))];
      if (customers.length !== 1) throw new ProductionError("سند التسليم لعميل واحد فقط؛ افصل العملاء في سندات مستقلة.", "A delivery voucher belongs to one customer. Use separate vouchers for different customers.", 400);
      const customer = await one<{id:string;name:string;name_ar:string|null}>(tx,
        "SELECT id,name,name_ar FROM customers WHERE id=$1 FOR SHARE", [customers[0]]);
      const balances = await rows<{id:number;production_order_id:number;customer_product_id:number;item_id:string;quantity_kg:string}>(tx,
        "SELECT * FROM factory_inventory WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
      for (const item of input.items) {
        const balance = balances.find(b => b.id === item.inventory_id);
        if (!balance || balance.production_order_id !== references.find(r => r.id === balance.id)?.production_order_id)
          throw new ProductionError("تغير ربط الرصيد؛ أعد تحميل المخزون.", "The balance relationship changed. Reload inventory.");
        let quantity: bigint;
        try { quantity = kgHundredths(item.quantity_kg); }
        catch { throw new ProductionError("أدخل كمية موجبة بالكيلو حتى منزلتين.", "Enter a positive kg quantity with at most two decimals.", 400); }
        if (quantity <= 0n || quantity > kgHundredths(balance.quantity_kg))
          throw new ProductionError("كمية التسليم تتجاوز الرصيد المتاح أو غير موجبة.", "Delivery weight exceeds available stock or is not positive.");
        const exec = await execution(tx, balance.production_order_id);
        if (exec.customer_product_id !== balance.customer_product_id || exec.item_id !== balance.item_id)
          throw new ProductionError("علاقة المنتج بالرصيد غير متوافقة؛ راجع الإدارة.", "The balance product relationship is inconsistent. Contact an administrator.");
      }
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-finished-delivery-number',0))");
      const { sequence } = await one<{sequence:string}>(tx,
        "SELECT (COALESCE(MAX(substring(voucher_number FROM '^FP-Del([0-9]+)$')::bigint),0)+1)::text sequence FROM factory_deliveries WHERE voucher_number ~ '^FP-Del[0-9]+$'");
      const saved = await one<FinishedDelivery>(tx, `INSERT INTO factory_deliveries
        (voucher_number,customer_id,customer_name,customer_name_ar,created_by,notes)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [`FP-Del${sequence.padStart(4,"0")}`, customer.id, customer.name, customer.name_ar, actor.id, input.notes ?? null]);
      const savedItems: FinishedDelivery["items"] = [];
      for (const item of input.items) {
        const balance = balances.find(b => b.id === item.inventory_id)!;
        const order = orders.find(o => o.id === balance.production_order_id)!;
        const exec = await execution(tx, balance.production_order_id);
        const quantity = kgString(kgHundredths(item.quantity_kg));
        const line = await one<FinishedDelivery["items"][number]>(tx, `INSERT INTO factory_delivery_items
          (delivery_id,inventory_id,production_order_id,production_order_number,item_id,product,quantity_kg)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
        [saved.id,balance.id,order.id,order.production_order_number,balance.item_id,JSON.stringify(exec.product),quantity]);
        await tx.query("UPDATE factory_inventory SET quantity_kg=quantity_kg-$2::numeric WHERE id=$1", [balance.id, quantity]);
        await tx.query("INSERT INTO factory_delivery_movements(delivery_item_id,inventory_id,quantity_kg) VALUES($1,$2,$3)", [line.id, balance.id, quantity]);
        savedItems.push(line);
      }
      return { ...saved, items: savedItems };
    });
  }
  async stock(actor: ProductionUser, filter: {before?:number;search?:string;limit?:number} = {}) {
    permission(actor, "view_finished_inventory", "manage_finished_warehouse");
    return this.read(async tx => {
      const limit = Math.min(Math.max(filter.limit ?? 100,1),100);
      const params: unknown[] = [];
      const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const where = ["inv.quantity_kg>0"];
      if (filter.before) where.push(`inv.id<${bind(filter.before)}`);
      if (filter.search) {
        const s = bind(`%${filter.search.replace(/[\\%_]/g,"\\$&")}%`);
        where.push(`(p.production_order_number ILIKE ${s} OR o.order_number ILIKE ${s} OR c.name ILIKE ${s}
          OR c.name_ar ILIKE ${s} OR e.product->>'name' ILIKE ${s} OR e.product->>'name_ar' ILIKE ${s})`);
      }
      const records = await rows<DeliveryStock>(tx, `SELECT inv.*,p.production_order_number,o.order_number,
        o.customer_id,p.status production_order_status,e.completed_at IS NOT NULL production_complete,
        e.product || jsonb_build_object('customer_name',c.name,'customer_name_ar',c.name_ar) product,
        l.name location_name,l.name_ar location_name_ar,
        (inv.quantity_kg+COALESCE(delivered.total,0))::text received_kg,
        COALESCE(delivered.total,0)::text delivered_kg
        FROM factory_inventory inv JOIN production_orders p ON p.id=inv.production_order_id
        JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id
        JOIN factory_execution e ON e.production_order_id=p.id JOIN factory_locations l ON l.id=inv.location_id
        LEFT JOIN LATERAL(SELECT sum(quantity_kg) total FROM factory_delivery_movements WHERE inventory_id=inv.id) delivered ON true
        WHERE ${where.join(" AND ")} ORDER BY inv.id DESC LIMIT ${bind(limit+1)}`, params);
      const more = records.length>limit; if(more) records.pop();
      return {records,next:more?records.at(-1)!.id:null};
    });
  }
  async history(actor: ProductionUser, filter: {before?:number;search?:string;limit?:number} = {}) {
    permission(actor, "view_finished_inventory", "manage_finished_warehouse");
    return this.read(async tx => {
      const params: unknown[] = [];
      const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const where: string[] = [];
      if(filter.before) where.push(`d.id<${bind(filter.before)}`);
      if(filter.search) {
        const s = bind(`%${filter.search.replace(/[\\%_]/g,"\\$&")}%`);
        where.push(`(d.voucher_number ILIKE ${s} OR d.customer_name ILIKE ${s} OR d.customer_name_ar ILIKE ${s})`);
      }
      const limit=Math.min(Math.max(filter.limit??50,1),100);
      const records=await rows<FinishedDelivery>(tx, `SELECT d.*,COALESCE(lines.items,'[]'::jsonb) items FROM factory_deliveries d
        LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',i.id,'inventory_id',i.inventory_id,
          'production_order_id',i.production_order_id,'production_order_number',i.production_order_number,
          'item_id',i.item_id,'product',i.product,'quantity_kg',i.quantity_kg::text) ORDER BY i.id) items
          FROM factory_delivery_items i WHERE i.delivery_id=d.id) lines ON true
        ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY d.id DESC LIMIT ${bind(limit+1)}`,params);
      const more=records.length>limit;if(more)records.pop();
      return {records,next:more?records.at(-1)!.id:null};
    });
  }
  private async read<T>(action:(tx:Connection)=>Promise<T>){
    const tx=await this.pool.connect();
    try{await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const result=await action(tx);await tx.query("COMMIT");return result;}
    catch(e){await tx.query("ROLLBACK").catch(()=>{});throw e;}finally{tx.release();}
  }
}
