import { kgHundredths, kgString, type ProductionUser, type ReceiptInput } from "../../shared/production";
import { normalizeReceiptQuantity, ReceiptQuantityError } from "../../shared/receipt-draft";
import { available, execution, lockOrders, mutate, one, permission, ProductionError, rows, type ConnectionPool } from "./core";
import { receiptSelect } from "./read-queries";

export class ProductionWarehouseService {
  constructor(readonly pool: ConnectionPool) {}
  receive(actor: ProductionUser, input: ReceiptInput) {
    permission(actor, "receive_production");
    return mutate(this.pool, actor, "receive", input, async tx => {
      if (!input.items.length || input.items.length > 100) throw new ProductionError("اختر من بند إلى 100 بند للاستلام.", "Choose 1 to 100 receipt lines.", 400);
      const items = input.items.map(item => {
        if ("packing" in item || "packaging" in item || "unit" in item || "unit_quantity" in item)
          throw new ProductionError("سند الاستلام بالكيلو فقط ولا يقبل بيانات الوحدات أو التعبئة.", "Receipts accept kilograms only, without unit or packing data.", 400);
        try {
          if (typeof item.quantity_kg !== "string") throw new ReceiptQuantityError();
          return {...item, quantity_kg: normalizeReceiptQuantity(item.quantity_kg)};
        } catch (error) {
          if (error instanceof ReceiptQuantityError) throw new ProductionError(error.message_ar, error.message_en, 400);
          throw error;
        }
      });
      const orders = await lockOrders(tx, input.items.map(i => i.production_order_id), false);
      if (orders.some(o => ["cancelled", "archived", "delivered"].includes(o.order_status)))
        throw new ProductionError("لا يمكن الاستلام لطلب ملغي أو مؤرشف أو مسلّم", "Cannot receive for a cancelled, archived or delivered order.");
      // New receipts always move from the production hall to the one finished
      // hall. Keep old location_id payloads compatible, but never let them
      // select a different destination. Committed legacy replays remain exact.
      for (const order of orders) {
        await execution(tx, order.id);
        const total = await available(tx, order.id);
        const requested = items.filter(i => i.production_order_id === order.id).reduce((sum, i) => sum + kgHundredths(i.quantity_kg), 0n);
        if (requested > kgHundredths(total.ready) - kgHundredths(total.received))
          throw new ProductionError("كمية الاستلام تتجاوز الجاهز المتبقي؛ أعد تحميل الصالة", "Receipt quantity exceeds the remaining ready weight. Reload the hall.");
      }
      for (const item of items) {
        if (kgHundredths(item.quantity_kg) <= 0n) throw new ProductionError("كمية الاستلام يجب أن تكون موجبة", "Receipt weight must be positive.", 400);
      }
      // Provision the fixed destination inside the receipt transaction, never
      // in a read endpoint or startup DDL. The lock also covers an empty table
      // and concurrent receipts for different orders. Do not consolidate or
      // rename historical locations/balances.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["factory-finished-hall"]);
      let [destination] = await rows<{id:number;is_active:boolean}>(tx,
        `SELECT id,is_active FROM factory_locations
         WHERE lower(trim(name))=lower($1) OR trim(name_ar)=$2 ORDER BY id LIMIT 1 FOR UPDATE`,
        ["Finished-goods hall", "صالة المواد التامة"]);
      if (!destination) destination = await one(tx,
        "INSERT INTO factory_locations(name,name_ar) VALUES($1,$2) RETURNING id,is_active",
        ["Finished-goods hall", "صالة المواد التامة"]);
      else if (!destination.is_active)
        await tx.query("UPDATE factory_locations SET is_active=true WHERE id=$1", [destination.id]);
      // Sequence value and voucher are server-generated; gaps after rollback are normal.
      const { id } = await one<{ id: number }>(tx, "SELECT nextval(pg_get_serial_sequence('factory_receipts','id'))::int id");
      // The hall advisory lock serializes new receipts. Historical prefixes are
      // preserved; the FP-Rec series starts independently and cannot collide.
      const { receipt_sequence } = await one<{ receipt_sequence: string }>(tx,
        `SELECT (COALESCE(MAX(substring(voucher_number FROM '^FP-Rec([0-9]+)$')::bigint),0)+1)::text receipt_sequence
         FROM factory_receipts WHERE voucher_number ~ '^FP-Rec[0-9]+$'`);
      const receipt = await one<{ id: number; voucher_number: string }>(tx,
        "INSERT INTO factory_receipts(id,voucher_number,created_by,notes) VALUES($1,$2,$3,$4) RETURNING *",
        [id, `FP-Rec${receipt_sequence.padStart(4, "0")}`, actor.id, input.notes ?? null]);
      for (const [index, item] of items.entries()) {
        const exec = await execution(tx, item.production_order_id);
        const weight = kgString(kgHundredths(item.quantity_kg));
        const saved = await one<{ id: number }>(tx, `INSERT INTO factory_receipt_items
          (receipt_id,production_order_id,customer_product_id,item_id,location_id,quantity_kg,line_number)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, item.production_order_id, exec.customer_product_id, exec.item_id, destination.id, weight, index+1]);
        await tx.query(`INSERT INTO factory_inventory(production_order_id,customer_product_id,item_id,location_id,quantity_kg)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(customer_product_id,production_order_id,location_id) DO UPDATE
          SET quantity_kg=factory_inventory.quantity_kg+excluded.quantity_kg RETURNING id`,
        [item.production_order_id, exec.customer_product_id, exec.item_id, destination.id, weight]);
        await tx.query("INSERT INTO factory_movements(receipt_id,receipt_item_id,quantity_kg) VALUES($1,$2,$3)", [id, saved.id, weight]);
      }
      // Return exactly the persisted read projection, including the actual actor
      // and the execution's frozen customer/product identity.
      return one(tx, `${receiptSelect} WHERE r.id=$1`, [receipt.id]);
    });
  }
  location(actor: ProductionUser, input: { request_id: string; name: string; name_ar: string; is_active?: boolean }, id?: number) {
    permission(actor, "manage_finished_warehouse");
    return mutate(this.pool, actor, `location:${id ?? "new"}`, input, async tx => {
      if (id) {
        const current = await one<{name:string;name_ar:string}>(tx,
          "SELECT name,name_ar FROM factory_locations WHERE id=$1 FOR UPDATE", [id]);
        if (current.name.trim().toLowerCase()==="finished-goods hall" || current.name_ar.trim()==="صالة المواد التامة")
          throw new ProductionError("صالة المواد التامة موقع ثابت لا يمكن تغييره أو تعطيله.", "The finished-goods hall is a fixed site and cannot be renamed or disabled.", 400);
      }
      return id
      ? one(tx, "UPDATE factory_locations SET name=$2,name_ar=$3,is_active=$4 WHERE id=$1 RETURNING *", [id, input.name, input.name_ar, input.is_active ?? true])
      : one(tx, "INSERT INTO factory_locations(name,name_ar,is_active) VALUES($1,$2,$3) RETURNING *", [input.name, input.name_ar, input.is_active ?? true]);
    });
  }
}