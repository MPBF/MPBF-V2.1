import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { orders } from "../shared/schema";
import type { OrderActionItem } from "../shared/order-workspace";
import { deleteOrderProduction, lockOrderProductionDeletion } from "./order-production-delete";

function deletionError(message: string, message_en: string, status: number) {
  return Object.assign(new Error(message), { message_en, status });
}

export async function deleteOrdersAtomically(items: OrderActionItem[], source: Pick<typeof db, "transaction"> = db) {
  const ids = items.map((item) => item.id).sort((a, b) => a - b);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length
    || ids.some((id) => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
    throw deletionError("حدد من طلب واحد إلى 100 طلب دون تكرار.", "Select 1–100 distinct orders.", 400);
  }
  return source.transaction(async (tx) => {
    // Match single-order deletion's lock order; lock all parents deterministically.
    await lockOrderProductionDeletion(tx);
    const records = await tx.select({ id: orders.id, status: orders.status }).from(orders)
      .where(inArray(orders.id, ids)).orderBy(asc(orders.id)).for("update");
    if (records.length !== ids.length) {
      throw deletionError("أحد الطلبات غير موجود؛ لم يُحذف أي طلب.", "An order was not found; no orders were deleted.", 404);
    }
    const expected = new Map(items.map((item) => [item.id, item.expected_status]));
    if (records.some((record) => record.status !== expected.get(record.id))) {
      throw deletionError("تغيرت حالة أحد الطلبات؛ لم يُحذف أي طلب. حدّث القائمة ثم أعد المحاولة.",
        "An order's status changed; no orders were deleted. Refresh the list and try again.", 409);
    }
    for (const id of ids) {
      await deleteOrderProduction(tx, id);
      await tx.delete(orders).where(eq(orders.id, id));
    }
    return { success: true, ids };
  });
}
