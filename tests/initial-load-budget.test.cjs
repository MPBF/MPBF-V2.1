const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { collectInitialAssets, measureAssets, assertBudget, assertLoginAssets, assetPath } = require("../scripts/lib/initial-load-budget.cjs");
const budget = require("../scripts/initial-load-budget.json");

function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "initial-budget-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaults = {
    "index.html": '<script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css">',
    "assets/main.js": 'import "./shared.js"; export { value } from "./shared.js"; const exportExcel = () => import("./xlsx.js");',
    "assets/shared.js": 'export const value = 1;',
    "assets/main.css": 'body { color: black; }',
    // Bigger than Vite's warning and our JS limit, but never initially imported.
    "assets/xlsx.js": '/*' + "large exporter ".repeat(50000) + '*/',
  };
  for (const [file, content] of Object.entries({ ...defaults, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

test("counts transitive static imports and re-exports once, excludes large dynamic exporter", t => {
  const root = fixture(t);
  const initial = collectInitialAssets(root);
  assert.deepEqual(initial, ["assets/main.css", "assets/main.js", "assets/shared.js"]);
  assertBudget(measureAssets(root, initial));
  assert.ok(fs.statSync(path.join(root, "assets/xlsx.js")).size > budget.limits.jsBytes);
});

test("detects a static exporter regression instead of ignoring all large chunks", t => {
  const root = fixture(t, { "assets/main.js": 'import "./xlsx.js";' });
  assert.throws(() => assertBudget(measureAssets(root, collectInitialAssets(root))), /jsBytes/);
});

test("follows preload, modulepreload and prefetch even without an entry import", t => {
  for (const relation of ['rel="modulepreload"', 'rel="preload" as="script"', 'rel="prefetch"']) {
    const root = fixture(t, { "index.html": `<script src="/assets/main.js"></script><link ${relation} href="/assets/xlsx.js">` });
    assert.throws(() => assertBudget(measureAssets(root, collectInitialAssets(root))), /jsBytes/);
  }
});

test("follows local CSS imports and static import cycles", t => {
  const root = fixture(t, {
    "assets/main.css": '@import "./shared.css";',
    "assets/shared.css": 'body { color: red; }',
    "assets/shared.js": 'import "./main.js"; export const value = 1;',
  });
  assert.deepEqual(collectInitialAssets(root), ["assets/main.css", "assets/main.js", "assets/shared.css", "assets/shared.js"]);
});

test("HTML unquoted attributes and CSS unquoted url imports remain budgeted", t => {
  const root = fixture(t, {
    "index.html": '<script type=module src=/assets/main.js></script><link rel=stylesheet href=/assets/main.css>',
    "assets/main.css": '@import url(shared.css); /* @import "missing.css"; */',
    "assets/shared.css": "body { color: blue; }",
  });
  assert.ok(collectInitialAssets(root).includes("assets/shared.css"));
});

test("CLI exits zero for a deferred exporter and nonzero for the eager regression", t => {
  const root = fixture(t);
  const run = () => spawnSync(process.execPath, ["scripts/check-initial-load-budget.cjs", root], { encoding: "utf8" });
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(root, "assets/main.js"), 'import "./xlsx.js";');
  const failure = run();
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Initial-load budget exceeded/);
});

test("measures real bytes and gzip of each unique response", t => {
  const root = fixture(t);
  const report = measureAssets(root, ["assets/main.js", "assets/main.js"]);
  const body = fs.readFileSync(path.join(root, "assets/main.js"));
  assert.equal(report.totals.jsBytes, body.length);
  assert.equal(report.totals.jsGzipBytes, gzipSync(body).length);
  assert.equal(report.totals.totalGzipBytes, gzipSync(body).length);
});

test("every budget allows equality and rejects one byte over", () => {
  for (const [key, maximum] of Object.entries(budget.limits)) {
    const totals = Object.fromEntries(Object.keys(budget.limits).map(name => [name, 0]));
    totals[key] = maximum;
    assert.doesNotThrow(() => assertBudget({ totals }));
    totals[key]++;
    assert.throws(() => assertBudget({ totals }), new RegExp(key));
  }
});

test("network rejects anonymous deferred JS or CSS even when below budget", t => {
  const root = fixture(t);
  const initial = collectInitialAssets(root);
  assert.deepEqual(assertLoginAssets(root, initial.map(file => "/" + file)), initial);
  for (const file of ["new-report-a1.js", "new-report-b2.css"]) {
    assert.throws(() => assertLoginAssets(root, [...initial.map(file => "/" + file), "/assets/" + file]), /unbudgeted/);
  }
});

test("network cannot silently pass an empty or partial capture", t => {
  const root = fixture(t);
  assert.throws(() => assertLoginAssets(root, []), /capture missing/);
});

test("normalizes URL query strings and rejects escaping or missing build files", t => {
  assert.equal(assetPath("/assets/main.js?v=1"), "assets/main.js");
  assert.throws(() => assetPath("../../outside.js", "assets/main.js"), /escapes/);
  const root = fixture(t, { "assets/main.js": 'import "./missing.js";' });
  assert.throws(() => collectInitialAssets(root), /ENOENT/);
});

test("fails explicitly if no entry or an external script is discovered", t => {
  assert.throws(() => collectInitialAssets(fixture(t, { "index.html": '<div id="root"></div>' })), /No initial JavaScript/);
  assert.throws(() => collectInitialAssets(fixture(t, { "index.html": '<script src="https://example.test/app.js"></script>' })), /External initial/);
});
