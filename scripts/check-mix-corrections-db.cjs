// Real service, locks and conservation triggers on disposable PostgreSQL only.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { build } = require("esbuild");
const { Pool } = require("pg");

(async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "mix-corrections-db-")), data = path.join(temp, "data");
  let pool, started = false, checks = 0;
  const check = (name, actual, expected = true) => {
    assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
  };
  const rejected = async (name, fn, status = 409) => {
    await assert.rejects(async () => fn(), error => error.status === status); checks++; console.log(`PASS ${name}`);
  };
  const key = () => ({ request_id: randomUUID() });
  try {
    await build({ entryPoints: ["server/production/mixing.ts", "server/production/mix-consumption.ts", "server/production/monitoring.ts", "server/production/mix-revision-history.ts"],
      bundle: true, platform: "node", format: "cjs", outdir: temp, logLevel: "silent" });
    // esbuild follows the input filenames; .js outputs are CommonJS in /tmp.
    const { RawMixingService } = require(path.join(temp, "mixing.js"));
    const { consumeMixes, lockMixMachine } = require(path.join(temp, "mix-consumption.js"));
    const { ProductionMonitoringService } = require(path.join(temp, "monitoring.js"));
    const { mixRevisionHistory } = require(path.join(temp, "mix-revision-history.js"));
    execFileSync("initdb", ["-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", path.join(temp, "postgres.log"), "-o",
      `-k ${temp} -p 16546 -c listen_addresses='' -c fsync=off`, "-w", "start"], { stdio: "pipe" });
    started = true;
    pool = new Pool({ host: temp, port: 16546, database: "postgres", user: os.userInfo().username, max: 12 });
    await pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY,username text,display_name text,display_name_ar text,full_name text);
      CREATE TABLE machines(id varchar(20) PRIMARY KEY,name text,name_ar text,type text,status text,screw_type text);
      CREATE TABLE categories(id varchar(20) PRIMARY KEY,name text,name_ar text);
      CREATE TABLE items(id varchar(20) PRIMARY KEY,category_id varchar(20),code text,name text,name_ar text,status text);
      CREATE TABLE factory_operations(actor_id integer,request_id uuid,operation text,fingerprint text,result jsonb,
        PRIMARY KEY(actor_id,request_id));
      CREATE TABLE factory_rolls(id serial PRIMARY KEY,film_machine_id varchar(20),created_at timestamptz DEFAULT clock_timestamp(),
        created_by integer,weight_kg numeric(14,2),printing_machine_id varchar(20),printed_by integer,printed_at timestamptz,
        cutting_machine_id varchar(20),cut_by integer,cut_completed_at timestamptz,net_weight_kg numeric(14,2),waste_kg numeric(14,2));
      INSERT INTO users VALUES(1,'admin','Admin','مدير','مدير'),(2,'film','Film','مشغل','مشغل'),(3,'manager','Manager','مدير خلط','مدير');
      INSERT INTO machines VALUES('F1','Film 1','فيلم 1','extruder','active','A'),
        ('F2','Film 2','فيلم 2','extruder','active','ABA'),('P1','Printer','طابعة','Printer','active',NULL);
      INSERT INTO categories VALUES('RAW','Raw materials','خام');
      INSERT INTO items VALUES('I1','RAW','HD','HD','خام 1','active'),('I2','RAW','LD','LD','خام 2','active');
    `);
    for (const file of ["0014_raw_material_mixing.sql", "0015_raw_catalogue_movements.sql", "0017_raw_mixing_screws.sql"])
      await pool.query(readFileSync(`migrations/${file}`, "utf8"));
    await pool.query("INSERT INTO factory_mixes(machine_id,created_by,total_kg,screw) VALUES('F1',2,10,'A')");
    await pool.query(readFileSync("migrations/0018_production_monitoring.sql", "utf8"));
    await pool.query(readFileSync("migrations/0023_mix_corrections.sql", "utf8"));
    await pool.query(readFileSync("migrations/0023_mix_corrections.sql", "utf8"));
    const service = new RawMixingService(pool);
    const admin = { id: 1, permissions: ["admin"] }, film = { id: 2, permissions: ["operate_film"] },
      manager = { id: 3, permissions: ["manage_mixing"] };
    let state = await service.state(admin);
    const [a, b] = state.materials.map(m => m.id);
    const balance = async () => (await pool.query("SELECT quantity_kg::text FROM factory_raw_materials ORDER BY id")).rows.map(r => r.quantity_kg);
    const record = async (items = [{ material_id: a, quantity_kg: "10.25" }], machine_id = "F1", screw = "A") =>
      service.record(film, { ...key(), machine_id, screw, items });
    const mixed = await record();
    check("initial actual debit permits negative stock", await balance(), ["-10.25", "0.00"]);
    const edit = { ...key(), expected_revision: 0, notes: "corrected",
      contents: { machine_id: "F1", screw: "A", items: [{ material_id: a, quantity_kg: "15.30" }, { material_id: b, quantity_kg: "2.10" }] } };
    const changed = await service.update(manager, mixed.id, edit);
    check("edit deducts exact signed deltas", await balance(), ["-15.30", "-2.10"]);
    check("revision advances once", changed.revision, 1);
    check("lost edit response replays same result", await service.update(manager, mixed.id, edit), changed);
    check("replay never double deducts", await balance(), ["-15.30", "-2.10"]);
    check("original debit retained", (await pool.query("SELECT quantity_kg::text FROM factory_raw_movements WHERE mix_id=$1", [mixed.id])).rows, [{ quantity_kg: "-10.25" }]);
    check("correction ledger signed decimals", (await pool.query("SELECT quantity_kg::text FROM factory_mix_stock_adjustments ORDER BY material_id")).rows.map(r => r.quantity_kg), ["-5.05", "-2.10"]);
    check("audit preserves original creator and old items",
      (await pool.query("SELECT before_data->>'created_by' actor,before_data->'items'->0->>'quantity_kg' quantity FROM factory_mix_revisions")).rows,
      [{ actor: "2", quantity: "10.25" }]);
    await rejected("stale edit never overwrites", () => service.update(admin, mixed.id, { ...edit, ...key() }));
    await rejected("film operator cannot edit", () => service.update(film, mixed.id, { ...key(), expected_revision: 1, notes: "bad" }), 403);
    await rejected("film operator cannot delete", () => service.delete(film, mixed.id, { ...key(), expected_revision: 1 }), 403);
    const moved = await service.update(admin, mixed.id, { ...key(), expected_revision: 1,
      contents: { machine_id: "F2", screw: "B", items: [{ material_id: b, quantity_kg: "0.05" }] } });
    check("removed ingredients refunded and machine changed", await balance(), ["0.00", "-0.05"]);
    check("edited total and identity", (await pool.query("SELECT machine_id,screw,total_kg::text FROM factory_mixes WHERE id=$1", [mixed.id])).rows, [{ machine_id: "F2", screw: "B", total_kg: "0.05" }]);
    const del = { ...key(), expected_revision: moved.revision };
    const deleted = await service.delete(manager, mixed.id, del);
    check("delete refunds current recipe once", await balance(), ["0.00", "0.00"]);
    check("lost delete response replays", await service.delete(manager, mixed.id, del), deleted);
    check("deleted hidden from history and latest recipe", (await service.state(admin)).records.some(r => r.id === mixed.id), false);
    check("deleted excluded from monitoring list", (await new ProductionMonitoringService(pool).mixes(admin)).records.some(r => r.id === mixed.id), false);
    check("cancelled quantities excluded from machine mixed totals",
      (await new ProductionMonitoringService(pool).summary(admin)).machines.find(m => m.machine_id === "F2").mixed_kg, "0");
    check("soft delete retains original recipe and actor", (await pool.query("SELECT count(*)::int n FROM factory_mix_items WHERE mix_id=$1", [mixed.id])).rows[0].n, 1);
    const beforeHistoryRead = await balance();
    const history = await mixRevisionHistory(pool, manager, mixed.id);
    check("audit includes cancellation and revisions newest-first", history.records.map(r => [r.revision, r.action]),
      [[3, "delete"], [2, "edit"], [1, "edit"]]);
    check("audit executor comes from correction not original mixing operator", history.records.map(r => r.created_by), [3, 1, 3]);
    check("audit resolves bilingual material labels", history.records[2].before_data.items[0],
      { material_id: a, code: "HD", name: "HD", name_ar: "خام 1", quantity_kg: "10.25" });
    check("audit retains prior machine and changed screw", [
      history.records[1].before_data.machine_id, history.records[1].after_data.machine_id,
      history.records[1].before_data.screw, history.records[1].after_data.screw,
    ], ["F1", "F2", "A", "B"]);
    check("audit cancellation has saved pre-cancel materials and no post-cancel materials",
      [history.records[0].before_data.items[0].quantity_kg, history.records[0].after_data.items.length], ["0.05", 0]);
    check("audit returns historical signed stock decimals not current balance", history.records[2].stock_adjustments.map(a => [a.quantity_kg, a.balance_after_kg]),
      [["-5.05", "-15.30"], ["-2.10", "-2.10"]]);
    check("audit does not change stock", await balance(), beforeHistoryRead);
    check("audit cursor can continue inside same cancelled mix", (await mixRevisionHistory(pool, admin, mixed.id, [mixed.id, 3])).records.map(r => r.revision), [2, 1]);
    await rejected("film operator cannot access audit reader", () => mixRevisionHistory(pool, film), 403);
    await rejected("second independent delete cannot refund twice", () => service.delete(admin, mixed.id, { ...key(), expected_revision: 3 }));
    await rejected("legacy cannot be proven unused", () => service.delete(admin, 1, { ...key(), expected_revision: 0 }));
    await service.update(manager, 1, { ...key(), expected_revision: 0, notes: "legacy note" });
    check("legacy notes can be corrected without inventory movement", await balance(), ["0.00", "0.00"]);
    const notesAudit = (await mixRevisionHistory(pool, admin, 1)).records[0];
    check("audit shows notes-only change without stock adjustments", [notesAudit.after_data.notes, notesAudit.stock_adjustments], ["legacy note", []]);
    const available = await record([{ material_id: a, quantity_kg: "20.00" }]);
    const consume = async (machineId, weight, hold) => {
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await lockMixMachine(tx, machineId);
        const r = (await tx.query("INSERT INTO factory_rolls(film_machine_id,created_by,weight_kg) VALUES($1,2,$2) RETURNING id", [machineId, weight])).rows[0];
        const result = await consumeMixes(tx, r.id, machineId, weight);
        if (hold) await hold();
        await tx.query("COMMIT"); return result;
      } catch (error) { await tx.query("ROLLBACK"); throw error; }
      finally { tx.release(); }
    };
    const consumed = await consume("F1", "5.00");
    check("cancelled mix never enters FIFO", consumed, { consumed_kg: "5.00", uncovered_kg: "0.00" });
    await rejected("used mix cannot change contents", () => service.update(admin, available.id, { ...edit, ...key() }));
    await rejected("used mix cannot delete", () => service.delete(admin, available.id, { ...key(), expected_revision: 0 }));
    const beforeNote = await balance();
    await service.update(admin, available.id, { ...key(), expected_revision: 0, notes: "consumed note" });
    check("used-mix note leaves stock unchanged", await balance(), beforeNote);
    check("used history flagged notes-only", (await service.state(admin)).records.find(r => r.id === available.id).can_edit_contents, false);
    const concurrent = await record([{ material_id: a, quantity_kg: "1.00" }], "F2", "A");
    const results = await Promise.allSettled([
      service.delete(admin, concurrent.id, { ...key(), expected_revision: 0 }),
      service.delete(manager, concurrent.id, { ...key(), expected_revision: 0 }),
    ]);
    check("simultaneous deletes commit one refund", results.map(r => r.status).sort(), ["fulfilled", "rejected"]);
    const beforeRace = await balance();
    let releaseHeld, startedHeld;
    const locked = new Promise(resolve => { startedHeld = resolve; });
    const held = new Promise(resolve => { releaseHeld = resolve; });
    const racing = await record([{ material_id: a, quantity_kg: "1.00" }], "F2", "A");
    const writer = consume("F2", "0.50", async () => { startedHeld(); await held; });
    await locked;
    const deletion = service.delete(admin, racing.id, { ...key(), expected_revision: 0 });
    releaseHeld(); await writer;
    await rejected("in-flight film allocation blocks racing deletion after lock", () => deletion);
    check("race never refunds used raw", await balance(), [(Number(beforeRace[0]) - 1).toFixed(2), beforeRace[1]]);
    const invalid = await record();
    const beforeInvalid = await balance();
    await rejected("invalid material correction rolls back", () => service.update(admin, invalid.id, { ...edit, ...key(), contents: {
      machine_id: "F1", screw: "A", items: [{ material_id: 999, quantity_kg: "1.00" }],
    } }), 400);
    check("rollback leaves all balances", await balance(), beforeInvalid);
    check("no extra warehouse vouchers", (await pool.query("SELECT count(*)::int n FROM factory_raw_vouchers")).rows[0].n, 0);
    console.log(`Mix corrections passed ${checks} real-DB checks.`);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
