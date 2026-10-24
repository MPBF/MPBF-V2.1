import type { CustomerHistoryOrder, CustomerOrderHistoryPage } from "../shared/customer-order-history";
import type { ConnectionPool } from "./production/core";

// Select customer orders before aggregating their production. One page never
// splits an order's production lines. Use completed roll output, not film input,
// planned overrun, warehouse balances, or a sum of intermediate stages.
export const customerOrderHistorySql = `
  WITH selected AS MATERIALIZED (
    SELECT id, order_number, created_at FROM orders
    WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3
  ), history AS (
    SELECT o.id, o.order_number, o.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'production_order_number', p.production_order_number,
          'requested_kg', p.quantity_kg::text,
          'produced_kg', COALESCE(output.quantity, 0)::text
        ) ORDER BY p.id)
        FROM production_orders p
        LEFT JOIN factory_execution e ON e.production_order_id = p.id
        LEFT JOIN LATERAL (
          SELECT sum(CASE WHEN e.is_roll_product
            THEN r.weight_kg ELSE r.net_weight_kg END) quantity
          FROM factory_rolls r
          WHERE r.production_order_id = p.id AND r.stage = 'done'
        ) output ON true
        WHERE p.order_id = o.id
      ), '[]'::jsonb) production_orders
    FROM selected o
  )
  SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1) customer_exists,
    COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC, h.id DESC)
      FROM history h), '[]'::jsonb) orders`;

export async function customerOrderHistory(
  source: ConnectionPool,
  customerId: string,
  limit: number,
  offset: number,
): Promise<CustomerOrderHistoryPage> {
  const client = await source.connect();
  try {
    const result = await client.query(
      customerOrderHistorySql, [customerId, limit + 1, offset],
    );
    const row = result.rows[0] as { customer_exists: boolean; orders: CustomerHistoryOrder[] } | undefined;
    if (!row?.customer_exists) {
      throw Object.assign(new Error("العميل غير موجود"), {
        status: 404, message_en: "The customer was not found.",
      });
    }
    const hasMore = row.orders.length > limit;
    return {
      orders: row.orders.slice(0, limit),
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    };
  } finally {
    client.release();
  }
}
