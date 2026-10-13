import { randomUUID } from "node:crypto";
import type { TransferPool, Queryable } from "../data-transfer/schema";
import type { DatabaseBackupPreview, DatabaseRestoreResult } from "../../shared/database-backups";
import { backupError, decryptBackup, encryptBackup, validatePassphrase } from "./crypto";
import { capture, discover, hash, MAX_ROWS, quote, retainedPredicate, schemaHash, tableRef, validateSnapshot, type Catalog, type Snapshot } from "./catalog";

type Context = {
  actor: number; archive: Buffer; before: string; expires: number;
  summary: DatabaseBackupPreview; safetyHash?: string; working: boolean;
};
export class DatabaseBackupService {
  private contexts = new Map<string, Context>();
  constructor(private pool: TransferPool, private namespace = "public") {}
  private table(name: string) { return tableRef(this.namespace, name); }
  private async setup(q: Queryable) {
    await q.query("SET LOCAL TIME ZONE 'UTC'");
    await q.query("SET LOCAL DateStyle='ISO,YMD'");
    await q.query("SET LOCAL statement_timeout='120s'");
    await q.query("SET LOCAL lock_timeout='8s'");
  }
  private cleanup() {
    for (const [id, ctx] of this.contexts) if (ctx.expires <= Date.now() && !ctx.working) {
      ctx.archive.fill(0); this.contexts.delete(id);
    }
  }
  private context(actor: number, id: string) {
    this.cleanup();
    const ctx = this.contexts.get(id);
    if (!ctx || ctx.actor !== actor || ctx.expires <= Date.now()) backupError("BACKUP_EXPIRED", 409);
    if (ctx.working) backupError("BACKUP_BUSY", 409);
    return ctx;
  }
  private async ready(q: Queryable) {
    const { rows } = await q.query("SELECT to_regclass($1) IS NOT NULL AS ready", [`${this.namespace}.data_transfer_operations`]);
    if (!rows[0].ready) backupError("BACKUP_STORAGE_UNAVAILABLE", 503);
  }
  private async log(q: Queryable, actor: number, id: string, kind: string, counts: unknown, result: unknown = null, approval: string | null = null) {
    await q.query(`INSERT INTO ${this.table("data_transfer_operations")}
      (id,actor_id,kind,status,counts,result,approval_hash)
      VALUES($1,$2,$3,'completed',$4::jsonb,$5::jsonb,$6)`,
    [id, actor, kind, JSON.stringify(counts), result === null ? null : JSON.stringify(result), approval]);
  }
  private async snapshot(): Promise<{ catalog: Catalog; document: Snapshot }> {
    const q = await this.pool.connect();
    try {
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await this.setup(q); await this.ready(q);
      const catalog = await discover(q, this.namespace);
      const document = await capture(q, catalog);
      await q.query("COMMIT");
      return { catalog, document };
    } catch (error) { await q.query("ROLLBACK").catch(() => {}); throw error; }
    finally { q.release(); }
  }
  async create(actor: number, passphrase: string) {
    validatePassphrase(passphrase);
    const { document } = await this.snapshot();
    this.ensureAdmin(document, actor);
    const archive = await encryptBackup(document, passphrase);
    await this.log(this.pool, actor, randomUUID(), "database_backup",
      { tables: document.tables.length, rows: document.tables.reduce((n, t) => n + t.rows.length, 0) });
    return archive;
  }
  private ensureAdmin(document: Snapshot, actor: number) {
    const users = document.tables.find(t => t.name === "users"), roles = document.tables.find(t => t.name === "roles");
    if (!users || !roles) backupError("BACKUP_ADMIN_MISSING", 409);
    const user = users.rows.find(r => r[users.columns.indexOf("id")] === String(actor));
    const role = user && roles.rows.find(r => r[roles.columns.indexOf("id")] === user[users.columns.indexOf("role_id")]);
    const permissions = role?.[roles.columns.indexOf("permissions")];
    let grants: unknown;
    try { grants = JSON.parse(permissions ?? "null"); } catch { grants = null; }
    if (!user || user[users.columns.indexOf("status")] !== "active" ||
      !Array.isArray(grants) || !grants.includes("admin") ||
      !user[users.columns.indexOf("username")] || !user[users.columns.indexOf("password")]) {
      backupError("BACKUP_ADMIN_MISSING", 409);
    }
  }
  private async relationships(q: Queryable, catalog: Catalog, document: Snapshot) {
    const included = new Map(document.tables.map(t => [t.name, t]));
    const currentKeys = async (name: string, columns: string[], predicate = "TRUE") => {
      const { rows } = await q.query(`SELECT ${columns.map(c => `${quote(c)}::text AS ${quote(c)}`).join(",")}
        FROM ${this.table(name)} WHERE ${predicate} LIMIT $1`, [MAX_ROWS + 1]);
      if (rows.length > MAX_ROWS) backupError("BACKUP_TOO_LARGE", 413);
      return rows.map(r => columns.map(c => r[c] as string | null));
    };
    const savedKeys = (name: string, columns: string[]) => {
      const table = included.get(name)!;
      return table.rows.map(r => columns.map(c => r[table.columns.indexOf(c)]));
    };
    for (const fk of catalog.constraints) {
      if (!included.has(fk.table) && !included.has(fk.target)) continue;
      let children = included.has(fk.table) ? savedKeys(fk.table, fk.columns) : await currentKeys(fk.table, fk.columns);
      let parents = included.has(fk.target) ? savedKeys(fk.target, fk.targets) : await currentKeys(fk.target, fk.targets);
      for (const [name, columns, kind] of [[fk.table, fk.columns, "children"], [fk.target, fk.targets, "parents"]] as const) {
        const table = catalog.tables.find(t => t.name === name);
        if (table?.privateKeyColumn) {
          const retained = await currentKeys(name, columns, `NOT (${retainedPredicate(table)})`);
          if (kind === "children") children = [...children, ...retained]; else parents = [...parents, ...retained];
        }
      }
      const keys = new Set(parents.map(row => JSON.stringify(row)));
      if (children.some(row => {
        const nulls = row.filter(v => v === null).length;
        if (nulls) return fk.definition.includes("MATCH FULL") && nulls !== row.length;
        return !keys.has(JSON.stringify(row));
      })) backupError("BACKUP_RELATION_BLOCKED", 409);
    }
  }
  async preview(actor: number, archive: Buffer, passphrase: string): Promise<DatabaseBackupPreview> {
    const decrypted = await decryptBackup(archive, passphrase);
    const q = await this.pool.connect();
    let document: Snapshot, current: Snapshot;
    try {
      await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await this.setup(q); await this.ready(q);
      const catalog = await discover(q, this.namespace);
      document = validateSnapshot(decrypted, catalog); this.ensureAdmin(document, actor);
      await this.relationships(q, catalog, document);
      current = await capture(q, catalog);
      await q.query("COMMIT");
    } catch (error) { await q.query("ROLLBACK").catch(() => {}); throw error; }
    finally { q.release(); }
    this.cleanup();
    for (const [id, ctx] of this.contexts) if (ctx.actor === actor) {
      if (ctx.working) backupError("BACKUP_BUSY", 409);
      ctx.archive.fill(0); this.contexts.delete(id);
    }
    if (this.contexts.size >= 2) backupError("BACKUP_BUSY", 503);
    const id = randomUUID(), expires = Date.now() + 10 * 60_000;
    const summary: DatabaseBackupPreview = {
      id, createdAt: document.createdAt, expiresAt: new Date(expires).toISOString(),
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      tables: document.tables.map((t, i) => ({ name: t.name, backupRows: t.rows.length, currentRows: current.tables[i].rows.length })),
      excludedTables: current.excludedTables, totalRows: document.tables.reduce((n, t) => n + t.rows.length, 0), safetyReady: false,
    };
    this.contexts.set(id, { actor, archive: Buffer.from(archive), before: current.stateHash, expires, summary, working: false });
    return summary;
  }
  async safety(actor: number, id: string, passphrase: string) {
    const ctx = this.context(actor, id); ctx.working = true;
    try {
      // Verify the archive passphrase again; the safety copy uses that same key.
      const source = await decryptBackup(ctx.archive, passphrase);
      const { catalog, document } = await this.snapshot();
      validateSnapshot(source, catalog);
      if (document.stateHash !== ctx.before) backupError("BACKUP_DATA_CHANGED", 409);
      const archive = await encryptBackup(document, passphrase);
      ctx.safetyHash = hash(archive); ctx.summary.safetyReady = true;
      await this.log(this.pool, actor, randomUUID(), "database_safety_backup", { tables: document.tables.length });
      return { archive, checksum: ctx.safetyHash };
    } finally { ctx.working = false; }
  }
  async apply(actor: number, input: { id: string; passphrase: string; safetyChecksum: string; confirmRestore: boolean; confirmSafetySaved: boolean }): Promise<DatabaseRestoreResult> {
    if (!input.confirmRestore || !input.confirmSafetySaved) backupError("BACKUP_CONFIRMATION");
    validatePassphrase(input.passphrase);
    const approval = hash([input.id, input.safetyChecksum, input.confirmRestore, input.confirmSafetySaved]);
    const cached = await this.pool.query(`SELECT actor_id,approval_hash,result FROM ${this.table("data_transfer_operations")}
      WHERE id=$1 AND kind='database_restore' AND status='completed'`, [input.id]);
    if (cached.rows.length) {
      if (cached.rows[0].actor_id !== actor || cached.rows[0].approval_hash !== approval) backupError("BACKUP_INVALID", 409);
      return cached.rows[0].result;
    }
    const ctx = this.context(actor, input.id);
    if (!ctx.safetyHash || ctx.safetyHash !== input.safetyChecksum) backupError("BACKUP_SAFETY_REQUIRED", 409);
    ctx.working = true;
    const q = await this.pool.connect().catch(() => {
      ctx.working = false; backupError("BACKUP_STORAGE_UNAVAILABLE", 503);
    });
    try {
      const decrypted = await decryptBackup(ctx.archive, input.passphrase);
      await q.query("BEGIN"); await this.setup(q);
      await q.query("SELECT pg_advisory_xact_lock(1089)");
      const catalog = await discover(q, this.namespace);
      await q.query(`LOCK TABLE ${catalog.allTables.map(n => this.table(n)).join(",")} IN ACCESS EXCLUSIVE MODE`);
      const locked = await discover(q, this.namespace);
      if (schemaHash(locked) !== schemaHash(catalog)) backupError("BACKUP_SCHEMA_CHANGED", 409);
      const document = validateSnapshot(decrypted, locked); this.ensureAdmin(document, actor);
      const before = await capture(q, locked);
      if (before.stateHash !== ctx.before) backupError("BACKUP_DATA_CHANGED", 409);
      await this.relationships(q, locked, document);
      // DDL is transactional and invisible outside the exclusive locks.
      // Re-add and validate every FK before commit; no CASCADE or superuser mode.
      for (const fk of locked.constraints) {
        await q.query(`ALTER TABLE ${this.table(fk.table)} DROP CONSTRAINT ${quote(fk.name)}`);
      }
      const triggers = locked.triggers.filter(t => locked.tables.some(table => table.name === t.table));
      for (const trigger of triggers) await q.query(`ALTER TABLE ${this.table(trigger.table)} DISABLE TRIGGER ${quote(trigger.name)}`);
      for (const table of locked.tables) {
        await q.query(`DELETE FROM ${this.table(table.name)} WHERE ${retainedPredicate(table)}`);
        const data = document.tables.find(t => t.name === table.name)!;
        const columns = table.columns.filter(c => !c.generated);
        if (!columns.length && data.rows.length) backupError("BACKUP_UNSAFE_SCHEMA", 409);
        const indices = columns.map(c => data.columns.indexOf(c.name));
        // Bound batch size avoids both PostgreSQL's parameter limit and giant SQL.
        const batchSize = Math.max(1, Math.min(100, Math.floor(60000 / columns.length)));
        for (let start = 0; start < data.rows.length; start += batchSize) {
          const batch = data.rows.slice(start, start + batchSize), params: (string | null)[] = [];
          const values = batch.map(row => `(${indices.map(i => { params.push(row[i]); return `$${params.length}`; }).join(",")})`);
          await q.query(`INSERT INTO ${this.table(table.name)} (${columns.map(c => quote(c.name)).join(",")})
            OVERRIDING SYSTEM VALUE VALUES ${values.join(",")}`, params);
        }
      }
      for (const seq of locked.sequences) {
        const saved = document.sequences.find(s => s.name === seq.name)!, old = before.sequences.find(s => s.name === seq.name)!;
        const ascending = BigInt(seq.increment) > 0n;
        const candidates = [BigInt(saved.next), BigInt(old.next)];
        if (seq.table && seq.column) for (const source of [document, before]) {
          const table = source.tables.find(t => t.name === seq.table)!;
          const index = table.columns.indexOf(seq.column);
          for (const row of table.rows) if (row[index] !== null && /^-?\d+$/.test(row[index]!)) {
            candidates.push(BigInt(row[index]!) + BigInt(seq.increment));
          }
        }
        const next = candidates.reduce((a, b) => ascending ? (a > b ? a : b) : (a < b ? a : b));
        if (next < BigInt(seq.min) || next > BigInt(seq.max)) backupError("BACKUP_UNSAFE_SCHEMA", 409);
        // ALTER RESTART, unlike setval(), rolls back with the transaction.
        await q.query(`ALTER SEQUENCE ${this.table(seq.name)} RESTART WITH ${next.toString()}`);
      }
      for (const fk of locked.constraints) await q.query(`ALTER TABLE ${this.table(fk.table)} ADD CONSTRAINT ${quote(fk.name)} ${fk.definition}`);
      for (const trigger of triggers) {
        const command = trigger.enabled === "D" ? "DISABLE" : trigger.enabled === "R" ? "ENABLE REPLICA" : trigger.enabled === "A" ? "ENABLE ALWAYS" : "ENABLE";
        await q.query(`ALTER TABLE ${this.table(trigger.table)} ${command} TRIGGER ${quote(trigger.name)}`);
      }
      const after = await capture(q, await discover(q, this.namespace));
      if (after.schemaHash !== document.schemaHash || hash(after.tables) !== hash(document.tables)) backupError("BACKUP_VERIFICATION_FAILED", 409);
      if (locked.allTables.includes("sessions")) await q.query(`DELETE FROM ${this.table("sessions")}`);
      const result: DatabaseRestoreResult = {
        id: input.id, restoredTables: document.tables.length, restoredRows: document.tables.reduce((n, t) => n + t.rows.length, 0),
        restoredAt: new Date().toISOString(), requiresLogin: true,
      };
      await this.log(q, actor, input.id, "database_restore", { tables: result.restoredTables, rows: result.restoredRows }, result, approval);
      await q.query("COMMIT");
      ctx.archive.fill(0); this.contexts.delete(input.id);
      return result;
    } catch (error: any) {
      await q.query("ROLLBACK").catch(() => {});
      if (error.status) throw error;
      if (["55P03", "40P01", "57014"].includes(error.code)) backupError("BACKUP_BUSY", 409);
      if (["23503", "23505", "23514", "23502"].includes(error.code)) backupError("BACKUP_RELATION_BLOCKED", 409);
      backupError("BACKUP_FAILED", 500);
    } finally { ctx.working = false; q.release(); }
  }
}
