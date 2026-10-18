const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");

const tokenPath = path.resolve(__dirname, "../../client/src/styles/theme-tokens.css");

// Keep one editable registry without downloading every feature's defaults at login.
// This plugin adds only the tokens used by this stylesheet to its existing chunk.
module.exports = () => ({
  postcssPlugin: "scoped-theme-defaults",
  OnceExit(root, { result }) {
    if (!root.source?.input.file || root.source.input.file === tokenPath) return;
    const registry = postcss.parse(fs.readFileSync(tokenPath, "utf8"), { from: tokenPath });
    const known = new Set();
    registry.walkDecls(declaration => known.add(declaration.prop));
    const needed = new Set();
    const references = value => {
      for (const match of value.matchAll(/var\((--[\w-]+)/g)) {
        if (known.has(match[1])) needed.add(match[1]);
        else if (match[1].startsWith("--theme-")) throw root.error(`Undefined theme token ${match[1]}`);
      }
    };
    root.walkDecls(declaration => references(declaration.value));
    if (!needed.size) return;
    // Resolve aliases transitively, including aliases introduced by future themes.
    let previousSize;
    do {
      previousSize = needed.size;
      registry.walkDecls(declaration => {
        if (needed.has(declaration.prop)) references(declaration.value);
      });
    } while (previousSize !== needed.size);
    const defined = new Set();
    const defaults = [];
    registry.walkRules(rule => {
      const declarations = rule.nodes.filter(node => node.type === "decl" && needed.has(node.prop));
      if (!declarations.length) return;
      const copy = postcss.rule({ selector: rule.selector });
      for (const declaration of declarations) {
        copy.append(declaration.clone());
        defined.add(declaration.prop);
      }
      defaults.push(copy);
    });
    for (const name of needed) {
      if (!defined.has(name)) throw root.error(`Undefined theme token ${name}`);
    }
    root.prepend(defaults);
    // Compact internal names in built CSS, keeping the editable registry semantic.
    // Leave the one public token used by a React inline style readable at runtime.
    // Mapping uses registry order, never per-chunk order, so lazy chunks agree.
    if (process.env.NODE_ENV === "production") {
      const names = new Map([...known].filter(name => name.startsWith("--theme-"))
        .filter(name => name !== "--theme-order-print-page-opp-toolbar-copy-strong-text")
        .map((name, index) => [name, `--_t${index.toString(36)}`]));
      root.walkDecls(declaration => {
        declaration.prop = names.get(declaration.prop) || declaration.prop;
        declaration.value = declaration.value.replace(/var\((--theme-[\w-]+)/g,
          (match, name) => names.has(name) ? `var(${names.get(name)}` : match);
      });
    }
    result.messages.push({ type: "dependency", plugin: "scoped-theme-defaults", file: tokenPath, parent: root.source.input.file });
  },
});
