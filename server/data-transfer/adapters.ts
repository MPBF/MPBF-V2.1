import type { TransferPreviewRow, TransferRow, TransferSchema } from "../../shared/data-transfer";
import { deriveCustomerProductFields } from "../../shared/customer-product-fields";
import { fail, identifier } from "./policy";
import type { Queryable, Snapshot } from "./schema";

function adminRole(row: TransferRow | undefined, graph: Snapshot) {
  if (!row) return false;
  const role = graph.roles?.find(r => r.id === row.role_id);
  try { return (JSON.parse(role?.permissions ?? "null") as unknown[] | null)?.includes("admin") === true; }
  catch { return false; }
}
function admin(row: TransferRow | undefined, graph: Snapshot) {
  return !!row && (row.status === undefined ? "active" : row.status) === "active" && adminRole(row, graph);
}
export function guardAdministrator(actor: number, rows: TransferPreviewRow[], graph: Snapshot) {
  if (!rows.some(r => ["users", "roles"].includes(r.table))) return;
  if (!admin(graph.users?.find(r => r.id === String(actor)), graph)) fail("Import cannot remove current administrator access", 409);
}
export function grantsAdministrator(rows: TransferPreviewRow[], before: Snapshot, after: Snapshot) {
  return rows.some(row => {
    if (row.table === "roles") {
      const merged = { ...row.old, ...row.values };
      try {
        const old = JSON.parse(row.old?.permissions ?? "[]");
        return JSON.parse(merged.permissions ?? "[]").includes("admin") && !old.includes("admin");
      } catch { return false; }
    }
    if (row.table === "users") {
      const merged = { ...row.old, ...row.values };
      return adminRole(merged, after) && (!row.old || row.old.role_id !== merged.role_id || (admin(merged, after) && !admin(row.old, before)));
    }
    return false;
  });
}
export function orderedRows(rows: TransferPreviewRow[], schema: TransferSchema, graph: Snapshot) {
  const pending = [...rows], result: TransferPreviewRow[] = [];
  const available: Snapshot = structuredClone(graph);
  while (pending.length) {
    const next = pending.findIndex(row => {
      const value = { ...row.old, ...row.values };
      return schema.tables.find(t => t.name === row.table)!.relations.every(relation => {
        if (relation.columns.some(c => value[c] == null)) return true;
        const matches = (target: TransferRow) => relation.columns.every((c, i) => target[relation.targets[i]] === value[c]);
        return available[relation.table]?.some(matches) || (relation.table === row.table && matches(value));
      });
    });
    if (next < 0) fail("Foreign dependency cycle cannot be imported safely");
    const row = pending.splice(next, 1)[0];
    result.push(row);
    (available[row.table] ??= []).push({ ...row.old, ...row.values });
  }
  return result;
}
export function derivedProductValues(row: TransferPreviewRow, schema: TransferSchema, graph: Snapshot): TransferRow {
  if (row.table !== "customer_products") return {};
  const source = ["width", "left_facing", "right_facing", "thickness", "density", "printing_cylinder",
    "cutting_length_cm", "unit_weight_kg", "unit_quantity", "category_id", "item_id", "punching"];
  if (row.old && !source.some(key => key in row.values)) return {};
  const merged = { ...row.old, ...row.values };
  const category = graph.categories?.find(c => c.id === merged.category_id);
  const derived = deriveCustomerProductFields(merged, category?.name_ar ?? category?.name ?? undefined,
    !!row.old && !("printing_cylinder" in row.values));
  const present = new Set(schema.tables.find(t => t.name === row.table)!.columns.filter(c => !c.generated).map(c => c.name));
  return Object.fromEntries(Object.entries(derived).filter(([key]) => present.has(key))
    .map(([key, value]) => [key, value == null ? null : typeof value === "boolean" ? value ? "t" : "f" : String(value)]));
}
export async function preserveSequences(q: Queryable, schema: TransferSchema, namespace: string, touched: Set<string>) {
  // ALTER SEQUENCE is transactional (setval is not). Preserve existing high-water
  // marks as well as imported explicit IDs, so later app-created rows cannot collide.
  for (const table of schema.tables.filter(t => touched.has(t.name))) {
    for (const column of table.columns.filter(c => c.identity || /nextval\(/.test(c.default ?? ""))) {
      const { rows } = await q.query(`SELECT n.nspname AS ns,c.relname AS name,s.seqincrement::text AS step
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
        WHERE c.oid=pg_get_serial_sequence($1,$2)::regclass`, [`${identifier(namespace)}.${identifier(table.name)}`, column.name]);
      if (!rows.length) continue;
      const seq = rows[0], ref = `${identifier(seq.ns)}.${identifier(seq.name)}`, step = BigInt(seq.step);
      const state = (await q.query(`SELECT last_value::text AS n,is_called FROM ${ref}`)).rows[0];
      const edge = (await q.query(`SELECT ${step > 0n ? "max" : "min"}(${identifier(column.name)})::text AS n FROM ${identifier(namespace)}.${identifier(table.name)}`)).rows[0].n;
      let next = BigInt(state.n) + (state.is_called ? step : 0n);
      if (edge != null) {
        const required = BigInt(edge) + step;
        if (step > 0n ? required > next : required < next) next = required;
      }
      await q.query(`ALTER SEQUENCE ${ref} RESTART WITH ${next.toString()}`);
    }
  }
}
