// This script never imports the application's db or reads its credentials.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { DatabaseBackupService } from "../server/database-backups/service";
import { decryptBackup, encryptBackup } from "../server/database-backups/crypto";
import { capture, discover, hash, type Snapshot } from "../server/database-backups/catalog";

if (!process.argv.includes("--isolated")) throw Error("Disposable database only; use --isolated.");
const pool = new Pool({ host: "127.0.0.1", port: 55443, user: "runner", database: "backups_isolated_test" });
const service = new DatabaseBackupService(pool);
const phrase = "synthetic-backup-passphrase-2026";
let tests = 0;
const test = async (name: string, fn: () => Promise<void>) => { await fn(); tests++; console.log(`PASS ${name}`); };
const sql = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rows;
const snap = async () => {
  const q = await pool.connect();
  try {
    await q.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await q.query("SET LOCAL TIME ZONE 'UTC'");
    await q.query("SET LOCAL DateStyle='ISO,YMD'");
    const result = await capture(q, await discover(q, "public"));
    await q.query("COMMIT"); return result;
  } finally { q.release(); }
};
const assertCode = async (action: () => Promise<unknown>, code: string) =>
  assert.rejects(action, (error: any) => error.message === code);
const apply = async (id: string, checksum: string) => service.apply(1, {
  id, safetyChecksum: checksum, passphrase: phrase, confirmRestore: true, confirmSafetySaved: true,
});
let archive: Buffer, original: Snapshot;
try {
  await sql(`
    CREATE TABLE roles(id serial PRIMARY KEY,name text,permissions json);
    CREATE TABLE users(id serial PRIMARY KEY,username text UNIQUE,password text,role_id integer REFERENCES roles(id),
      status text NOT NULL DEFAULT 'active',must_change_password boolean DEFAULT false);
    INSERT INTO roles(name,permissions) VALUES('Administrator','["admin"]'),('Operator','["view_production"]');
    INSERT INTO users(username,password,role_id) VALUES('admin','synthetic-password-hash',1),('worker','other-hash',2);
    CREATE TABLE customers(id text PRIMARY KEY,name text NOT NULL);
    CREATE TABLE products(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,customer_id text REFERENCES customers(id),
      amount numeric(25,4) NOT NULL CHECK(amount>0),names text[],payload jsonb,binary_value bytea,stamp timestamptz,
      calculated numeric(25,4) GENERATED ALWAYS AS (amount*2) STORED);
    CREATE TABLE orders(id serial PRIMARY KEY,customer_id text REFERENCES customers(id),share_token text);
    CREATE TABLE a_cycle(id integer PRIMARY KEY,b_id integer);
    CREATE TABLE b_cycle(id integer PRIMARY KEY,a_id integer REFERENCES a_cycle(id));
    ALTER TABLE a_cycle ADD CONSTRAINT a_cycle_b_fk FOREIGN KEY(b_id) REFERENCES b_cycle(id) ON DELETE CASCADE;
    INSERT INTO a_cycle VALUES(1,null); INSERT INTO b_cycle VALUES(2,1); UPDATE a_cycle SET b_id=2;
    CREATE TABLE settings(key text PRIMARY KEY,value text);
    INSERT INTO settings VALUES('shift_hours','12'),('provider_api_key','synthetic-secret-not-for-backup');
    CREATE TABLE integration_credentials(id integer PRIMARY KEY,password text);
    INSERT INTO integration_credentials VALUES(1,'sensitive-connection-password');
    CREATE TABLE sessions(sid text PRIMARY KEY,sess jsonb);
    INSERT INTO sessions VALUES('old-session','{"userId":1}');
    CREATE SEQUENCE custom_order_number_seq START 75;
    INSERT INTO customers VALUES('CID001','Original'),('CID002','Second');
    INSERT INTO products(customer_id,amount,names,payload,binary_value,stamp) VALUES
      ('CID001',1234567890123456.1234,ARRAY['hello','اختبار'],'{"decimal":1234567890123456.1234}',decode('00ff12','hex'),'2026-10-13 02:00:00+03');
    INSERT INTO orders(customer_id,share_token) VALUES('CID001','business-qr-token');
    CREATE FUNCTION touch_names() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.names=ARRAY['would-change-on-restore']; RETURN NEW; END $$;
    CREATE TRIGGER product_insert BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION touch_names();
  `);
  await test("missing technical tables report setup-required instead of a transient storage outage", async () => {
    await assertCode(() => service.create(1, phrase), "BACKUP_SETUP_REQUIRED");
    assert.equal((await sql("SELECT count(*)::int AS n FROM customers"))[0].n, 2);
  });
  await pool.query(readFileSync("migrations/0020_data_transfer.sql", "utf8"));
  await test("encrypted full archive preserves exact decimals, arrays, JSON, binary, accounts, identity and business QR", async () => {
    original = await snap(); archive = await service.create(1, phrase);
    assert.equal(archive.subarray(0, 8).toString(), "MPBFBK01");
    assert.equal(archive.includes(Buffer.from("synthetic-password-hash")), false);
    assert.equal(archive.includes(Buffer.from("Original")), false);
    const doc = await decryptBackup(archive, phrase) as Snapshot;
    assert.equal(hash(doc.tables), hash(original.tables));
    assert.ok(doc.tables.find(t => t.name === "users"));
    assert.ok(doc.tables.find(t => t.name === "roles"));
    assert.ok(doc.tables.find(t => t.name === "orders")!.rows[0].includes("business-qr-token"));
    assert.ok(doc.tables.find(t => t.name === "products")!.rows[0].includes("1234567890123456.1234"));
    assert.ok(doc.sequences.find(s => s.name === "custom_order_number_seq"));
    assert.equal(doc.tables.some(t => t.name === "sessions" || t.name === "integration_credentials"), false);
    assert.deepEqual(doc.tables.find(t => t.name === "settings")!.rows, [["shift_hours", "12"]]);
  });
  await test("wrong password, tampering, unsupported file and weak passphrase fail without writes", async () => {
    await assertCode(() => decryptBackup(archive, "wrong-backup-passphrase"), "BACKUP_INVALID");
    const tampered = Buffer.from(archive); tampered[tampered.length - 1] ^= 1;
    await assertCode(() => service.preview(1, tampered, phrase), "BACKUP_INVALID");
    await assertCode(() => service.preview(1, Buffer.from("not an archive"), phrase), "BACKUP_INVALID");
    await assertCode(() => service.create(1, "short"), "BACKUP_PASSPHRASE");
    assert.equal((await snap()).stateHash, original.stateHash);
  });
  await sql(`UPDATE customers SET name='Current' WHERE id='CID001';
    UPDATE users SET password='new-current-hash' WHERE id=2;
    INSERT INTO orders(customer_id,share_token) VALUES('CID002','new-qr');
    SELECT nextval('custom_order_number_seq');
    UPDATE settings SET value='current-secret-retained' WHERE key='provider_api_key';`);
  let preview = await service.preview(1, archive, phrase);
  await test("preview is read-only, bounded to actor, and requires safety and explicit approvals", async () => {
    const before = await snap();
    assert.equal(preview.tables.find(t => t.name === "orders")!.currentRows, 2);
    assert.equal(preview.tables.find(t => t.name === "orders")!.backupRows, 1);
    await assertCode(() => service.safety(2, preview.id, phrase), "BACKUP_EXPIRED");
    await assertCode(() => apply(preview.id, "0".repeat(64)), "BACKUP_SAFETY_REQUIRED");
    await assertCode(() => service.apply(1, { id: preview.id, safetyChecksum: "0".repeat(64), passphrase: phrase, confirmRestore: false, confirmSafetySaved: true }), "BACKUP_CONFIRMATION");
    assert.equal((await snap()).stateHash, before.stateHash);
  });
  await test("stale preview and changed schema block safety and restore", async () => {
    await sql("UPDATE customers SET name='new edit' WHERE id='CID001'");
    await assertCode(() => service.safety(1, preview.id, phrase), "BACKUP_DATA_CHANGED");
    await sql("ALTER TABLE customers ADD COLUMN extra text");
    await assertCode(() => service.preview(1, archive, phrase), "BACKUP_SCHEMA_CHANGED");
    await sql("ALTER TABLE customers DROP COLUMN extra");
  });
  preview = await service.preview(1, archive, phrase);
  let safety = await service.safety(1, preview.id, phrase);
  await test("pre-restore safety is independently encrypted and retains the actual current state", async () => {
    const doc = await decryptBackup(safety.archive, phrase) as Snapshot;
    assert.equal(doc.tables.find(t => t.name === "customers")!.rows.find(r => r[0] === "CID001")![1], "new edit");
    assert.equal(doc.tables.find(t => t.name === "orders")!.rows.length, 2);
  });
  await test("changes after safety block apply and cannot be erased", async () => {
    await sql("UPDATE customers SET name='newest edit' WHERE id='CID001'");
    await assertCode(() => apply(preview.id, safety.checksum), "BACKUP_DATA_CHANGED");
    assert.equal((await sql("SELECT name FROM customers WHERE id='CID001'"))[0].name, "newest edit");
  });
  preview = await service.preview(1, archive, phrase); safety = await service.safety(1, preview.id, phrase);
  await test("atomic full restore supports cyclic FKs, generated columns, identity, triggers and exact types", async () => {
    const result = await apply(preview.id, safety.checksum);
    assert.equal(result.requiresLogin, true);
    const after = await snap();
    assert.equal(hash(after.tables), hash(original.tables));
    assert.equal(after.schemaHash, original.schemaHash);
    assert.equal((await sql("SELECT count(*)::int AS n FROM sessions"))[0].n, 0);
    assert.equal((await sql("SELECT value FROM settings WHERE key='provider_api_key'"))[0].value, "current-secret-retained");
    assert.equal((await sql("SELECT password FROM integration_credentials"))[0].password, "sensitive-connection-password");
    assert.equal((await sql("SELECT nextval('custom_order_number_seq')::text AS n"))[0].n, "76");
    assert.equal((await sql("SELECT last_value::text AS n FROM orders_id_seq"))[0].n, "3");
  });
  await test("lost response replay is one commit and preserves newer edits", async () => {
    await sql("UPDATE customers SET name='after restore edit' WHERE id='CID001'");
    const first = await apply(preview.id, safety.checksum), second = await apply(preview.id, safety.checksum);
    assert.deepEqual(first, second);
    assert.equal((await sql("SELECT name FROM customers WHERE id='CID001'"))[0].name, "after restore edit");
    assert.equal((await sql("SELECT count(*)::int AS n FROM data_transfer_operations WHERE kind='database_restore'"))[0].n, 1);
  });
  await test("missing original administrator or permissions is rejected before writes", async () => {
    const doc = structuredClone(original);
    const roles = doc.tables.find(t => t.name === "roles")!;
    roles.rows.find(r => r[0] === "1")![roles.columns.indexOf("permissions")] = '["*"]';
    doc.stateHash = hash([doc.schemaHash, doc.tables, doc.sequences]);
    const encrypted = await encryptBackup(doc, phrase);
    await assertCode(() => service.preview(1, encrypted, phrase), "BACKUP_ADMIN_MISSING");
  });
  await test("broken relationships are rejected during preview", async () => {
    const doc = structuredClone(original);
    const products = doc.tables.find(t => t.name === "products")!;
    products.rows[0][products.columns.indexOf("customer_id")] = "MISSING";
    doc.stateHash = hash([doc.schemaHash, doc.tables, doc.sequences]);
    const encrypted = await encryptBackup(doc, phrase);
    await assertCode(() => service.preview(1, encrypted, phrase), "BACKUP_RELATION_BLOCKED");
  });
  await test("failed post-write verification rolls back data, sequences, FKs, triggers and sessions", async () => {
    const doc = structuredClone(original);
    const products = doc.tables.find(t => t.name === "products")!;
    products.rows[0][products.columns.indexOf("calculated")] = "1.0000";
    doc.stateHash = hash([doc.schemaHash, doc.tables, doc.sequences]);
    const encrypted = await encryptBackup(doc, phrase);
    const p = await service.preview(1, encrypted, phrase), s = await service.safety(1, p.id, phrase);
    const before = await snap();
    await sql("INSERT INTO sessions VALUES('still-valid','{\"userId\":1}')");
    await assertCode(() => apply(p.id, s.checksum), "BACKUP_VERIFICATION_FAILED");
    assert.equal((await snap()).stateHash, before.stateHash);
    assert.equal((await sql("SELECT count(*)::int AS n FROM sessions"))[0].n, 1);
  });
  await test("unsafe cross-schema relationships are refused", async () => {
    await sql("CREATE SCHEMA other; CREATE TABLE other.child(customer text REFERENCES public.customers(id))");
    await assertCode(() => service.create(1, phrase), "BACKUP_UNSAFE_SCHEMA");
    await sql("DROP SCHEMA other CASCADE");
  });
  await test("reviewed technical-table setup is idempotent and preserves business and audit records", async () => {
    const before = await snap();
    const auditCount = (await sql("SELECT count(*)::int AS n FROM data_transfer_operations"))[0].n;
    await pool.query(readFileSync("migrations/0020_data_transfer.sql", "utf8"));
    assert.equal((await snap()).stateHash, before.stateHash);
    assert.equal((await sql("SELECT count(*)::int AS n FROM data_transfer_operations"))[0].n, auditCount);
  });
  console.log(`Verified ${tests} encrypted full-database backup scenarios on disposable PostgreSQL only.`);
} finally { await pool.end(); }
