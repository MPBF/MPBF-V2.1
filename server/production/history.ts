import { isPlasticRoll, type ProductionHistoryFilter, type ProductionHistoryKind, type ProductionHistoryPage, type ProductionOrderRecord } from "../../shared/production";
import { rows, type Connection } from "./core";
import { inventorySelect, movementSelect, orderSelect, receiptSelect, rollSelect } from "./read-queries";

export async function historyPage<K extends ProductionHistoryKind>(tx: Connection, kind: K, filter: ProductionHistoryFilter): Promise<ProductionHistoryPage<K>> {
  const params: unknown[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const alias = { orders: "p", rolls: "r", receipts: "r", movements: "m", inventory: "inv" }[kind];
  const where: string[] = [];
  if (filter.before) where.push(`${alias}.id<${bind(filter.before)}`);
  const search = filter.search ? bind(`%${filter.search.replace(/[\\%_]/g, "\\$&")}%`) : null;
  const orderSearch = search ? `(p.production_order_number ILIKE ${search} OR o.order_number ILIKE ${search}
    OR p.batch_number ILIKE ${search} OR p.customer_product_id::text ILIKE ${search}
    OR COALESCE(e.product->>'name',i.name) ILIKE ${search} OR COALESCE(e.product->>'name_ar',i.name_ar) ILIKE ${search}
    OR COALESCE(e.product->>'customer_name',c.name) ILIKE ${search}
    OR COALESCE(e.product->>'customer_name_ar',c.name_ar) ILIKE ${search})` : "";
  let source: string;
  let select: string;
  let timestamp: string;
  if (kind === "orders") {
    source = `production_orders p JOIN orders o ON o.id=p.order_id
      LEFT JOIN factory_execution e ON e.production_order_id=p.id
      LEFT JOIN customer_products cp ON cp.id=p.customer_product_id
      LEFT JOIN items i ON i.id=cp.item_id LEFT JOIN customers c ON c.id=o.customer_id`;
    select = orderSelect;
    timestamp = "e.started_at";
    if (search) where.push(orderSearch);
    if (filter.status) where.push(`p.status=${bind(filter.status)}`);
    if (filter.order_id) where.push(`p.id=${bind(filter.order_id)}`);
  } else if (kind === "rolls") {
    source = `factory_rolls r JOIN production_orders p ON p.id=r.production_order_id
      JOIN orders o ON o.id=p.order_id JOIN factory_execution e ON e.production_order_id=p.id
      LEFT JOIN customer_products cp ON cp.id=p.customer_product_id
      LEFT JOIN items i ON i.id=cp.item_id LEFT JOIN customers c ON c.id=o.customer_id`;
    select = `${rollSelect} JOIN selected s ON s.id=r.id ORDER BY r.id DESC`;
    timestamp = "r.created_at";
    if (search) where.push(`(r.roll_number ILIKE ${search} OR ${orderSearch})`);
    if (filter.status) where.push(`r.stage=${bind(filter.status)}`);
    if (filter.order_id) where.push(`p.id=${bind(filter.order_id)}`);
  } else if (kind === "receipts") {
    source = "factory_receipts r";
    select = `${receiptSelect} JOIN selected s ON s.id=r.id ORDER BY r.id DESC`;
    timestamp = "r.created_at";
    // Filter vouchers by matching lines, but return ALL their lines.
    if (search) where.push(`(r.voucher_number ILIKE ${search} OR r.notes ILIKE ${search}
      OR EXISTS(SELECT 1 FROM factory_receipt_items ri JOIN production_orders p ON p.id=ri.production_order_id
        JOIN factory_execution e ON e.production_order_id=p.id JOIN orders o ON o.id=p.order_id
        WHERE ri.receipt_id=r.id AND (p.production_order_number ILIKE ${search}
          OR o.order_number ILIKE ${search} OR p.batch_number ILIKE ${search}
          OR e.product->>'name' ILIKE ${search} OR e.product->>'name_ar' ILIKE ${search}
          OR e.product->>'customer_name' ILIKE ${search} OR e.product->>'customer_name_ar' ILIKE ${search}
          OR ri.item_id ILIKE ${search} OR ri.customer_product_id::text ILIKE ${search})))`);
    const lineFilters: string[] = [];
    if (filter.order_id) lineFilters.push(`ri.production_order_id=${bind(filter.order_id)}`);
    if (filter.location_id) lineFilters.push(`ri.location_id=${bind(filter.location_id)}`);
    if (lineFilters.length) where.push(`EXISTS(SELECT 1 FROM factory_receipt_items ri WHERE ri.receipt_id=r.id AND ${lineFilters.join(" AND ")})`);
  } else if (kind === "movements") {
    source = `factory_movements m JOIN factory_receipts r ON r.id=m.receipt_id
      JOIN factory_receipt_items ri ON ri.id=m.receipt_item_id JOIN production_orders p ON p.id=ri.production_order_id
      JOIN factory_execution e ON e.production_order_id=p.id JOIN orders o ON o.id=p.order_id`;
    select = `${movementSelect} JOIN selected s ON s.id=m.id ORDER BY m.id DESC`;
    timestamp = "m.created_at";
    if (search) where.push(`(r.voucher_number ILIKE ${search} OR p.production_order_number ILIKE ${search}
      OR o.order_number ILIKE ${search} OR p.batch_number ILIKE ${search} OR ri.item_id ILIKE ${search}
      OR e.product->>'name' ILIKE ${search} OR e.product->>'name_ar' ILIKE ${search}
      OR e.product->>'customer_name' ILIKE ${search} OR e.product->>'customer_name_ar' ILIKE ${search})`);
    if (filter.order_id) where.push(`ri.production_order_id=${bind(filter.order_id)}`);
    if (filter.location_id) where.push(`ri.location_id=${bind(filter.location_id)}`);
  } else {
    source = `factory_inventory inv JOIN production_orders p ON p.id=inv.production_order_id
      JOIN factory_execution e ON e.production_order_id=p.id JOIN factory_locations l ON l.id=inv.location_id`;
    select = `${inventorySelect} JOIN selected s ON s.id=inv.id ORDER BY inv.id DESC`;
    timestamp = "e.started_at";
    if (search) where.push(`(p.production_order_number ILIKE ${search} OR p.batch_number ILIKE ${search}
      OR e.product->>'name' ILIKE ${search} OR e.product->>'name_ar' ILIKE ${search}
      OR e.product->>'customer_name' ILIKE ${search} OR e.product->>'customer_name_ar' ILIKE ${search}
      OR inv.item_id ILIKE ${search} OR l.name ILIKE ${search} OR l.name_ar ILIKE ${search})`);
    if (filter.order_id) where.push(`inv.production_order_id=${bind(filter.order_id)}`);
    if (filter.location_id) where.push(`inv.location_id=${bind(filter.location_id)}`);
  }
  if (filter.from) where.push(`${timestamp}>=(${bind(filter.from)}::date::timestamp AT TIME ZONE 'Asia/Riyadh')`);
  if (filter.to) where.push(`${timestamp}<((${bind(filter.to)}::date+1)::timestamp AT TIME ZONE 'Asia/Riyadh')`);
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  const records = await rows<any>(tx, `WITH selected AS MATERIALIZED (
    SELECT ${alias}.id FROM ${source} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${alias}.id DESC LIMIT ${bind(limit + 1)}
  ) ${select}`, params);
  const more = records.length > limit;
  if (more) records.pop();
  if (kind === "orders") (records as ProductionOrderRecord[]).forEach(order => {
    if (!order.started_at) order.is_roll_product = isPlasticRoll(order.product?.name ?? null, order.product?.name_ar ?? null);
  });
  return { records, next: more ? records.at(-1)!.id : null };
}