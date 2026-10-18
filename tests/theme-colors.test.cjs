const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");
const contract = require("../scripts/lib/theme-color-contract.cjs");
const themePlugin = require("../scripts/lib/theme-tokens-postcss.cjs");
const baseline = require("./fixtures/theme-color-baseline.json");

const read = file => fs.readFileSync(path.join(contract.sourceRoot, file), "utf8");
const registry = postcss.parse(read(contract.tokenFile));
const tokens = {};
registry.walkDecls(declaration => {
  assert.equal(tokens[declaration.prop], undefined, `Duplicate token ${declaration.prop}`);
  tokens[declaration.prop] = declaration.value;
});

test("every migrated stylesheet preserves original presentation and cascade order", () => {
  assert.deepEqual(contract.cssFiles(), Object.keys(baseline.files).sort());
  for (const [file, expected] of Object.entries(baseline.files)) {
    assert.equal(contract.fingerprint(read(file), tokens), expected, file);
  }
  for (const [name, value] of Object.entries(baseline.rootDefaults)) {
    assert.equal(tokens[name], value, `Original root default ${name}`);
  }
});

test("screen CSS has no fixed colors outside the central registry", () => {
  for (const file of contract.cssFiles()) {
    postcss.parse(read(file)).walkDecls(declaration => {
      if (contract.protectedColor(file, declaration)) return;
      assert.equal(declaration.value.match(contract.colorPattern), null, `${file}: ${declaration}`);
    });
  }
});

test("every semantic reference is defined, including local palette aliases", () => {
  for (const file of contract.cssFiles()) {
    postcss.parse(read(file)).walkDecls(declaration => {
      for (const [, name] of declaration.value.matchAll(/var\((--theme-[\w-]+)/g)) {
        assert.ok(tokens[name], `${file}: ${name}`);
      }
    });
  }
  registry.walkRules(rule => assert.equal(rule.selector, ":where(:root)",
    "Defaults must not beat a theme class when its lazy chunk arrives later"));
});

test("order state defaults keep their approved green/yellow/orange/red treatment", () => {
  const expected = {
    new: ["#14583d", "#e1f2e8", "#a9d4b8"],
    production: ["#634900", "#fbf0c9", "#e2ca75"],
    completed: ["#7b381c", "#f8e4d7", "#e6b39a"],
    cancelled: ["#812c28", "#f9e2df", "#e8b4ae"],
  };
  const css = postcss.parse(read("components/OrderTable.css"));
  for (const [state, values] of Object.entries(expected)) {
    const rule = css.nodes.find(node => node.selector === `.order-status--${state}`);
    assert.deepEqual(rule.nodes.map(declaration => {
      const name = declaration.value.match(/var\(([^)]+)\)/)?.[1];
      return name ? tokens[name] : declaration.value;
    }), values);
  }
});

test("print ink, QR/product samples, and standalone documents remain literal", () => {
  const print = postcss.parse(read("components/OrderPrintPage.css"));
  print.walkDecls(declaration => {
    if (contract.protectedColor("components/OrderPrintPage.css", declaration)) {
      assert.ok(!declaration.value.includes("--theme-"), `${declaration}`);
    }
  });
  for (const file of ["components/OrderPrintSheet.tsx", "components/MasterBatchSwatch.tsx",
    "pages/production/roll-label-document.ts"]) {
    assert.ok(!read(file).includes("--theme-"), file);
  }
  assert.equal(tokens["--theme-order-print-page-opp-toolbar-copy-strong-text"], "#6a8178");
  assert.ok(read("components/OrderCreateModal.tsx").includes("bg-[var(--theme-order-create-header-surface)]"));
});

test("central defaults are emitted per chunk, not eagerly imported", async () => {
  const source = read("components/CustomerModal.css");
  const result = await postcss([themePlugin()]).process(source, {
    from: path.join(contract.sourceRoot, "components/CustomerModal.css"),
  });
  assert.ok(result.css.includes("--theme-customer-modal-customer-modal-border:"));
  assert.ok(!result.css.includes("--theme-warehouse"));
  assert.ok(result.messages.some(message => message.type === "dependency" &&
    message.file.endsWith("theme-tokens.css")), "Registry edits must invalidate lazy CSS in dev");
  for (const file of ["main.tsx", "index.css"]) assert.ok(!read(file).includes('import "./styles/theme-tokens.css"'));
});

test("production shortening is deterministic across chunks and keeps public inline tokens", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const name = "--theme-order-table-order-status-new-text";
    const publicName = "--theme-order-print-page-opp-toolbar-copy-strong-text";
    const run = async selector => (await postcss([themePlugin()]).process(
      `${selector}{color:var(${name});border-color:var(${publicName})}`,
      { from: path.join(contract.sourceRoot, "test.css") })).root;
    const first = await run(".first"), second = await run(".second");
    const value = root => root.nodes.at(-1).nodes[0].value;
    assert.equal(value(first), value(second));
    assert.match(value(first), /^var\(--_t[\da-z]+\)$/);
    assert.equal(first.nodes.at(-1).nodes[1].value, `var(${publicName})`);
    const definitions = first.nodes[0].nodes.map(node => node.prop);
    assert.equal(definitions.length, new Set(definitions).size);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("undefined semantic colors fail the build instead of silently losing colors", async () => {
  await assert.rejects(postcss([themePlugin()]).process(".example{color:var(--theme-undefined)}",
    { from: path.join(contract.sourceRoot, "test.css") }), /Undefined theme token/);
});
