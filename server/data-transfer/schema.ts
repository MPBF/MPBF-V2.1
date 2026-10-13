import { createHash } from "node:crypto";
import type { TransferRow, TransferSchema, TransferTable } from "../../shared/data-transfer";
import { identifier, labels, policies, protectedColumn, eligibleTable, productDerived, privateSettingKey, MAX_BYTES, MAX_ROWS, MAX_EXPORT_ROWS, RETENTION_DAYS, fail } from "./policy";

export interface Queryable { query(text: string, values?: any[]): Promise<{ rows: any[] }> }
export interface TransferConnection extends Queryable { release(): void }
export interface TransferPool extends Queryable { connect(): Promise<TransferConnection> }
export const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
export function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function discover(q: Queryable, namespace = "public"): Promise<TransferSchema> {
  const { rows: columns } = await q.query(`
    SELECT c.table_name,c.column_name,c.data_type,c.udt_name,c.is_nullable,c.column_default,
      c.is_generated,c.is_identity,c.character_maximum_length,c.numeric_precision,c.numeric_scale
    FROM information_schema.columns c JOIN information_schema.tables t
      ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema=$1 AND t.table_type='BASE TABLE'
    ORDER BY c.table_name,c.ordinal_position`, [namespace]);
  const { rows: constraints } = await q.query(`
    SELECT t.relname AS table_name,c.contype,pg_get_constraintdef(c.oid) AS definition,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,o)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.o) AS columns,
      ft.relname AS foreign_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,o)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.o) AS targets
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class ft ON ft.oid=c.confrelid WHERE n.nspname=$1 ORDER BY t.relname,c.conname`, [namespace]);
  const { rows: indices } = await q.query(`
    SELECT t.relname AS table_name,pg_get_indexdef(i.indexrelid) AS definition,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,o)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n
        WHERE k.o<=i.indnkeyatts ORDER BY k.o) AS columns
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
    ORDER BY t.relname,i.indexrelid`, [namespace]);
  const names = [...new Set<string>(columns.map(c => c.table_name))];
  const eligible = new Set(names.filter(eligibleTable));
  const tables: TransferTable[] = names.filter(name => eligible.has(name)).map(name => {
    const policy = policies[name];
    const cols = columns.filter(c => c.table_name === name && (!protectedColumn.test(c.column_name) || (name === "roles" && c.column_name === "permissions")) &&
      !(["factory_receipt_items", "factory_inventory", "factory_movements"].includes(name) && /unit|packing|piece/i.test(c.column_name)))
      .map(c => ({
        name: c.column_name, labelAr: labels[c.column_name] ?? c.column_name,
        labelEn: c.column_name.replaceAll("_", " "), type: c.data_type,
        nullable: c.is_nullable === "YES", default: c.column_default,
        generated: c.is_generated !== "NEVER" || c.is_identity === "YES" || /nextval\(/.test(c.column_default ?? ""),
        identity: c.is_identity === "YES",
        writable: c.is_generated === "NEVER" && !(name === "customer_products" && productDerived.has(c.column_name)),
        maxLength: c.character_maximum_length, precision: c.numeric_precision, scale: c.numeric_scale,
      }));
    const visible = new Set(cols.map(c => c.name));
    return {
      name, labelAr: policy?.ar ?? name, labelEn: policy?.en ?? name, group: policy?.group ?? "discovered",
      approved: true, exportable: true, importable: cols.some(c => c.writable),
      reasonAr: "إضافة ومعاينة وتحديث بموافقة؛ لا حذف. الحقول المحسوبة والأسرار محمية.",
      reasonEn: "Add and explicitly approve updates after preview; no deletion. Derived values and secrets are protected.",
      columns: cols,
      keys: indices.filter(i => i.table_name === name && i.columns.length && i.columns.every((c: string) => visible.has(c)))
        .map(i => i.columns),
      relations: [
        ...constraints.filter(c => c.table_name === name && c.contype === "f" &&
          eligible.has(c.foreign_table) && c.columns.every((x: string) => visible.has(x)))
          .map(c => ({ columns: c.columns, table: c.foreign_table, targets: c.targets })),
        ...(policy?.logical ?? []).map(r => ({ columns: [r.column], table: r.table, targets: [r.target] })),
      ],
    };
  });
  const ready = ["data_transfer_previews", "data_transfer_operations", "data_transfer_backups", "data_transfer_templates"]
    .every(n => names.includes(n));
  return { version: hash({ columns, constraints, indices, policies, transferPolicy: "business-users-v2" }), tables, ready,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    limits: { bytes: MAX_BYTES, rows: MAX_ROWS, retentionDays: RETENTION_DAYS } };
}
export function approved(schema: TransferSchema, name: string, write = false) {
  const table = schema.tables.find(t => t.name === name);
  if (!table?.exportable || (write && !table.importable)) fail("Table is not approved for this operation", 403);
  return table;
}
export async function readRows(q: Queryable, table: TransferTable, namespace: string): Promise<TransferRow[]> {
  const columns = table.columns.map(c => `${identifier(c.name)}::text AS ${identifier(c.name)}`).join(",");
  if (!columns) return [];
  const settingKey = table.columns.find(c => ["key", "setting_key", "config_key"].includes(c.name));
  const filtered = !!settingKey && table.columns.some(c => c.name === "value");
  const { rows } = await q.query(`SELECT ${columns} FROM ${identifier(namespace)}.${identifier(table.name)}
    ${filtered ? `WHERE COALESCE(${identifier(settingKey!.name)}::text,'') !~* $1` : ""}
    ORDER BY ${table.keys[0]?.map(identifier).join(",") || `row_to_json(${identifier(table.name)})::text`}
    LIMIT ${MAX_EXPORT_ROWS + 1}`, filtered ? [privateSettingKey.source] : undefined);
  if (rows.length > MAX_EXPORT_ROWS) fail("Table exceeds safe transfer row limit", 413);
  for (const row of rows) for (const column of table.columns.filter(c => ["json","jsonb"].includes(c.type))) {
    // Do not parse arbitrary JSON through JS Number (precision loss). A package
    // containing nested security keys is rejected rather than leaked/redacted.
    if (row[column.name] && /"(?:[^"]*(?:password|secret|token|session|credential|permission|api.?key|private.?key)[^"]*)"\s*:/i.test(row[column.name]))
      fail("Nested security data is excluded from general transfer", 403);
  }
  return rows;
}
export type Snapshot = Record<string, TransferRow[]>;
export async function snapshot(q: Queryable, schema: TransferSchema, namespace: string): Promise<Snapshot> {
  const out: Snapshot = {};
  let count = 0, bytes = 0;
  // A conservative whole business graph guard detects both incoming and outgoing
  // relationships, including logical links lacking database constraints.
  for (const table of schema.tables.filter(t => t.exportable)) {
    out[table.name] = await readRows(q, table, namespace);
    count += out[table.name].length; bytes += Buffer.byteLength(stable(out[table.name]));
    if (count > MAX_EXPORT_ROWS || bytes > 30 * 1024 * 1024) fail("Related snapshot exceeds safe transfer limits", 413);
  }
  return out;
}
