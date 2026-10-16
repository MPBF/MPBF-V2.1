const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "merge-setup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "mock-bin", "node_modules/.bin"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, "../scripts/post-merge.sh"), path.join(root, "scripts/post-merge.sh"));
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"test"}');
  fs.writeFileSync(path.join(root, "package-lock.json"), '{"lockfileVersion":3}');
  for (const bin of ["tsx", "vite"]) {
    fs.writeFileSync(path.join(root, "node_modules/.bin", bin), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  fs.writeFileSync(path.join(root, "mock-bin/npm"), `#!/bin/sh
echo "$*" >> npm-test.log
if [ "$1" = ci ] && [ "\${FAIL_INSTALL:-0}" = 1 ]; then exit 23; fi
if [ "$*" = "run check" ] && [ "\${FAIL_CHECK:-0}" = 1 ]; then exit 24; fi
`, { mode: 0o755 });
  const run = (env = {}) => spawnSync("bash", ["scripts/post-merge.sh"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: `${path.join(root, "mock-bin")}:${process.env.PATH}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const calls = () => fs.readFileSync(path.join(root, "npm-test.log"), "utf8").trim().split("\n");
  return { root, run, calls, stamp: path.join(root, "node_modules/.post-merge-dependencies.sha256") };
}

test("first setup installs, checks and builds; repeated setup avoids reinstall", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls(), ["ci --no-audit --no-fund", "run check", "run build", "run check", "run build"]);
  const stamp = fs.readFileSync(f.stamp, "utf8");
  assert.match(stamp, /package\.json/);
  assert.match(stamp, /package-lock\.json/);
});

for (const file of ["package.json", "package-lock.json"]) {
  test(`changing ${file} forces dependency validation again`, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    fs.appendFileSync(path.join(f.root, file), "\n");
    assert.equal(f.run().status, 0);
    assert.equal(f.calls().filter((call) => call.startsWith("ci ")).length, 2);
  });
}

test("a failed install does not stamp success or continue to checks/build", (t) => {
  const f = fixture(t);
  assert.equal(f.run({ FAIL_INSTALL: "1" }).status, 23);
  assert.equal(fs.existsSync(f.stamp), false);
  assert.deepEqual(f.calls(), ["ci --no-audit --no-fund"]);
  assert.equal(f.run().status, 0);
});

test("failed type checks stop the build and are retried on the next setup", (t) => {
  const f = fixture(t);
  assert.equal(f.run({ FAIL_CHECK: "1" }).status, 24);
  assert.deepEqual(f.calls(), ["ci --no-audit --no-fund", "run check"]);
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.calls().slice(2), ["run check", "run build"]);
});

test("legacy lock-only stamp cannot bypass manifest validation", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "node_modules/.post-merge-package-lock.sha256"), "legacy");
  assert.equal(f.run().status, 0);
  assert.equal(f.calls()[0], "ci --no-audit --no-fund");
});
