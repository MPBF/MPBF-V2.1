import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import type { TransferApproval, TransferFile, TransferMapping, TransferOperation, TransferPreview, TransferPreviewRow, TransferRow, TransferTemplate } from "../../shared/data-transfer";
import { approved, discover, hash, readRows, snapshot, stable, type Queryable, type Snapshot, type TransferPool } from "./schema";
import { fail, identifier, MAX_ROWS, RETENTION_DAYS, productDerived, protectedColumn } from "./policy";
import { csvExport, csvZipExport, excelExport, makeBundle, parseFile, verifyBundleShape } from "./files";
import { makePreview, project, validateBusiness } from "./validation";
import { derivedProductValues, grantsAdministrator, guardAdministrator, orderedRows, preserveSequences } from "./adapters";

type Document = {
  preview: TransferPreview; graph: Snapshot; guard: string; mappings: TransferMapping[];
  restoredOperation?: string;
};
export class DataTransferService {
  constructor(private pool: TransferPool, private namespace = "public") { identifier(namespace); }
  private table(name: string) { return `${identifier(this.namespace)}.${identifier(name)}`; }
  async schema() { return discover(this.pool, this.namespace); }
  private async ready(q: Queryable) {
    const schema = await discover(q, this.namespace);
    if (!schema.ready) fail("Transfer storage is not installed. Apply migration 0020 to development after merge.", 503);
    return schema;
  }
  private async setup(q: Queryable) {
    await q.query("SET LOCAL statement_timeout='15s'");
    await q.query("SET LOCAL lock_timeout='5s'");
    await q.query("SET LOCAL timezone='UTC'");
    await q.query("SET LOCAL datestyle='ISO, YMD'");
  }
  private async guardedNames(q: Queryable, names: string[]) {
    const children = await q.query(`SELECT DISTINCT child.relname AS name FROM pg_constraint c
      JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
      WHERE c.contype='f' AND cn.nspname=$1 AND pn.nspname=$1 AND parent.relname=ANY($2::text[])`, [this.namespace, names]);
    // The tool itself creates previews/audits/backups between its guard checks.
    // Following users' actor_id children into these tables would invalidate
    // every import through our own bookkeeping, not through a business edit.
    return [...new Set<string>([...names,...children.rows.map(r=>r.name)])]
      .filter(name => !/^(?:data_transfer_|database_backup_)/.test(name)).sort();
  }
  private async guard(q: Queryable, names: string[]) {
    const signatures: Record<string, string> = {};
    for (const name of await this.guardedNames(q, names)) {
      const { rows } = await q.query(`SELECT md5(COALESCE(string_agg(sig,',' ORDER BY sig),'')) AS sig
        FROM (SELECT md5(row_to_json(t)::text) AS sig FROM ${this.table(name)} t) data`);
      signatures[name] = rows[0].sig;
    }
    return hash(signatures);
  }
  private async savePreview(actor: number, document: Document) {
    const p = document.preview;
    await this.pool.query(`INSERT INTO ${this.table("data_transfer_previews")}(id,actor_id,document,expires_at)
      VALUES($1,$2,$3::jsonb,$4)`, [p.id, actor, stable(document), p.expiresAt]);
    return p;
  }
  private async getPreview(q: Queryable, actor: number, id: string): Promise<Document> {
    const { rows } = await q.query(`SELECT document FROM ${this.table("data_transfer_previews")}
      WHERE id=$1 AND actor_id=$2 AND expires_at>clock_timestamp()`, [id, actor]);
    if (!rows.length || !rows[0].document.preview) fail("Preview expired or unavailable; create a new preview", 409);
    return rows[0].document;
  }
  private async log(q: Queryable, actor: number, kind: string, status: string, counts: object = {}, id: string = randomUUID(), result: any = null, approvalHash: string | null = null) {
    await q.query(`INSERT INTO ${this.table("data_transfer_operations")}
      (id,actor_id,kind,status,counts,result,approval_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [id, actor, kind, status, stable(counts), result === null ? null : stable(result), approvalHash]);
    return id;
  }
  async rejection(actor: number, kind: string) {
    // Never log payloads, SQL error details, filenames or customer values.
    if ((await this.schema()).ready) await this.log(this.pool, actor, kind, "rejected");
  }
  async cleanup() {
    await this.pool.query(`DELETE FROM ${this.table("data_transfer_previews")} WHERE expires_at<clock_timestamp()`);
    await this.pool.query(`DELETE FROM ${this.table("data_transfer_backups")} WHERE expires_at<clock_timestamp()`);
  }
  async readFile(actor: number, bytes: Buffer, filename: string): Promise<TransferFile> {
    await this.ready(this.pool);
    const file = await parseFile(bytes, filename, async obj => {
      verifyBundleShape(obj);
      const schema = await this.schema();
      for (const t of obj.tables) {
        const table = approved(schema, t.name);
        const headers = t.columns.map((c: any) => c.name);
        if (headers.some((h: string) => !table.columns.some(c => c.name === h))) fail("Package contains retired, protected or unknown columns");
      }
      const { rows } = await this.pool.query(`SELECT id FROM ${this.table("data_transfer_operations")}
        WHERE id=$1 AND kind='export' AND status='completed' AND result->>'checksum'=$2`, [obj.id, obj.checksum]);
      return {
        source: rows.length ? "same-database" : "external", schemaVersion: obj.schemaVersion,
        tables: obj.tables.map((t: any) => ({ name: t.name, headers: t.columns.map((c: any) => c.name), rows: t.rows })),
      };
    });
    for (const table of file.tables) {
      if (table.headers.some(h => (protectedColumn.test(h) && h !== "permissions") || /كلمة.*مرور/.test(h))) {
        fail("Authentication secrets cannot be uploaded to general transfer", 403);
      }
    }
    const receipt = randomUUID();
    await this.pool.query(`INSERT INTO ${this.table("data_transfer_previews")}(id,actor_id,document,expires_at)
      VALUES($1,$2,$3::jsonb,clock_timestamp()+interval '30 minutes')`, [receipt, actor, stable({ file })]);
    return { ...file, receipt };
  }
  async export(actor: number, names: string[], format: string, version: string) {
    if (!Array.isArray(names) || !names.length || names.length > 10 || new Set(names).size !== names.length) fail("Choose 1–10 unique tables");
    if (!["csv", "xlsx", "json"].includes(format)) fail("Unsupported transfer format");
    const q = await this.pool.connect();
    try {
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await this.setup(q);
      const schema = await this.ready(q);
      if (schema.version !== version) fail("Schema changed; refresh and preview again", 409);
      if (format === "json") {
        const related = new Set(names);
        for (const name of related) for (const relation of approved(schema, name).relations) related.add(relation.table);
        if (related.size > 10) fail("Related JSON package exceeds 10 tables; choose a smaller business group");
        names = [...related];
      }
      const data: Snapshot = {};
      let count = 0;
      for (const name of names) {
        data[name] = await readRows(q, approved(schema, name), this.namespace);
        count += data[name].length;
        if (count > 20000 || Buffer.byteLength(stable(data)) > 30 * 1024 * 1024) fail("Export exceeds safe transfer limits", 413);
      }
      // JSON bundles contain the selected related tables and their exact FK
      // descriptors. Omitted references remain explicit, never inferred.
      const bundle = makeBundle(schema, data, "database");
      const body = format === "json" ? Buffer.from(stable(bundle)) : format === "csv"
        ? names.length===1
          ? Buffer.from(csvExport(schema.tables.find(t => t.name === names[0])!.columns.map(c => c.name), data[names[0]]))
          : await csvZipExport(data,schema)
        : await excelExport(data, schema);
      await this.log(q, actor, "export", "completed", { rows: count }, bundle.id,
        { checksum: bundle.checksum, tables: names, format });
      await q.query("COMMIT");
      return { body, type: format === "csv" && names.length>1 ? "application/zip" : format === "csv" ? "text/csv; charset=utf-8" : format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json",
        filename: `MPBF-data-${bundle.id}.${format==="csv"&&names.length>1?"zip":format}` };
    } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
  }
  async preview(actor: number, version: string, submitted: TransferFile, mappings: TransferMapping[], confirmLocalIds = false) {
    if (!submitted?.receipt) fail("Upload the file again; a server receipt is required");
    await this.ready(this.pool);
    const { rows: uploads } = await this.pool.query(`SELECT document FROM ${this.table("data_transfer_previews")}
      WHERE id=$1 AND actor_id=$2 AND expires_at>clock_timestamp()`, [submitted.receipt, actor]);
    const file: TransferFile | undefined = uploads[0]?.document.file;
    if (!file) fail("Uploaded file expired or unavailable", 409);
    const { receipt: _receipt, ...clientFile } = submitted;
    if (hash(clientFile) !== hash(file)) fail("Uploaded file was changed; upload again", 409);
    const q = await this.pool.connect();
    let document: Document;
    try {
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await this.setup(q);
      const schema = await this.ready(q);
      if (schema.version !== version || (file.schemaVersion && file.source === "same-database" && file.schemaVersion !== version)) fail("Schema changed; refresh and preview again", 409);
      const graph = await snapshot(q, schema, this.namespace);
      const guard = await this.guard(q, Object.keys(graph));
      const rows = makePreview(schema, file, mappings, graph, confirmLocalIds);
      const projected = project(graph, rows);
      try { guardAdministrator(actor, rows, projected); }
      catch (e) { for (const row of rows.filter(r => ["users", "roles"].includes(r.table))) { row.status = "invalid"; row.errors.push({ column: "", message: (e as Error).message }); } }
      if (!rows.length || rows.length > MAX_ROWS) fail("File must contain 1–2000 rows");
      document = { preview: { id: randomUUID(), version, expiresAt: new Date(Date.now() + 1800000).toISOString(), rows, kind: "import",
        requiresAdminConfirmation: grantsAdministrator(rows, graph, projected) },
        graph, guard, mappings };
      await q.query("COMMIT");
    } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
    await this.cleanup();
    await this.log(this.pool, actor, "preview", document!.preview.rows.some(r=>r.errors.length) ? "rejected" : "previewed",
      {rows:document!.preview.rows.length,invalid:document!.preview.rows.filter(r=>r.errors.length).length});
    return this.savePreview(actor, document!);
  }
  private selected(document: Document, approvals: TransferApproval[], confirmNew: boolean) {
    if (!Array.isArray(approvals) || approvals.length > MAX_ROWS || new Set(approvals.map(a => a.index)).size !== approvals.length) fail("Invalid approval list");
    const rows = document.preview.rows;
    if (rows.some(r => r.errors.length || ["invalid", "conflict"].includes(r.status))) fail("Entire batch rejected; resolve all preview errors", 409);
    const allowed = new Map<number, string[]>();
    for (const approval of approvals) {
      const row = rows.find(r => r.index === approval.index);
      if (!row || row.status !== "existing" || !Array.isArray(approval.columns) ||
        new Set(approval.columns).size !== approval.columns.length ||
        approval.columns.some(c => !row.changes.some(d => d.column === c))) fail("Approval must name exact previewed update cells");
      allowed.set(row.index, approval.columns);
    }
    const selected = rows.flatMap(r => {
      if (r.status === "new") {
        if (!confirmNew) fail("Explicitly confirm new additions");
        return [r];
      }
      const changes = r.changes.filter(d => allowed.get(r.index)?.includes(d.column));
      return changes.length ? [{ ...r, values: Object.fromEntries(changes.map(d => [d.column, d.new])), changes }] : [];
    });
    if (!selected.length) fail("Select at least one change");
    return selected;
  }
  async apply(actor: number, previewId: string, approvals: TransferApproval[], confirmNew: boolean, confirmAdminGrants = false) {
    await this.ready(this.pool);
    const approvalHash = hash({ approvals, confirmNew, confirmAdminGrants });
    const q = await this.pool.connect();
    let locked = false;
    try {
      // Session lock spans the separately committed durable backup and atomic
      // business transaction. Other application writes are checked under locks.
      const lock = await q.query("SELECT pg_try_advisory_lock(731020) AS locked");
      if (!lock.rows[0].locked) fail("Another transfer is running; retry the same operation", 409);
      locked = true;
      const { rows: done } = await q.query(`SELECT actor_id,approval_hash,result,status FROM ${this.table("data_transfer_operations")} WHERE id=$1`, [previewId]);
      if (done.length) {
        if (done[0].actor_id !== actor || done[0].approval_hash !== approvalHash || done[0].status !== "completed") fail("Idempotency request does not match original approval", 409);
        return done[0].result;
      }
      const document = await this.getPreview(q, actor, previewId);
      const selected = this.selected(document, approvals, confirmNew);
      const proposed = project(document.graph, selected);
      guardAdministrator(actor, selected, proposed);
      if (grantsAdministrator(selected, document.graph, proposed) && !confirmAdminGrants) fail("Explicit administrator grant confirmation is required", 403);
      // Permanent backup is committed and read back before ANY business write.
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await this.setup(q);
      const schema = await this.ready(q);
      if (schema.version !== document.preview.version) fail("Schema changed; create a new preview", 409);
      const graph = await snapshot(q, schema, this.namespace);
      if (await this.guard(q, Object.keys(graph)) !== document.guard || hash(graph) !== hash(document.graph)) fail("Data or relationships changed; create a new preview", 409);
      const backup = { schemaVersion: schema.version, graph, guard: document.guard,
        rows: selected.map(r => ({ table: r.table, old: r.old, changes: r.changes, index: r.index })) };
      const checksum = hash(backup);
      await q.query(`INSERT INTO ${this.table("data_transfer_backups")}(id,actor_id,document,checksum,expires_at)
        VALUES($1,$2,$3::jsonb,$4,clock_timestamp()+interval '${RETENTION_DAYS} days')
        ON CONFLICT(id) DO NOTHING`, [previewId, actor, stable(backup), checksum]);
      const { rows: saved } = await q.query(`SELECT document,checksum FROM ${this.table("data_transfer_backups")} WHERE id=$1 AND actor_id=$2`, [previewId, actor]);
      if (!saved.length || saved[0].checksum !== checksum || hash(saved[0].document) !== checksum) fail("Backup verification failed", 500);
      await q.query("COMMIT");
      await q.query("BEGIN"); await this.setup(q);
      // These bounded table locks also prevent new children/phantoms created by
      // ordinary APIs, which do not participate in this tool's advisory lock.
      for (const name of await this.guardedNames(q, Object.keys(graph))) await q.query(`LOCK TABLE ${this.table(name)} IN SHARE ROW EXCLUSIVE MODE`);
      const currentSchema = await this.ready(q);
      if (currentSchema.version !== schema.version || await this.guard(q, Object.keys(graph)) !== document.guard) fail("Data, relationships or schema changed; create a new preview", 409);
      const projected = project(graph, selected);
      for (const row of selected) {
        const table = approved(currentSchema, row.table, true);
        if (Object.keys(row.values).some(c => !table.columns.find(x => x.name === c)?.writable &&
          !(document.preview.kind === "restore" && row.table === "customer_products" && productDerived.has(c)))) fail("Protected column", 403);
        validateBusiness(row.table, { ...row.old, ...row.values }, projected);
        for (const relation of table.relations) {
          const value = { ...row.old, ...row.values };
          if (relation.columns.every(c => value[c] != null) &&
            !projected[relation.table]?.some(r => relation.columns.every((c, i) => r[relation.targets[i]] === value[c]))) fail("Foreign relationship is missing");
        }
      }
      const applied: { table: string; old: TransferRow | null; after: TransferRow; columns: string[] }[] = [];
      // Dependencies first; self references are validated above and category
      // logical links have no database FK. No client controls execution order.
      const passwordHash = selected.some(r => r.table === "users" && !r.old)
        ? await bcrypt.hash(randomBytes(32).toString("base64url"), 12) : null;
      const insertedTables = new Set(selected.filter(r => !r.old).map(r => r.table));
      await preserveSequences(q, currentSchema, this.namespace, insertedTables);
      for (const row of orderedRows(selected, currentSchema, graph)) {
        const derived = derivedProductValues(row, currentSchema, projected);
        const values: TransferRow = { ...derived, ...row.values,
          ...(document.preview.kind !== "restore" ? derived : {}),
          ...(row.table === "users" && !row.old ? { password: passwordHash, must_change_password: "t" } : {}) };
        const columns = Object.keys(values);
        const params: any[] = columns.map(c => values[c]);
        const table = approved(currentSchema, row.table, true);
        const returning = table.columns.map(c => `${identifier(c.name)}::text AS ${identifier(c.name)}`).join(",");
        let text: string;
        if (row.old) {
          const key = table.keys.find(k => k.every(c => row.old![c] != null));
          if (!key) fail("No reliable row key");
          const where = key.map(c => { params.push(row.old![c]); return `${identifier(c)}=$${params.length}`; }).join(" AND ");
          text = `UPDATE ${this.table(row.table)} SET ${columns.map((c, i) => `${identifier(c)}=$${i + 1}`).join(",")} WHERE ${where} RETURNING ${returning}`;
        } else text = columns.length ? `INSERT INTO ${this.table(row.table)}(${columns.map(identifier).join(",")}) ${table.columns.some(c => c.identity) ? "OVERRIDING SYSTEM VALUE" : ""}
          VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) RETURNING ${returning}`
          : `INSERT INTO ${this.table(row.table)} DEFAULT VALUES RETURNING ${returning}`;
        const { rows } = await q.query(text, params);
        if (rows.length !== 1) fail("Row changed; create a new preview", 409);
        applied.push({ table: row.table, old: row.old, after: rows[0], columns });
      }
      await preserveSequences(q, currentSchema, this.namespace, insertedTables);
      const counts = { inserted: applied.filter(r => !r.old).length, updated: applied.filter(r => r.old).length };
      const result = { id: previewId, status: "completed", counts, backup: true, retainedInserts: document.preview.retainedInserts ?? 0 };
      // Detailed before/after images are private backup data, not activity logs.
      const finalBackup = { ...backup, applied, afterGuard: await this.guard(q, Object.keys(graph)),
        ...(document.restoredOperation ? { restoredOperation: document.restoredOperation } : {}) };
      await q.query(`UPDATE ${this.table("data_transfer_backups")} SET document=$2::jsonb,checksum=$3 WHERE id=$1`,
        [previewId, stable(finalBackup), hash(finalBackup)]);
      await this.log(q, actor, document.preview.kind, "completed", counts, previewId, result, approvalHash);
      await q.query("COMMIT");
      return result;
    } catch (e) { await q.query("ROLLBACK"); throw e; }
    finally {
      if (locked) await q.query("SELECT pg_advisory_unlock(731020)");
      q.release();
    }
  }
  async operations(actor: number): Promise<TransferOperation[]> {
    await this.ready(this.pool);
    await this.cleanup();
    const { rows } = await this.pool.query(`SELECT o.id,o.actor_id AS actor,o.kind,o.status,o.counts,o.created_at AS "createdAt",
      EXISTS(SELECT 1 FROM ${this.table("data_transfer_backups")} b WHERE b.id=o.id AND b.expires_at>clock_timestamp()) AS backup
      FROM ${this.table("data_transfer_operations")} o WHERE o.actor_id=$1 ORDER BY o.created_at DESC LIMIT 100`, [actor]);
    return rows;
  }
  async report(actor: number, id: string) {
    await this.ready(this.pool);
    const { rows } = await this.pool.query(`SELECT id,actor_id,kind,status,counts,created_at FROM ${this.table("data_transfer_operations")}
      WHERE id=$1 AND actor_id=$2`, [id, actor]);
    if (!rows.length) fail("Report unavailable", 404);
    return rows[0];
  }
  async backup(actor: number, id: string) {
    await this.ready(this.pool);
    const { rows } = await this.pool.query(`SELECT document,checksum,expires_at FROM ${this.table("data_transfer_backups")}
      WHERE id=$1 AND actor_id=$2 AND expires_at>clock_timestamp()`, [id, actor]);
    if (!rows.length) fail("Backup expired or unavailable", 404);
    if (hash(rows[0].document) !== rows[0].checksum) fail("Backup verification failed", 500);
    return rows[0];
  }
  async restorePreview(actor: number, operationId: string) {
    const backup = await this.backup(actor, operationId);
    const applied: { table: string; old: TransferRow | null; after: TransferRow; columns: string[] }[] = backup.document.applied;
    if (!applied) fail("Operation has no committed changes to restore", 409);
    const q = await this.pool.connect();
    let document: Document;
    try {
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await this.setup(q);
      const schema = await this.ready(q);
      if (schema.version !== backup.document.schemaVersion) fail("Schema changed; restore requires policy review", 409);
      const graph = await snapshot(q, schema, this.namespace);
      const rows: TransferPreviewRow[] = [];
      for (const entry of applied.filter(r => r.old)) {
        const table = approved(schema, entry.table, true);
        const key = table.keys.find(k => k.every(c => entry.after[c] != null));
        const current = key ? graph[entry.table].find(r => key.every(c => r[c] === entry.after[c])) : undefined;
        const row: TransferPreviewRow = { index: rows.length, table: entry.table, old: current ?? null,
          status: "existing", values: {}, changes: [], errors: [] };
        if (!current || hash(current) !== hash(entry.after)) {
          row.status = "conflict";
          row.errors.push({ column: "", message: "Row changed after import; restore is blocked" });
        } else for (const column of entry.columns) {
          if (entry.old![column] !== current[column]) {
            row.values[column] = entry.old![column];
            row.changes.push({ column, old: current[column], new: entry.old![column] });
          }
        }
        rows.push(row);
      }
      // Changes in relationships since the operation prohibit reversal rather
      // than deleting newer dependents or silently overwriting their edits.
      if (await this.guard(q, Object.keys(graph)) !== backup.document.afterGuard) {
        for (const row of rows) {
          row.status = "conflict"; row.errors.push({ column: "", message: "Related data changed after import; restore is blocked" });
        }
      }
      const projected = project(graph, rows);
      for (const row of rows.filter(r => !r.errors.length)) {
        try { validateBusiness(row.table, { ...row.old, ...row.values }, projected); }
        catch (e) { row.status = "invalid"; row.errors.push({ column: "", message: (e as Error).message }); }
      }
      document = { preview: { id: randomUUID(), version: schema.version, kind: "restore", rows,
        requiresAdminConfirmation: grantsAdministrator(rows, graph, projected),
        expiresAt: new Date(Date.now() + 1800000).toISOString(), retainedInserts: applied.filter(r => !r.old).length },
        graph, guard: await this.guard(q, Object.keys(graph)), mappings: [], restoredOperation: operationId };
      await q.query("COMMIT");
    } catch (e) { await q.query("ROLLBACK"); throw e; } finally { q.release(); }
    return this.savePreview(actor, document!);
  }
  async templates(actor: number): Promise<TransferTemplate[]> {
    await this.ready(this.pool);
    return (await this.pool.query(`SELECT id,name,schema_version AS version,mappings FROM ${this.table("data_transfer_templates")}
      WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 50`, [actor])).rows;
  }
  async saveTemplate(actor: number, name: string, version: string, mappings: TransferMapping[]) {
    const schema = await this.ready(this.pool);
    if (schema.version !== version) fail("Schema changed; refresh first", 409);
    if (typeof name !== "string" || !name.trim() || name.length > 100 || !Array.isArray(mappings) || mappings.length > 10 || !mappings.length) fail("Invalid template");
    for (const mapping of mappings) {
      const table = approved(schema, mapping.table, true);
      if (!mapping.columns || Object.values(mapping.columns).some(c => c && !table.columns.find(x => x.name === c)?.writable)) fail("Protected template column");
    }
    const id = randomUUID();
    await this.pool.query(`INSERT INTO ${this.table("data_transfer_templates")}(id,actor_id,name,schema_version,mappings)
      VALUES($1,$2,$3,$4,$5::jsonb)`, [id, actor, name.trim(), version, stable(mappings)]);
    return { id, name: name.trim(), version, mappings };
  }
}
