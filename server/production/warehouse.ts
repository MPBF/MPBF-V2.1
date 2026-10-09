import { kgHundredths, kgString, packagingMatches, type ProductionUser, type ReceiptInput } from "../../shared/production";
import { available, execution, lockOrders, mutate, one, permission, ProductionError, rows, type ConnectionPool } from "./core";

export class ProductionWarehouseService {
  constructor(readonly pool: ConnectionPool) {}
  receive(actor: ProductionUser, input: ReceiptInput) {
    permission(actor, "receive_production");
    return mutate(this.pool, actor, "receive", input, async tx => {
      const orders = await lockOrders(tx, input.items.map(i => i.production_order_id), false);
      if (orders.some(o => ["cancelled", "archived", "delivered"].includes(o.order_status)))
        throw new ProductionError("لا يمكن الاستلام لطلب ملغي أو مؤرشف أو مسلّم", "Cannot receive for a cancelled, archived or delivered order.");
      const pairs = input.items.map(i => `${i.production_order_id}:${i.location_id}`);
      if (new Set(pairs).size !== pairs.length) throw new ProductionError("بند الاستلام مكرر", "A receipt line is duplicated.", 400);
      const locations = [...new Set(input.items.map(i => i.location_id))].sort((a, b) => a - b);
      const existingLocations = await rows<{ id: number; is_active: boolean }>(tx,
        "SELECT id,is_active FROM factory_locations WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE", [locations]);
      if (existingLocations.length !== locations.length || existingLocations.some(l => !l.is_active))
        throw new ProductionError("اختر مواقع تخزين نشطة وصحيحة لكل البنود", "Choose valid active storage locations for all lines.", 400);
      for (const order of orders) {
        await execution(tx, order.id);
        const total = await available(tx, order.id);
        const requested = input.items.filter(i => i.production_order_id === order.id).reduce((sum, i) => sum + kgHundredths(i.quantity_kg), 0n);
        if (requested > kgHundredths(total.ready) - kgHundredths(total.received))
          throw new ProductionError("كمية الاستلام تتجاوز الجاهز المتبقي؛ أعد تحميل الصالة", "Receipt quantity exceeds the remaining ready weight. Reload the hall.");
      }
      for (const item of input.items) {
        if (kgHundredths(item.quantity_kg) <= 0n) throw new ProductionError("كمية الاستلام يجب أن تكون موجبة", "Receipt weight must be positive.", 400);
        if (item.packaging && !packagingMatches(item.quantity_kg, item.packaging))
          throw new ProductionError("وزن التعبئة لا يطابق الاستلام ضمن ±2% وهامش 0.01 كجم", "Packaging weight does not match receipt weight within ±2% plus 0.01 kg.", 400);
      }
      // Sequence value and voucher are server-generated; gaps after rollback are normal.
      const { id } = await one<{ id: number }>(tx, "SELECT nextval(pg_get_serial_sequence('factory_receipts','id'))::int id");
      const receipt = await one<{ id: number; voucher_number: string }>(tx,
        "INSERT INTO factory_receipts(id,voucher_number,created_by,notes) VALUES($1,$2,$3,$4) RETURNING *",
        [id, `FR-${String(id).padStart(8, "0")}`, actor.id, input.notes ?? null]);
      const savedItems = [];
      for (const item of input.items) {
        const exec = await execution(tx, item.production_order_id);
        const weight = kgString(kgHundredths(item.quantity_kg));
        const saved = await one<{ id: number }>(tx, `INSERT INTO factory_receipt_items
          (receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg,packaging)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
        [id, item.production_order_id, exec.customer_product_id, exec.item_id, item.location_id, weight, item.packaging ? JSON.stringify(item.packaging) : null]);
        await tx.query(`INSERT INTO factory_inventory(production_order_id,customer_product_id,item_id,location_id,quantity_kg)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(customer_product_id,production_order_id,location_id) DO UPDATE
          SET quantity_kg=factory_inventory.quantity_kg+excluded.quantity_kg`,
        [item.production_order_id, exec.customer_product_id, exec.item_id, item.location_id, weight]);
        await tx.query("INSERT INTO factory_movements(receipt_id,receipt_item_id,quantity_kg) VALUES($1,$2,$3)", [id, saved.id, weight]);
        savedItems.push(saved);
      }
      return { ...receipt, items: savedItems };
    });
  }
  location(actor: ProductionUser, input: { request_id: string; name: string; name_ar: string; is_active?: boolean }, id?: number) {
    permission(actor, "manage_finished_warehouse");
    return mutate(this.pool, actor, `location:${id ?? "new"}`, input, tx => id
      ? one(tx, "UPDATE factory_locations SET name=$2,name_ar=$3,is_active=$4 WHERE id=$1 RETURNING *", [id, input.name, input.name_ar, input.is_active ?? true])
      : one(tx, "INSERT INTO factory_locations(name,name_ar,is_active) VALUES($1,$2,$3) RETURNING *", [input.name, input.name_ar, input.is_active ?? true]));
  }
}