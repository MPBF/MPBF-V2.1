// Inspect the emitted build, not Vite's warning threshold or every lazy chunk.
const fs = require("node:fs");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { parse } = require("acorn");
const budget = require("../initial-load-budget.json");

function assetPath(reference, importer = "index.html") {
  if (/^(?:https?:|data:|\/\/)/i.test(reference)) return null;
  const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
  const resolved = path.posix.normalize(clean.startsWith("/") ? clean.slice(1) : path.posix.join(path.posix.dirname(importer), clean));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw Error(`Asset escapes the build directory: ${reference}`);
  }
  return resolved;
}

function htmlAssets(html) {
  const assets = [];
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attributes = {};
    for (const attribute of tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4];
    }
    if (/^<script/i.test(tag[0]) && attributes.src) assets.push(attributes.src);
    if (/^<link/i.test(tag[0]) && /^(?:stylesheet|modulepreload|preload|prefetch)$/.test(attributes.rel || "")) {
      if (attributes.href && (attributes.rel !== "preload" || /^(?:script|style)$/.test(attributes.as || ""))) {
        assets.push(attributes.href);
      }
    }
  }
  return assets;
}

function collectInitialAssets(root) {
  const seen = new Set();
  const visit = (reference, importer) => {
    const file = assetPath(reference, importer);
    if (!file) throw Error(`External initial script/style is not budgeted: ${reference}`);
    if (seen.has(file)) return;
    if (!/\.(?:m?js|css)$/.test(file)) throw Error(`Unsupported initial asset: ${file}`);
    seen.add(file);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    if (/\.m?js$/.test(file)) {
      const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
      for (const node of ast.body) {
        // Dynamic import() is intentionally excluded; the login network check
        // catches it if application code executes it before any interaction.
        if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source) {
          visit(node.source.value, file);
        }
      }
    } else {
      for (const match of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')/g)) {
        const reference = match.slice(1).find(value => value !== undefined);
        // Font-provider CSS is outside this JS/CSS bundle budget (documented).
        if (assetPath(reference, file)) visit(reference, file);
      }
    }
  };
  for (const reference of htmlAssets(fs.readFileSync(path.join(root, "index.html"), "utf8"))) visit(reference, "index.html");
  if (![...seen].some(file => /\.m?js$/.test(file))) throw Error("No initial JavaScript found; build missing or HTML format changed");
  return [...seen].sort();
}

function measureAssets(root, files) {
  const totals = { jsBytes: 0, jsGzipBytes: 0, cssBytes: 0, cssGzipBytes: 0, totalGzipBytes: 0 };
  const assets = [...new Set(files)].sort().map(file => {
    if (assetPath("/" + file) !== file) throw Error(`Invalid asset path: ${file}`);
    const body = fs.readFileSync(path.join(root, file));
    const kind = /\.m?js$/.test(file) ? "js" : /\.css$/.test(file) ? "css" : null;
    if (!kind) throw Error(`Unsupported measured asset: ${file}`);
    const bytes = body.length, gzipBytes = gzipSync(body).length;
    totals[`${kind}Bytes`] += bytes;
    totals[`${kind}GzipBytes`] += gzipBytes;
    totals.totalGzipBytes += gzipBytes;
    return { file, bytes, gzipBytes };
  });
  return { assets, totals };
}

function assertBudget(report, limits = budget.limits) {
  const failures = Object.entries(limits).filter(([key, maximum]) => report.totals[key] > maximum);
  if (failures.length) {
    throw Error("Initial-load budget exceeded:\n" + failures.map(([key, maximum]) =>
      `${key}: ${(report.totals[key] / 1000).toFixed(2)} kB > ${(maximum / 1000).toFixed(2)} kB`).join("\n") +
      "\nDefer feature imports; do not raise limits just to make the check pass.");
  }
}

function assertLoginAssets(root, requested, initial = collectInitialAssets(root)) {
  const files = [...new Set(requested.filter(file => /\.(?:m?js|css)(?:[?#]|$)/.test(file)).map(file => assetPath(file)))];
  if (files.includes(null)) throw Error("External login script/style is not budgeted");
  const unexpected = files.filter(file => !initial.includes(file));
  if (unexpected.length) throw Error(`Login downloaded deferred or unbudgeted assets: ${unexpected.join(", ")}`);
  const missing = initial.filter(file => !files.includes(file));
  if (missing.length) throw Error(`Login network capture missing initial assets: ${missing.join(", ")}`);
  assertBudget(measureAssets(root, files));
  return files;
}

module.exports = { assetPath, htmlAssets, collectInitialAssets, measureAssets, assertBudget, assertLoginAssets };
