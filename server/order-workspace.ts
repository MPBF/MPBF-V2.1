import { pool } from "./db";
import type { Connection, ConnectionPool } from "./production/core";
import { validateOrderRelease } from "./order-production-release";
import { canApplyOrderAction, ORDER_DISPLAY_FOLDERS, ORDER_WORKSPACE_ACTIONS,
  type OrderActionItem, type OrderDisplayFolder, type OrderFolderItem, type OrderWorkspaceAction } from "../shared/order-workspace";

class WorkspaceError extends Error {
  constructor(message: string, public message_en: string, public status = 409) { super(message); }
}
type LockedOrder = { id: number; status: string; previous_status: string | null };
function idsFor(items: { id: number }[]) {
  const ids = items.map(item => item.id);
  if (!ids.length || ids.length > 100 || ids.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)
    || new Set(ids).size !== ids.length) {
    throw new WorkspaceError("حدد من طلب واحد إلى 100 طلب دون تكرار.", "Select 1–100 distinct orders.", 400);
  }
  return ids.sort((a, b) => a - b);
}
async function transaction<T>(source: ConnectionPool, action: (client: Connection) => Promise<T>): Promise<T> {
  const client = await source.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function lockOrders(client: Connection, ids: number[]): Promise<LockedOrder[]> {
  const { rows } = await client.query("SELECT id,status,previous_status FROM orders WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
  if (rows.length !== ids.length) throw new WorkspaceError("أحد الطلبات غير موجود؛ لم يُنفذ الإجراء.", "An order was not found; no changes were made.", 404);
  return rows;
}

export async function applyOrderActions(action: OrderWorkspaceAction, items: OrderActionItem[], source: ConnectionPool = pool) {
  if (!ORDER_WORKSPACE_ACTIONS.includes(action)) throw new WorkspaceError("إجراء غير صالح.", "Invalid action.", 400);
  const ids = idsFor(items);
  const expected = new Map(items.map(item => [item.id, item.expected_status]));
  return transaction(source, async client => {
    const records = await lockOrders(client, ids);
    const changed: LockedOrder[] = [];
    const target = action === "release" ? "for_production" : action === "pause" ? "paused" : "cancelled";
    // Validate every selected row before any mutation. Other clients see only the complete commit.
    for (const order of records) {
      try {
        if (action === "release") {
          if (await validateOrderRelease(client, order, expected.get(order.id)!)) changed.push(order);
        } else if (order.status !== target) {
          if (order.status !== expected.get(order.id) || !canApplyOrderAction(order.status, action)) {
            throw new WorkspaceError("الطلب لا يقبل الإجراء.", "The order is ineligible.");
          }
          changed.push(order);
        }
      } catch (error) {
        if (!(error instanceof WorkspaceError) && !(error instanceof Error && (error as Error & { status?: number }).status === 409)) throw error;
        throw new WorkspaceError(`الطلب ${order.id} تغيرت حالته أو لا يقبل الإجراء؛ لم تتغير أي طلبات.`,
          `Order ${order.id} changed or is ineligible; no orders were changed.`);
      }
    }
    if (changed.length) {
      await client.query("UPDATE orders SET previous_status=status,status=$2 WHERE id=ANY($1::int[])", [changed.map(order => order.id), target]);
    }
    const changedIds = new Set(changed.map(order => order.id));
    return { orders: records.map(order => changedIds.has(order.id)
      ? { ...order, previous_status: order.status, status: target } : order) };
  });
}

export async function moveOrderFolders(folder: OrderDisplayFolder, items: OrderFolderItem[], actorId: number, source: ConnectionPool = pool) {
  if (!ORDER_DISPLAY_FOLDERS.includes(folder) || !Number.isInteger(actorId) || actorId <= 0) {
    throw new WorkspaceError("بيانات النقل غير صالحة.", "Invalid folder move.", 400);
  }
  const ids = idsFor(items);
  return transaction(source, async client => {
    await lockOrders(client, ids);
    const { rows } = await client.query("SELECT order_id,folder FROM order_display_folder_assignments WHERE order_id=ANY($1::int[])", [ids]);
    const folders = new Map<number, OrderDisplayFolder>(rows.map(row => [row.order_id, row.folder]));
    const changed = items.filter(item => {
      const current = folders.get(item.id) ?? "new";
      if (current === folder) return false;
      if (current !== item.expected_folder) throw new WorkspaceError("نُقل أحد الطلبات بواسطة مستخدم آخر؛ لم يُنقل أي طلب.",
        "Another user moved an order; no orders were moved.");
      return true;
    });
    if (changed.length) await client.query(
      `INSERT INTO order_display_folder_assignments(order_id,folder,updated_by,updated_at)
       SELECT id,$2,$3,now() FROM unnest($1::int[]) AS ids(id)
       ON CONFLICT(order_id) DO UPDATE SET folder=EXCLUDED.folder,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
      [changed.map(item => item.id), folder, actorId],
    );
    return { moved: changed.length, folder };
  });
}

export async function orderFolderCounts(source: ConnectionPool = pool) {
  const client = await source.connect();
  try {
    const { rows } = await client.query(`SELECT COALESCE(f.folder,'new') folder,count(*)::int count
      FROM orders o LEFT JOIN order_display_folder_assignments f ON f.order_id=o.id GROUP BY COALESCE(f.folder,'new')`);
    const counts = Object.fromEntries(ORDER_DISPLAY_FOLDERS.map(folder => [folder, 0])) as Record<OrderDisplayFolder, number>;
    for (const row of rows) counts[row.folder as OrderDisplayFolder] = row.count;
    return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  } finally { client.release(); }
}