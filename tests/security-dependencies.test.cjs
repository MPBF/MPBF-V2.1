const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const pruned = new Set(["node_modules", ".git", "vendor", ".venv", "venv", "target", "dist", "build", ".next", ".cache"]);
const reported = {
  braces: ["3.0.3"], "proxy-addr": ["2.0.7"], qs: ["6.15.3"],
  "@modelcontextprotocol/sdk": ["1.30.0"], axios: ["1.18.1", "1.19.0"],
  "brace-expansion": ["1.1.18", "2.1.4", "5.0.9"], compression: ["1.8.1"],
  dompurify: ["3.4.12", "3.4.15"], "fast-copy": ["4.0.4"],
  "fast-uri": ["3.1.4", "4.1.4"], "ip-address": ["10.3.1"], multer: ["2.3.0"],
  nodemailer: ["10.0.1"], "postcss-selector-parser": ["6.0.10", "6.1.3", "6.1.4"],
  "source-map-js": ["1.2.1"], "sprintf-js": ["1.0.3", "1.1.3"], xlsx: ["0.20.3"],
  "@xmldom/xmldom": ["0.8.13"], esbuild: ["0.18.20"], handlebars: ["4.7.9"],
  hono: ["4.12.32"], "js-yaml": ["3.15.0", "4.3.0"], nanoid: ["3.3.16"],
  uuid: ["8.3.2", "9.0.1"],
};

function* manifests(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !pruned.has(entry.name)) yield* manifests(file);
    else if (entry.isFile() && ["package.json", "package-lock.json", "pnpm-lock.yaml", "npm-shrinkwrap.json"].includes(entry.name)) yield file;
  }
}

test("filesystem-discovered project manifests and locks contain none of the reported package/version pins", () => {
  const failures = [];
  let count = 0;
  for (const file of manifests(root)) {
    count++;
    // Still discover editor manifests, but never treat an installed editor's
    // bundled distribution as a project we can reinstall or ship.
    if (path.relative(root, file).split(path.sep)[0] === ".config") continue;
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".yaml")) {
      for (const [name, versions] of Object.entries(reported)) {
        for (const version of versions) {
          const escaped = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp(`^ {2}['"]?${escaped}(?=[:('"]|$)`, "m").test(text)) failures.push(`${file}: ${name}@${version}`);
        }
      }
      continue;
    }
    const manifest = JSON.parse(text);
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })) {
      if (reported[name]?.includes(version)) failures.push(`${file}: ${name}@${version}`);
    }
    for (const [location, entry] of Object.entries(manifest.packages ?? {})) {
      const name = entry.name ?? location.split("node_modules/").at(-1);
      if (reported[name]?.includes(entry.version)) failures.push(`${file}: ${name}@${entry.version}`);
    }
  }
  assert.ok(count >= 5, "must inspect nested manifests, not only the application root");
  assert.deepEqual(failures, []);
});

test("the actual micromatch braces consumer retains normal behavior and bounds nesting", () => {
  const consumer = createRequire(require.resolve("micromatch"));
  const braces = consumer("braces");
  assert.deepEqual(braces.expand("file-{1..3}"), ["file-1", "file-2", "file-3"]);
  assert.equal(braces.compile("file-{a,b}.{js,ts}"), "file-(a|b).(js|ts)");
  const hostile = "{".repeat(4000) + "a,b" + "}".repeat(4000);
  for (const api of ["parse", "compile", "expand", "stringify"]) {
    assert.throws(() => braces[api](hostile), /depth/i, api);
    assert.throws(() => braces[api](hostile, { maxDepth: Infinity }), /depth/i, `${api}: cannot disable the cap`);
  }
});

test("all installed minimatch major lines retain brace matching after scoped upgrades", () => {
  for (const owner of ["eslint", "readdir-glob", "@typescript-eslint/typescript-estree"]) {
    const consumer = createRequire(require.resolve(owner));
    const imported = consumer("minimatch");
    const match = typeof imported === "function" ? imported : imported.minimatch;
    assert.equal(match("file.js", "file.{js,ts}"), true, owner);
    assert.equal(match("file.css", "file.{js,ts}"), false, owner);
  }
});

test("Mammoth's CLI still accepts its legacy argument API without sprintf-js", () => {
  const output = execFileSync(process.execPath, [path.join(root, "node_modules/mammoth/bin/mammoth"), "--help"], { encoding: "utf8" });
  assert.match(output, /--output-format/);
  assert.match(output, /docx-path/);
  const consumer = createRequire(require.resolve("mammoth"));
  assert.equal(consumer("argparse/package.json").version, "2.0.1");
  assert.throws(() => consumer.resolve("sprintf-js"), { code: "MODULE_NOT_FOUND" });
});
