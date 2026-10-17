// Screen colors are themeable; document ink and physical product colors are not.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const postcss = require("postcss");

const sourceRoot = path.resolve(__dirname, "../../client/src");
const tokenFile = "styles/theme-tokens.css";
const colorPattern = /#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/gi;
function cssFiles() {
  return ["index.css", ...["components", "pages", "styles"].flatMap(directory =>
    fs.readdirSync(path.join(sourceRoot, directory), { recursive: true })
      .filter(file => file.endsWith(".css"))
      .map(file => `${directory}/${file}`))].filter(file => file !== tokenFile).sort();
}
function protectedColor(file, declaration) {
  let node = declaration.parent;
  while (node) {
    if (node.type === "atrule" && node.name === "media" && /\bprint\b/.test(node.params)) return true;
    node = node.parent;
  }
  // These entire stylesheets belong to paper documents or physical color samples.
  if (/receipt-voucher|MasterBatchSwatch/.test(file)) return true;
  if (file.endsWith("OrderPrintPage.css")) {
    if (declaration.prop.startsWith("--opp-")) return true;
    const selector = declaration.parent.selector || "";
    return !/^\.opp-(?:page|toolbar|print-action|print-error)/.test(selector);
  }
  return false;
}
function fingerprint(source, tokens = {}) {
  const root = postcss.parse(source);
  function expand(value, chain = []) {
    return value.replace(/var\((--theme-[\w-]+)\)/g, (_, name) => {
      if (!tokens[name]) throw Error(`Missing token ${name}`);
      if (chain.includes(name)) throw Error(`Cyclic token ${name}`);
      return expand(tokens[name], [...chain, name]);
    });
  }
  root.walkDecls(declaration => {
    declaration.value = expand(declaration.value);
  });
  // AST structure, declaration order, !important, media contexts and selectors
  // all participate. Formatting and comments do not affect presentation.
  function serialize(node) {
    if (node.type === "comment") return null;
    if (node.type === "rule" && node.selector === ":root") return null;
    if (node.type === "decl" && node.prop.startsWith("--theme-")) return null;
    if (node.type === "decl") return [node.type, node.prop, node.value.replace(/\s+/g, ""), !!node.important];
    return [node.type, node.selector || node.name || "", node.params || "",
      (node.nodes || []).map(serialize).filter(Boolean)];
  }
  return crypto.createHash("sha256").update(JSON.stringify(serialize(root))).digest("hex");
}
module.exports = { sourceRoot, tokenFile, colorPattern, cssFiles, protectedColor, fingerprint };
