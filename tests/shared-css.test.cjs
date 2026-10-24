const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");

const src = path.resolve(__dirname, "../client/src");
const read = (file) => fs.readFileSync(path.join(src, file), "utf8");
const parse = (file) => postcss.parse(read(file), { from: file });
const rootVariables = {};
parse("styles/theme-tokens.css").walkRules((rule) => {
  if (rule.selector === ":where(:root)") rule.walkDecls((decl) => { rootVariables[decl.prop] = decl.value; });
});
const normalize = (value) => value.replace(/\s+/g, "");
const resolveSharedTokens = (value) => value.replace(
  /var\((--(?:shared|theme)-[\w-]+)\)/g,
  (_, name) => {
    assert.ok(rootVariables[name], `Missing default for ${name}`);
    return rootVariables[name];
  },
);
function declarations(root, selector, media = "") {
  const result = {};
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const context = rule.parent.type === "atrule" ? rule.parent.params : "";
    if (context !== media) return;
    rule.walkDecls((decl) => {
      result[decl.prop] = normalize(resolveSharedTokens(decl.value)) + (decl.important ? "!important" : "");
    });
  });
  return result;
}
function expectRules(root, selectors, expected, media) {
  for (const selector of selectors) {
    assert.deepEqual(declarations(root, selector, media), Object.fromEntries(
      Object.entries(expected).map(([key, value]) => [key, normalize(value)]),
    ), `${selector} ${media || "base"}`);
  }
}

test("shared modal styles preserve both original presentations", () => {
  const css = parse("styles/form-primitives.css");
  expectRules(css, [".customer-modal-backdrop", ".production-order-modal-backdrop"], { padding: "18px" });
  expectRules(css, [".customer-modal-head", ".production-order-modal-head"], {
    "align-items": "flex-start!important", padding: "21px 24px!important",
    background: "linear-gradient(110deg, #f1f7f4, #fbfcf9)",
  });
  expectRules(css, [".customer-modal-head h3", ".production-order-modal-head h3"], {
    margin: "2px 0 3px!important", "font-size": "21px", color: "var(--teal-deep)",
  });
  expectRules(css, [".customer-modal-kicker", ".production-order-modal-kicker"], {
    color: "var(--teal)", "font-family": '"IBM Plex Mono", monospace', "font-size": "10px", "letter-spacing": "1px",
  });
  expectRules(css, [".customer-modal-close", ".production-order-modal-close"], {
    "min-width": "38px", "min-height": "38px", padding: "8px!important",
  });
  expectRules(css, [".customer-modal-footer", ".production-order-modal-footer"], {
    "border-top": "1px solid var(--line)", padding: "14px 24px", display: "flex",
    "justify-content": "flex-start", gap: "9px", background: "#fbfcfa",
  });
});

test("shared modal rules retain mobile overrides and customer-only alignment", () => {
  const css = parse("styles/form-primitives.css");
  expectRules(css, [".customer-modal-head", ".production-order-modal-head"], { padding: "16px!important" }, "(max-width: 700px)");
  expectRules(css, [".customer-modal-head h3", ".production-order-modal-head h3"], { "font-size": "19px" }, "(max-width: 700px)");
  expectRules(css, [".customer-modal-footer", ".production-order-modal-footer"], { padding: "13px 16px" }, "(max-width: 700px)");
  const customer = declarations(parse("components/CustomerModal.css"), ".customer-modal-backdrop", "(max-width: 700px)");
  const production = declarations(parse("components/ProductionOrderModal.css"), ".production-order-modal-backdrop", "(max-width: 700px)");
  assert.equal(customer["align-items"], "center");
  assert.equal(production["align-items"], undefined);
});

test("shared fields preserve grid spacing and label typography", () => {
  const css = parse("styles/form-primitives.css");
  expectRules(css, [".cp-field", ".order-create-field"], {
    display: "grid", "align-content": "start", gap: "6px", "min-width": "0",
  });
  expectRules(css, [".cp-field label", ".order-create-field label", ".order-line-field label"], {
    color: "#59716a", "font-size": "12px", "font-weight": "750",
  });
});

test("reduced-motion overrides stay after local animation shorthands", () => {
  for (const [file, selectors] of [
    ["components/CustomerModal.css", [".customer-modal", ".customer-modal-spinner"]],
    ["components/ProductionOrderModal.css", [".production-order-modal", ".production-order-spinner"]],
  ]) {
    expectRules(parse(file), selectors, { "animation-duration": ".01ms" }, "(prefers-reduced-motion: reduce)");
    const source = read(file);
    assert.ok(source.indexOf("@media (prefers-reduced-motion: reduce)") > source.lastIndexOf("animation:"), file);
  }
});

test("shared primitives remain lazy and precede each component's exceptions", () => {
  for (const component of ["CustomerModal", "ProductionOrderModal", "CustomerProductModal", "OrderCreateModal"]) {
    const source = read(`components/${component}.tsx`);
    const shared = source.indexOf('import "../styles/form-primitives.css"');
    assert.ok(shared >= 0 && shared < source.indexOf(`import "./${component}.css"`), component);
  }
  assert.ok(!read("main.tsx").includes("form-primitives.css"));
  assert.ok(!read("index.css").includes("form-primitives.css"));
});

test("screen-reader helpers retain every existing alias in one stylesheet", () => {
  const css = parse("styles/accessibility.css");
  const selectors = [".sr-only", ".film-operator .sr-only", ".raw-ops-sr", ".production .sr-only"];
  expectRules(css, selectors, {
    position: "absolute", width: "1px", height: "1px", padding: "0", margin: "-1px",
    overflow: "hidden", clip: "rect(0,0,0,0)", "white-space": "nowrap", border: "0",
  });
  for (const file of ["index.css", "pages/production/production.css", "pages/production/raw-operations.css",
    "pages/production/roll-labels.css", "pages/warehouse/receipt-voucher.css"]) {
    for (const selector of selectors) assert.deepEqual(declarations(parse(file), selector), {}, `${file}: ${selector}`);
  }
  const entry = read("main.tsx");
  assert.ok(entry.indexOf('import "./styles/accessibility.css"') >= 0);
  assert.ok(entry.indexOf('import "./styles/accessibility.css"') < entry.indexOf('import "./index.css"'));
});
