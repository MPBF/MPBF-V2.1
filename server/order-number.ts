import { sql, type SQL } from "drizzle-orm";

/** Reserve five characters for the minimum production suffix (-JO01). */
const MAX_ORDER_NUMBER_LENGTH = 45;

// Only reservations from this numbering generation advance the new series.
export const ORDER_NUMBER_MAX_SQL = `
  SELECT MAX(sequence)::text AS max_number FROM order_number_allocations
`;

export function nextOrderNumber(lastNumericOrderNumber: string | null): string {
  if (lastNumericOrderNumber !== null && !/^\d+$/.test(lastNumericOrderNumber)) {
    throw new Error("آخر رقم طلب رقمي غير صالح");
  }
  const number = `O${(BigInt(lastNumericOrderNumber ?? "0") + 1n).toString().padStart(4, "0")}`;
  if (number.length > MAX_ORDER_NUMBER_LENGTH) {
    throw new Error("تعذر إنشاء رقم طلب جديد: بلغ التسلسل الحد الأقصى");
  }
  return number;
}

type NumberTransaction = { execute(query: SQL): Promise<{ rows: Record<string, any>[] }> };

/** Read-only preview; the authoritative number is allocated at save time. */
export async function previewOrderNumber(tx: NumberTransaction) {
  const result = await tx.execute(sql.raw(ORDER_NUMBER_MAX_SQL));
  let number = nextOrderNumber(result.rows[0]?.max_number ?? null);
  while ((await tx.execute(sql`SELECT EXISTS(
    SELECT 1 FROM orders WHERE order_number=${number}
  ) AS used`)).rows[0]?.used) {
    number = nextOrderNumber(number.slice(1));
  }
  return number;
}

/** Reserve and insert the order in the SAME transaction. Never reuse deleted numbers. */
export async function allocateOrderNumber(tx: NumberTransaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${1})`);
  const number = await previewOrderNumber(tx);
  await tx.execute(sql`INSERT INTO order_number_allocations(sequence,order_number)
    VALUES(${number.slice(1)}::numeric,${number})`);
  return number;
}

export function productionRollNumber(productionNumber: string, sequence: number, compact: boolean) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("تسلسل الرول غير صالح");
  const number = `${productionNumber}-R${String(sequence).padStart(compact ? 2 : 3, "0")}`;
  if (number.length > 100) throw new Error("تعذر إنشاء رقم رول: بلغ التسلسل الحد الأقصى");
  return number;
}

const productionPrefix = (orderNumber: string) =>
  `${orderNumber}-${/^O[0-9]+$/.test(orderNumber) ? "JO" : ""}`;

export function productionOrderNumber(orderNumber: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("تسلسل أمر الإنتاج غير صالح");
  const number = `${productionPrefix(orderNumber)}${String(sequence).padStart(2, "0")}`;
  if (number.length > 50) throw new Error("تعذر إنشاء رقم أمر إنتاج: بلغ التسلسل الحد الأقصى");
  return number;
}

export function productionOrderSequence(orderNumber: string, number: string): number {
  const prefix = productionPrefix(orderNumber);
  if (!number.startsWith(prefix)) return 0;
  const suffix = number.slice(prefix.length);
  if (!/^[0-9]+$/.test(suffix)) return 0;
  const sequence = Number(suffix);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
}