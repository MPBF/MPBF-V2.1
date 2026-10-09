import { createHash } from "node:crypto";
import { hasProductionPermission, type ProductSnapshot, type ProductionUser } from "../../shared/production";
import { masterBatchJSON } from "./read-queries";

export interface Connection {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
  release(): void;
}
export interface ConnectionPool { connect(): Promise<Connection> }
export type LockedOrder = {
  id: number; order_id: number; production_order_number: string; customer_product_id: number | null;
  quantity_kg: string; final_quantity_kg: string; status: string; batch_number: string | null;
  order_status: string; customer_id: string;
  previous_status: string | null;
  compact_roll_numbering?: boolean;
};
export type Execution = {
  production_order_id: number; customer_product_id: number; item_id: string; product: ProductSnapshot;
  is_printed: boolean; is_roll_product: boolean; film_closed_at: Date | null; completed_at: Date | null;
};
export class ProductionError extends Error {
  constructor(public message: string, public message_en: string, public status = 409) { super(message); }
}
export function permission(user: ProductionUser, ...keys: string[]) {
  if (!hasProductionPermission(user, ...keys)) throw new ProductionError("لا تملك صلاحية تنفيذ هذا الإجراء", "You do not have permission for this action.", 403);
}
export async function rows<T>(tx: Connection, query: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query(query, params)).rows as T[];
}
export async function one<T>(tx: Connection, query: string, params: unknown[] = []): Promise<T> {
  const [row] = await rows<T>(tx, query, params);
  if (!row) throw new ProductionError("السجل غير موجود", "The record was not found.", 404);
  return row;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([key]) => key !== "request_id")
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function mutate<T>(pool: ConnectionPool, actor: ProductionUser, operation: string,
  input: { request_id: string }, action: (tx: Connection) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SET LOCAL lock_timeout = '12s'");
    await tx.query("SET LOCAL statement_timeout = '25s'");
    // A request lock is always acquired before resource locks; no nested transactions.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`factory-request:${actor.id}:${input.request_id}`]);
    const fingerprint = createHash("sha256").update(canonical(input)).digest("hex");
    const [previous] = await rows<{ operation: string; fingerprint: string; result: T }>(tx,
      "SELECT operation, fingerprint, result FROM factory_operations WHERE actor_id=$1 AND request_id=$2", [actor.id, input.request_id]);
    if (previous) {
      if (previous.operation !== operation || previous.fingerprint !== fingerprint)
        throw new ProductionError("مفتاح العملية مستخدم ببيانات مختلفة", "This operation key was already used with different data.");
      await tx.query("COMMIT");
      return previous.result;
    }
    const result = await action(tx);
    await tx.query("INSERT INTO factory_operations(actor_id,request_id,operation,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)",
      [actor.id, input.request_id, operation, fingerprint, JSON.stringify(result)]);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { tx.release(); }
}
export async function lockOrders(tx: Connection, ids: number[], running = true) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const references = await rows<{ id: number; order_id: number }>(tx, "SELECT id,order_id FROM production_orders WHERE id=ANY($1::int[])", [sorted]);
  if (references.length !== sorted.length) throw new ProductionError("أمر الإنتاج غير موجود", "A production order was not found.", 404);
  const parentIds = [...new Set(references.map(p => p.order_id))].sort((a, b) => a - b);
  await tx.query("SELECT id FROM orders WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [parentIds]);
  const records = await rows<LockedOrder>(tx, `SELECT p.*,o.status order_status,o.customer_id,
    EXISTS(SELECT 1 FROM order_number_allocations a WHERE a.order_number=o.order_number) compact_roll_numbering
    FROM production_orders p
    JOIN orders o ON o.id=p.order_id WHERE p.id=ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`, [sorted]);
  if (records.length !== sorted.length || records.some(p => p.order_id !== references.find(r => r.id === p.id)?.order_id))
    throw new ProductionError("تغير الطلب المرتبط؛ أعد تحميل الصفحة", "The parent order changed. Reload the page.");
  if (running && records.some(p => !["for_production", "in_production"].includes(p.order_status) || ["cancelled", "archived", "completed"].includes(p.status)))
    throw new ProductionError("الطلب متوقف أو غير قابل للتنفيذ؛ راجع حالته أولاً", "The order is paused or not executable. Check its status first.");
  return records;
}
export async function execution(tx: Connection, id: number): Promise<Execution> {
  return one<Execution>(tx, "SELECT * FROM factory_execution WHERE production_order_id=$1", [id]);
}
export async function productSnapshot(tx: Connection, order: LockedOrder) {
  const row = await one<{ product: ProductSnapshot; is_printed: boolean; status: string }>(tx, `
    SELECT jsonb_build_object('id',cp.id,'item_id',cp.item_id,'name',i.name,'name_ar',i.name_ar,
      'customer_name',c.name,'customer_name_ar',c.name_ar,'width',cp.width::text,
      'left_facing',cp.left_facing::text,'right_facing',cp.right_facing::text,
      'universal_thickness',cp.universal_thickness::text,'cutting_length_cm',cp.cutting_length_cm,
      'raw_material',cp.raw_material,'printing_cylinder',cp.printing_cylinder,'punching',cp.punching,
      'notes',cp.notes,'plate_drawer_code',c.plate_drawer_code,'front_print_colors',cp.front_print_colors,'back_print_colors',cp.back_print_colors,
      'size_caption',cp.size_caption,'master_batch',${masterBatchJSON}) product,
      COALESCE(cp.is_printed,false) is_printed,cp.status
    FROM customer_products cp JOIN items i ON i.id=cp.item_id JOIN customers c ON c.id=cp.customer_id
    LEFT JOIN master_batch_colors mb ON mb.id=cp.master_batch_id
    WHERE cp.id=$1 AND cp.customer_id=$2 FOR SHARE OF cp,i,c`, [order.customer_product_id, order.customer_id]);
  if (row.status !== "active") throw new ProductionError("منتج العميل غير نشط", "The customer product is inactive.");
  return row;
}
export async function available(tx: Connection, id: number) {
  return one<{ produced: string; ready: string; received: string; count: number }>(tx, `
    SELECT COALESCE(sum(r.weight_kg),0)::text produced,
      COALESCE(sum(CASE WHEN r.stage='done' THEN CASE WHEN e.is_roll_product THEN r.weight_kg ELSE r.net_weight_kg END ELSE 0 END),0)::text ready,
      (SELECT COALESCE(sum(quantity_kg),0)::text FROM factory_receipt_items WHERE production_order_id=$1) received,
      count(r.id)::int count FROM factory_execution e LEFT JOIN factory_rolls r ON r.production_order_id=e.production_order_id
      WHERE e.production_order_id=$1`, [id]);
}