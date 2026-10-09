import { pool } from "./db";
import type { Connection, ConnectionPool } from "./production/core";
import { canReleaseOrderToProduction, type OrderProductionReleaseStatus } from "../shared/order-production-release";

function releaseError(message: string, status = 409) {
  return Object.assign(new Error(message), { status });
}

export async function releaseOrderToProduction(
  id: number, expectedStatus: OrderProductionReleaseStatus, connectionPool: ConnectionPool = pool,
) {
  const client = await connectionPool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [order] } = await client.query("SELECT id,status,previous_status FROM orders WHERE id=$1 FOR UPDATE", [id]);
    if (!order) throw releaseError("الطلب غير موجود", 404);
    if (!await validateOrderRelease(client, order, expectedStatus)) {
      await client.query("COMMIT");
      return { order };
    }
    const { rows: [updated] } = await client.query(
      "UPDATE orders SET previous_status=status,status='for_production' WHERE id=$1 RETURNING id,status,previous_status", [id],
    );
    await client.query("COMMIT");
    return { order: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Caller must already hold the parent row lock; returns false for a safe retry. */
export async function validateOrderRelease(
  client: Connection, order: { id: number; status: string }, expectedStatus: string,
): Promise<boolean> {
  if (order.status === "for_production" || order.status === "in_production") return false;
  if (!canReleaseOrderToProduction(order.status)) throw releaseError("لا يمكن تحويل طلب ملغي أو مكتمل أو مسلّم أو مؤرشف إلى الإنتاج.");
  if (order.status !== expectedStatus) throw releaseError("تغيرت حالة الطلب؛ حدّث البيانات قبل تحويله إلى الإنتاج.");
  const { rows: lines } = await client.query(
    `SELECT p.id,p.status,e.production_order_id execution_id
     FROM production_orders p LEFT JOIN factory_execution e ON e.production_order_id=p.id
     WHERE p.order_id=$1 ORDER BY p.id FOR UPDATE OF p`, [order.id],
  );
  if (!lines.some(line => line.status === "pending" || (line.status === "active" && line.execution_id != null))) {
    throw releaseError("لا يحتوي الطلب على أوامر إنتاج قابلة للتنفيذ.");
  }
  return true;
}