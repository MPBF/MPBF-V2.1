import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { auditEnglish, hasArabic, isValidEnglish } from "./lib/i18n-audit.mjs";

const sourceRoot = path.resolve("client/src");
const reviewedOverrides = JSON.parse(fs.readFileSync(new URL("./i18n-reviewed-overrides.json", import.meta.url), "utf8"));
const audit = auditEnglish(sourceRoot, reviewedOverrides);
const englishKeys = new Set(Object.entries(audit.effective).filter(([, value]) => isValidEnglish(value)).map(([key]) => key));
const missing = new Map();
const files = [];

function collectFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(filePath);
    else if (/\.(ts|tsx)$/.test(filePath) && !entry.name.startsWith("i18n-en")) files.push(filePath);
  }
}

function visitSource(node, sourceFile) {
  // Configuration labels, tuple options, and error strings also reach translate
  // indirectly. Literal translate(...) calls alone missed those regressions.
  if (ts.isStringLiteral(node) && /[ء-ي]/.test(node.text) && !englishKeys.has(node.text)) {
    const explicitMetadata = path.basename(sourceFile.fileName) === "i18n.ts"
      && ["MPBF | نظام تشغيل المصنع", "نظام MPBF لإدارة العملاء والطلبات والإنتاج والماكينات"].includes(node.text);
    if (!explicitMetadata) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const file = path.relative(sourceRoot, sourceFile.fileName).split(path.sep).join("/");
      missing.set(node.text, `${file}:${location} :: ${node.text}`);
    }
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "translate") {
    const argument = node.arguments[0];
    if (argument && ts.isStringLiteral(argument) && hasArabic(argument.text) && !englishKeys.has(argument.text)) {
      const key = argument.text;
      const location = sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile)).line + 1;
      const file = path.relative(sourceRoot, sourceFile.fileName).split(path.sep).join("/");
      missing.set(key, `${file}:${location} :: ${key}`);
    }
  }
  ts.forEachChild(node, (child) => visitSource(child, sourceFile));
}

collectFiles(sourceRoot);
for (const filePath of files) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  visitSource(sourceFile, sourceFile);
}

console.log(`English dictionary merge order: ${audit.mergeOrder.join(" -> ")}`);
console.log(`English dictionary errors: ${audit.errors.length}`);
for (const error of audit.errors) console.error(error);
for (const conflict of audit.conflicts.filter((entry) => entry.reviewed)) {
  console.log(`Reviewed override: ${JSON.stringify(conflict.key)} :: ${conflict.from.file} ${JSON.stringify(conflict.from.value)} -> ${conflict.to.file} ${JSON.stringify(conflict.to.value)}`);
}
console.log(`Missing English entries: ${missing.size}`);
console.log([...missing.values()].sort().join("\n"));
if (missing.size || audit.errors.length) process.exitCode = 1;