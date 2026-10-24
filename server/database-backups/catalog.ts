import { createHash } from "node:crypto";
import type { Queryable } from "../data-transfer/schema";
import { backupError, MAX_CLEAR_BYTES } from "./crypto";

export const MAX_ROWS = 150_000;
export const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const hash = (value: unknown) => createHash("sha256").update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
export const privateKeyPattern = /password|passwd|secret|token|credential|api.?key|private.?key|connection.?string/i;
const skippedNames = /^(?:sessions?|data_transfer_.*|database_backup_.*|oauth_.*|.*_tokens?|.*credentials.*|.*secrets.*|__drizzle_migrations)$/i;
export type Column = { name: string; type: string; generated: boolean; identity: boolean };
export type Table = { name: string; columns: Column[]; privateKeyColumn: string | null };
type ForeignKey = { table: string; name: string; definition: string; target: string; columns: string[]; targets: string[] };
type Trigger = { table: string; name: string; enabled: string };
type Sequence = { name: string; increment: string; min: string; max: string; table: string | null; column: string | null };
export type Catalog = {
  namespace: string; tables: Table[]; allTables: string[]; excluded: string[];
  constraints: ForeignKey[]; triggers: Trigger[]; sequences: Sequence[];
  definitions: unknown[];
};
export type Snapshot = {
  format: "mpbf-database"; version: 1; createdAt: string; namespace: string;
  schemaHash: string; stateHash: string;
  tables: { name: string; columns: string[]; rows: (string | null)[][] }[];
  sequences: { name: string; next: string }[];
  excludedTables: string[];
};
const tableRef = (namespace: string, name: string) => `${quote(namespace)}.${quote(name)}`;
export { tableRef };

export async function discover(q: Queryable, namespace: string): Promise<Catalog> {
  const { rows: cols } = await q.query(`
    SELECT t.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attgenerated<>'' AS generated,a.attidentity<>'' AS identity,a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND t.relkind IN ('r','p') ORDER BY t.relname,a.attnum`, [namespace]);
  const allTables: string[] = [...new Set<string>(cols.map(c => c.table_name))];
  const excluded: string[] = [];
  const tables: Table[] = [];
  for (const name of allTables) {
    const columns = cols.filter(c => c.table_name === name);
    const sensitive = columns.some(c => privateKeyPattern.test(c.name) &&
      !["share_token", "qr_token", "print_token"].includes(c.name) &&
      !(name === "users" && ["password", "must_change_password", "password_changed_at"].includes(c.name)));
    // Partition parents/children need a dedicated adapter to avoid double rows.
    if (skippedNames.test(name) || sensitive) { excluded.push(name); continue; }
    const kv = columns.some(c => c.name === "key") && columns.some(c => c.name === "value");
    tables.push({ name, columns: columns.map(c => ({ name: c.name, type: c.type,
      generated: c.generated, identity: c.identity })), privateKeyColumn: kv ? "key" : null });
  }
  const { rows: definitions } = await q.query(`
    SELECT t.relname AS table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition,
      p.relname AS target,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(v,o)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.v ORDER BY k.o) AS columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(v,o)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.v ORDER BY k.o) AS targets
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class p ON p.oid=c.confrelid
    WHERE n.nspname=$1 ORDER BY t.relname,c.conname`, [namespace]);
  const { rows: indexes } = await q.query(`
    SELECT t.relname AS table_name,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 ORDER BY t.relname,i.indexrelid::regclass::text`, [namespace]);
  const { rows: triggers } = await q.query(`
    SELECT t.relname AS table, g.tgname AS name,g.tgenabled AS enabled,pg_get_triggerdef(g.oid) AS definition
    FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=$1 AND NOT g.tgisinternal ORDER BY t.relname,g.tgname`, [namespace]);
  const { rows: sequences } = await q.query(`
    SELECT s.relname AS name,p.seqincrement::text AS increment,p.seqmin::text AS min,p.seqmax::text AS max,
      t.relname AS table,a.attname AS column
    FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence p ON p.seqrelid=s.oid
    LEFT JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class t ON t.oid=d.refobjid
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE n.nspname=$1 ORDER BY s.relname`, [namespace]);
  const { rows: partitions } = await q.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND (c.relispartition OR c.relkind='p')`, [namespace]);
  if (partitions.some(p => tables.some(t => t.name === p.relname))) backupError("BACKUP_UNSAFE_SCHEMA", 409);
  const { rows: unsafe } = await q.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND (c.relrowsecurity OR EXISTS(
      SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid))`, [namespace]);
  const { rows: crossSchema } = await q.query(`
    SELECT 1 FROM pg_constraint f
    JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
    JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE f.contype='f' AND cn.nspname<>pn.nspname AND (cn.nspname=$1 OR pn.nspname=$1) LIMIT 1`, [namespace]);
  if (crossSchema.length || unsafe.some(p => tables.some(t => t.name === p.relname))) backupError("BACKUP_UNSAFE_SCHEMA", 409);
  return {
    namespace, tables, allTables, excluded,
    constraints: definitions.filter(d => d.contype === "f").map(d => ({
      table: d.table_name, name: d.conname, definition: d.definition, target: d.target, columns: d.columns, targets: d.targets,
    })),
    triggers, sequences: sequences.filter(s => !s.table || tables.some(t => t.name === s.table)),
    definitions: [cols, definitions, indexes, triggers],
  };
}
export const schemaHash = (catalog: Catalog) => hash(catalog);
export function retainedPredicate(table: Table) {
  return table.privateKeyColumn ? `NOT COALESCE(${quote(table.privateKeyColumn)}::text ~* 'password|passwd|secret|token|credential|api.?key|private.?key|connection.?string',false)` : "TRUE";
}
export async function capture(q: Queryable, catalog: Catalog): Promise<Snapshot> {
  const tables: Snapshot["tables"] = [];
  let total = 0, bytes = 0;
  for (const table of catalog.tables) {
    const columns = table.columns.map(c => c.name);
    const result = await q.query(`SELECT ${columns.map(c => `${quote(c)}::text AS ${quote(c)}`).join(",")}
      FROM ${tableRef(catalog.namespace, table.name)} WHERE ${retainedPredicate(table)} LIMIT $1`, [MAX_ROWS - total + 1]);
    total += result.rows.length;
    if (total > MAX_ROWS) backupError("BACKUP_TOO_LARGE", 413);
    const rows: (string | null)[][] = result.rows.map(row => columns.map(c => row[c]));
    rows.sort((a, b) => { const aa = JSON.stringify(a), bb = JSON.stringify(b); return aa < bb ? -1 : aa > bb ? 1 : 0; });
    bytes += Buffer.byteLength(JSON.stringify(rows));
    if (bytes > MAX_CLEAR_BYTES) backupError("BACKUP_TOO_LARGE", 413);
    tables.push({ name: table.name, columns, rows });
  }
  const sequences: Snapshot["sequences"] = [];
  for (const seq of catalog.sequences) {
    const { rows } = await q.query(`SELECT last_value::text,is_called FROM ${tableRef(catalog.namespace, seq.name)}`);
    const next = BigInt(rows[0].last_value) + (rows[0].is_called ? BigInt(seq.increment) : 0n);
    if (next < BigInt(seq.min) || next > BigInt(seq.max)) backupError("BACKUP_UNSAFE_SCHEMA", 409);
    sequences.push({ name: seq.name, next: next.toString() });
  }
  const fingerprint = schemaHash(catalog);
  return { format: "mpbf-database", version: 1, namespace: catalog.namespace,
    createdAt: new Date().toISOString(), schemaHash: fingerprint,
    stateHash: hash([fingerprint, tables, sequences]), tables, sequences,
    excludedTables: [...catalog.excluded, ...catalog.tables.filter(t => t.privateKeyColumn).map(t => `${t.name}: secret settings omitted`)] };
}

