import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { hasArabic, isValidEnglish } from "./i18n-audit.mjs";

export const localCopyFiles = [
  "pages/production/RawMixingPage.tsx",
  "pages/production/ProductionMonitoringPage.tsx",
  "pages/warehouse/RawInventoryPage.tsx",
  "pages/warehouse/ReceiptVoucherModal.tsx",
  "lib/receipt-print.ts",
];

// Context keys are needed only where a shared Arabic label has different,
// intentional English wording. They must remain literal dictionary entries.
export const localCopyKey = (file, arabic, id = arabic) =>
  `[${path.basename(file).replace(/\.tsx?$/, "")}.${id}] ${arabic}`;

/** Extract the bilingual forms actually used by these screens, not comments. */
export function collectLocalCopy(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const pairs = [];
  const errors = source.parseDiagnostics.map(d =>
    `${file}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  function add(arabic, english, node) {
    if (!hasArabic(arabic)) return;
    const location = `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    if (!isValidEnglish(english)) errors.push(`${location}: invalid local English copy for ${JSON.stringify(arabic)}`);
    const parent = node.parent;
    const id = ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
      ? parent.name.text : arabic;
    pairs.push({ file, arabic, english, id, location });
  }
  function visit(node) {
    if (ts.isArrayLiteralExpression(node)) {
      const ar = literal(node.elements[0]), en = literal(node.elements[1]);
      if (ar !== undefined && hasArabic(ar) && node.elements.length !== 2) {
        errors.push(`${file}: unsupported bilingual tuple; use two literal strings`);
      } else if (ar !== undefined && en !== undefined) add(ar, en, node);
      else if (ar !== undefined && hasArabic(ar)) errors.push(`${file}: unsupported bilingual tuple; use two literal strings`);
    }
    if (ts.isConditionalExpression(node)) {
      const first = literal(node.whenTrue), second = literal(node.whenFalse);
      if (first !== undefined && second !== undefined) {
        if (hasArabic(first)) add(first, second, node);
        else if (hasArabic(second)) add(second, first, node);
      } else if ((first !== undefined && hasArabic(first)) || (second !== undefined && hasArabic(second))) {
        errors.push(`${file}: unsupported bilingual conditional; use two literal strings`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "label") {
      const ar = literal(node.arguments[0]), en = literal(node.arguments[1]);
      if (ar !== undefined && en !== undefined) add(ar, en, node);
      else errors.push(`${file}: unsupported bilingual label call; use two literal strings`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { pairs, errors };
}

/** Compare with the final resource, so later dictionary spreads cannot hide drift. */
export function auditLocalCopy(sourceRoot, effective, files = localCopyFiles) {
  const pairs = [], errors = [];
  for (const file of files) {
    const absolute = path.join(sourceRoot, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${file}: missing local-copy source`);
      continue;
    }
    const collected = collectLocalCopy(file, fs.readFileSync(absolute, "utf8"));
    errors.push(...collected.errors);
    pairs.push(...collected.pairs);
    if (!collected.pairs.length) errors.push(`${file}: no bilingual copy found; update the local-copy audit for the new source format`);
  }
  for (const pair of pairs) {
    const context = localCopyKey(pair.file, pair.arabic, pair.id);
    const key = Object.hasOwn(effective, context) ? context : pair.arabic;
    if (effective[key] !== pair.english) {
      errors.push(`${pair.location}: English copy mismatch for ${JSON.stringify(pair.arabic)}: screen ${JSON.stringify(pair.english)}, dictionary ${JSON.stringify(effective[key] ?? null)}`);
    }
  }
  const contexts = new Set(pairs.map(pair => localCopyKey(pair.file, pair.arabic, pair.id)));
  const scopes = files.map(file => `[${path.basename(file).replace(/\.tsx?$/, "")}.`);
  for (const key of Object.keys(effective)) {
    if (scopes.some(scope => key.startsWith(scope)) && !contexts.has(key)) {
      errors.push(`Stale local-copy context: ${JSON.stringify(key)}; update or remove it`);
    }
  }
  return { pairs, errors };
}
