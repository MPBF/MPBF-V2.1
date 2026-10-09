import { sql } from "drizzle-orm";

/**
 * Sequences are declared in the managed schema and created/initialized by the
 * additive development migration. The per-form
 * advisory locks serialize this allocation with each insert; the observed
 * maximum is also used to safely move a sequence forward after a legacy import.
 */
export const ADMIN_ID_SEQUENCES = {
  sections: "admin_section_id_seq",
  categories: "admin_category_id_seq",
  items: "admin_item_id_seq",
  masterBatchColors: "admin_master_batch_color_id_seq",
  machines: "admin_machine_id_seq",
} as const;

export type AdminIdSequence = keyof typeof ADMIN_ID_SEQUENCES;

export async function nextAdminIdNumber(tx: any, sequenceKey: AdminIdSequence, observedMaximum: string | null) {
  const sequenceName = ADMIN_ID_SEQUENCES[sequenceKey];
  const sequence = sql.raw(`'public.${sequenceName}'::regclass`);
  let result = await tx.execute(sql`SELECT nextval(${sequence})::text AS value`);
  let value = BigInt(result.rows[0]?.value ?? "0");
  const maximum = BigInt(observedMaximum ?? "0");
  if (value <= maximum) {
    await tx.execute(sql`SELECT setval(${sequence}, ${maximum.toString()}::bigint, true)`);
    result = await tx.execute(sql`SELECT nextval(${sequence})::text AS value`);
    value = BigInt(result.rows[0]?.value ?? "0");
  }
  if (value <= maximum) throw new Error(`تعذر تخصيص رقم جديد من التسلسل ${sequenceName}`);
  return value.toString();
}