export function validateSnapshot(value: unknown, catalog: Catalog): Snapshot {
  const doc = value as Snapshot;
  if (!doc || doc.format !== "mpbf-database" || doc.version !== 1 || doc.namespace !== catalog.namespace ||
    typeof doc.createdAt !== "string" || !Number.isFinite(Date.parse(doc.createdAt))) backupError("BACKUP_INVALID");
  if (doc.schemaHash !== schemaHash(catalog)) backupError("BACKUP_SCHEMA_CHANGED", 409);
  if (!Array.isArray(doc.tables) || doc.tables.length !== catalog.tables.length ||
    !Array.isArray(doc.sequences) || doc.sequences.length !== catalog.sequences.length) backupError("BACKUP_INVALID");
  let total = 0;
  doc.tables.forEach((table, index) => {
    const expected = catalog.tables[index];
    if (!table || table.name !== expected.name || JSON.stringify(table.columns) !== JSON.stringify(expected.columns.map(c => c.name)) ||
      !Array.isArray(table.rows)) backupError("BACKUP_INVALID");
    total += table.rows.length;
    if (total > MAX_ROWS) backupError("BACKUP_TOO_LARGE", 413);
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== expected.columns.length ||
        row.some(cell => cell !== null && (typeof cell !== "string" || cell.includes("\u0000")))) backupError("BACKUP_INVALID");
      if (expected.privateKeyColumn && privateKeyPattern.test(row[table.columns.indexOf(expected.privateKeyColumn)] ?? "")) backupError("BACKUP_INVALID");
    }
  });
  doc.sequences.forEach((seq, index) => {
    const expected = catalog.sequences[index];
    if (!seq || seq.name !== expected.name || typeof seq.next !== "string" || !/^-?\d{1,20}$/.test(seq.next) ||
      BigInt(seq.next) < BigInt(expected.min) || BigInt(seq.next) > BigInt(expected.max)) backupError("BACKUP_INVALID");
  });
  if (doc.stateHash !== hash([doc.schemaHash, doc.tables, doc.sequences])) backupError("BACKUP_INVALID");
  return doc;
}
