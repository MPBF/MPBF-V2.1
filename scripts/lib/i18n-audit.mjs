import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const hasArabic = (value) => /\p{Script=Arabic}/u.test(value);
export const isValidEnglish = (value) => typeof value === "string" && !!value.trim() && !hasArabic(value);
const dictionaryPattern = /^i18n-en(?:-[a-z0-9-]+)?\.ts$/i;

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) {
    node = node.expression;
  }
  return node;
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

function objectProperty(object, name) {
  object = unwrap(object);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  return object.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p.name) === name)?.initializer;
}

/** Inspect the actual init resource expression without executing browser code. */
export function auditEnglish(sourceRoot, reviewedOverrides = []) {
  const errors = [];
  const conflicts = [];
  const dictionaries = [];
  const effective = new Map();
  const usedReviews = new Set();
  const sources = new Map();
  function read(file) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(sourceRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
    sources.set(file, source);
    for (const diagnostic of source.parseDiagnostics) {
      errors.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
    return source;
  }
  function location(file, node) {
    const source = sources.get(file);
    return `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  }
  function recordConflict(previous, next) {
    if (previous.value === next.value) return;
    const conflict = {
      key: next.key,
      from: { file: previous.file, value: previous.value },
      to: { file: next.file, value: next.value },
    };
    const reviewIndex = reviewedOverrides.findIndex((review) =>
      review.key === conflict.key
      && review.from?.file === conflict.from.file && review.from?.value === conflict.from.value
      && review.to?.file === conflict.to.file && review.to?.value === conflict.to.value
      && typeof review.reason === "string" && !!review.reason.trim());
    if (reviewIndex >= 0) usedReviews.add(reviewIndex);
    conflicts.push({ ...conflict, reviewed: reviewIndex >= 0 });
    if (reviewIndex < 0) {
      errors.push(`Conflicting English override for ${JSON.stringify(next.key)}: ${previous.location} ${JSON.stringify(previous.value)} -> ${next.location} ${JSON.stringify(next.value)}`);
    }
  }

  for (const file of fs.readdirSync(sourceRoot).filter((name) => dictionaryPattern.test(name)).sort()) {
    const source = read(file);
    const variables = new Map();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) && !ts.isExportAssignment(statement)) {
        errors.push(`${location(file, statement)}: unsupported dictionary statement; keep all entries in the literal dictionary`);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) variables.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    const exports = source.statements.filter((s) => ts.isExportAssignment(s) && !s.isExportEquals);
    let object = exports.length === 1 ? unwrap(exports[0].expression) : undefined;
    if (object && ts.isIdentifier(object)) object = unwrap(variables.get(object.text));
    if (!object || !ts.isObjectLiteralExpression(object)) {
      errors.push(`${file}: unsupported default dictionary export; expected a literal string dictionary`);
      continue;
    }
    const entries = new Map();
    for (const property of object.properties) {
      const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : undefined;
      const valueNode = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : undefined;
      if (key === undefined || !valueNode || !(ts.isStringLiteral(valueNode) || ts.isNoSubstitutionTemplateLiteral(valueNode))) {
        errors.push(`${location(file, property)}: unsupported dictionary entry; expected a literal key and string value`);
        continue;
      }
      const entry = { key, value: valueNode.text, file, location: location(file, property) };
      if (!isValidEnglish(entry.value)) {
        errors.push(`${entry.location}: invalid English value for ${JSON.stringify(key)} (empty or Arabic): ${JSON.stringify(entry.value)}`);
      }
      if (entries.has(key)) recordConflict(entries.get(key), entry);
      entries.set(key, entry);
    }
    dictionaries.push({ file, entries: [...entries.values()] });
  }

  const runtime = read("i18n.ts");
  const imports = new Map();
  for (const statement of runtime.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const file = path.basename(specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    if (dictionaryPattern.test(file) && statement.importClause?.name) {
      if (path.resolve(sourceRoot, specifier.endsWith(".ts") ? specifier : `${specifier}.ts`) !== path.join(sourceRoot, file)) {
        errors.push(`i18n.ts: dictionary import must resolve to the audited source file: ${specifier}`);
      } else {
        imports.set(statement.importClause.name.text, file);
      }
    }
  }
  const translations = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "init") {
      const resources = objectProperty(node.arguments[0], "resources");
      const english = objectProperty(resources, "en");
      const translation = unwrap(objectProperty(english, "translation"));
      if (translation) translations.push(translation);
    }
    ts.forEachChild(node, visit);
  }
  visit(runtime);
  const mergeOrder = [];
  if (translations.length !== 1 || !ts.isObjectLiteralExpression(translations[0])) {
    errors.push("i18n.ts: expected exactly one literal en.translation resource in init()");
  } else {
    for (const property of translations[0].properties) {
      const expression = ts.isSpreadAssignment(property) ? unwrap(property.expression) : undefined;
      const file = expression && ts.isIdentifier(expression) ? imports.get(expression.text) : undefined;
      const dictionary = dictionaries.find((d) => d.file === file);
      if (!dictionary) {
        errors.push(`${location("i18n.ts", property)}: unsupported English resource entry; expected an imported dictionary spread`);
        continue;
      }
      mergeOrder.push(file);
      for (const entry of dictionary.entries) {
        if (effective.has(entry.key)) recordConflict(effective.get(entry.key), entry);
        effective.set(entry.key, entry);
      }
    }
  }
  for (const dictionary of dictionaries) {
    if (!mergeOrder.includes(dictionary.file)) errors.push(`${dictionary.file}: dictionary is not merged into en.translation`);
  }
  reviewedOverrides.forEach((review, index) => {
    if (!usedReviews.has(index)) errors.push(`Stale reviewed override: ${JSON.stringify(review.key)}; re-review or remove it`);
  });
  return {
    mergeOrder, dictionaries, conflicts, errors,
    effective: Object.fromEntries([...effective].map(([key, entry]) => [key, entry.value])),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || "client/src");
  const reviews = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : [];
  const report = auditEnglish(root, reviews);
  console.log(JSON.stringify(report));
  if (report.errors.length) process.exitCode = 1;
}