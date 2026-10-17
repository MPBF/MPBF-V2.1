const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

// Exact affected releases from the dependency findings. Check resolved versions,
// not dependency ranges in a parent's metadata, which overrides may supersede.
const affected = {
  "sprintf-js": ["1.0.3", "1.1.3"],
  axios: ["1.18.1", "1.19.0"],
  xlsx: ["0.20.3"],
  "@xmldom/xmldom": ["0.8.13"],
  hono: ["4.12.32"],
  "brace-expansion": ["1.1.18", "2.1.4", "5.0.9"],
  "proxy-addr": ["2.0.7"],
  uuid: ["8.3.2", "9.0.1"],
  "fast-uri": ["3.1.4", "4.1.4"],
  handlebars: ["4.7.9"],
  esbuild: ["0.18.20"],
  "ip-address": ["10.3.1"],
  nodemailer: ["10.0.1"],
  dompurify: ["3.4.12", "3.4.15"],
  "fast-copy": ["4.0.4"],
  compression: ["1.8.1"],
  "postcss-selector-parser": ["6.0.10", "6.1.3", "6.1.4"],
  "source-map-js": ["1.2.1"],
  "@modelcontextprotocol/sdk": ["1.30.0"],
  "js-yaml": ["3.15.0", "4.3.0"],
  qs: ["6.15.3"],
  nanoid: ["3.3.16"],
  braces: ["3.0.3"],
  multer: ["2.3.0"],
};

// Prune before descending. Editor distributions and generated language-server
// caches are vendor/build outputs, not deployable application projects.
const pruned = new Set([
  "node_modules", ".git", "vendor", ".venv", "venv", "target", "dist", "build",
  ".next", ".cache", ".config", ".npm", "generated-artifacts",
]);
function manifests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return pruned.has(entry.name) ? [] : manifests(file);
    return entry.isFile() && ["package.json", "package-lock.json", "pnpm-lock.yaml"].includes(entry.name) ? [file] : [];
  });
}
function checkVersion(file, name, version) {
  assert.ok(!affected[name]?.includes(version), `${file} still pins ${name}@${version}`);
}

test("all application and nested tooling manifests/locks exclude the affected releases", () => {
  const files = manifests(path.resolve(__dirname, ".."));
  assert.ok(files.some(file => file.endsWith("packages/shared/package.json")));
  assert.ok(files.some(file => file.endsWith(".agents/skills/brainstorming/scripts/package-lock.json")));
  const yaml = createRequire(require.resolve("@eslint/eslintrc"))("js-yaml");
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith("pnpm-lock.yaml")) {
      const lock = yaml.load(text);
      for (const key of Object.keys(lock.packages ?? {})) {
        const separator = key.lastIndexOf("@");
        checkVersion(file, key.slice(0, separator), key.slice(separator + 1));
      }
    } else {
      const manifest = JSON.parse(text);
      if (file.endsWith("package-lock.json")) {
        for (const [location, pkg] of Object.entries(manifest.packages ?? {})) {
          checkVersion(file, pkg.name ?? location.split("node_modules/").pop(), pkg.version);
        }
      } else {
        for (const [name, spec] of Object.entries({
          ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies,
        })) checkVersion(file, name, spec.replace(/^[~^]/, ""));
      }
    }
  }
});

for (const parent of ["chokidar", "micromatch"]) {
  const braces = createRequire(require.resolve(parent))("braces");
  test(`${parent} uses a brace parser with bounded nesting and unchanged ordinary globs`, () => {
    assert.deepEqual(braces.expand("src/{client,server}/file{1..2}.ts"), [
      "src/client/file1.ts", "src/client/file2.ts", "src/server/file1.ts", "src/server/file2.ts",
    ]);
    assert.equal(braces.compile("src/{client,server}/*.ts"), "src/(client|server)/*.ts");
    assert.equal(braces.stringify(braces.parse("src/{a,b}")), "src/{a,b}");
    for (const input of [
      "{".repeat(3000) + "a,b" + "}".repeat(3000),
      "(".repeat(3000) + "a" + ")".repeat(3000),
    ]) {
      for (const method of ["parse", "compile", "expand", "stringify"]) {
        assert.throws(() => braces[method](input), /exceeds max depth/);
        assert.throws(() => braces[method](input, { maxDepth: Infinity }), /exceeds max depth/);
      }
    }
    let ast = { type: "text", value: "x" };
    for (let i = 0; i < 3000; i++) ast = { type: "paren", nodes: [ast] };
    ast = { type: "root", nodes: [ast] };
    for (const method of ["compile", "expand", "stringify"]) {
      assert.throws(() => braces[method](ast), /exceeds max depth/);
    }
  });
}

test("Mammoth CLI still works with the sprintf-free argparse override", () => {
  const mammothRequire = createRequire(require.resolve("mammoth"));
  assert.equal(mammothRequire("argparse/package.json").version, "2.0.1");
  const help = execFileSync(process.execPath, [
    path.join(path.dirname(require.resolve("mammoth/package.json")), "bin/mammoth"), "--help",
  ], { encoding: "utf8" });
  assert.match(help, /docx-path/);
  assert.match(help, /--output-format/);
});

test("document conversion and patched validation dependencies retain their runtime APIs", async () => {
  const { Document, Packer, Paragraph } = require("docx");
  const document = new Document({ sections: [{ children: [new Paragraph("Security compatibility check")] }] });
  const bytes = await Packer.toBuffer(document);
  const html = await require("mammoth").convertToHtml({ buffer: bytes });
  assert.match(html.value, /Security compatibility check/);
  const Ajv = require("ajv");
  const validate = new Ajv().compile({ type: "string", format: undefined });
  assert.equal(validate("ok"), true);
  assert.equal(validate(1), false);
  assert.doesNotThrow(() => require("eslint"));
  assert.doesNotThrow(() => require("mssql"));
});
