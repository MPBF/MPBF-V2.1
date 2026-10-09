import { afterEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const auditScript = path.resolve("scripts/lib/i18n-audit.mjs");
const coverageScript = path.resolve("scripts/check-i18n-coverage.mjs");
const temporaryDirectories: string[] = [];
type Review = {
  key: string;
  from: { file: string; value: string };
  to: { file: string; value: string };
  reason: string;
};

function fixture(dictionaries: Record<string, string>, translation: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-audit-"));
  temporaryDirectories.push(root);
  const sourceRoot = path.join(root, "client/src");
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const [file, source] of Object.entries(dictionaries)) fs.writeFileSync(path.join(sourceRoot, file), source);
  fs.writeFileSync(path.join(sourceRoot, "i18n.ts"), `
    import base from "./i18n-en";
    import screen from "./i18n-en-screen";
    i18n.init({ resources: { en: { translation: ${translation} } } });
  `);
  return { root, sourceRoot };
}

function dictionary(values: Record<string, unknown>) {
  return `const dictionary = ${JSON.stringify(values)}; export default dictionary;`;
}

function runAudit(sourceRoot: string, reviews: Review[] = []) {
  const reviewsPath = path.join(sourceRoot, "reviews.json");
  fs.writeFileSync(reviewsPath, JSON.stringify(reviews));
  const result = spawnSync(process.execPath, [auditScript, sourceRoot, reviewsPath], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  return {
    status: result.status,
    report: JSON.parse(result.stdout) as {
      errors: string[];
      conflicts: { key: string; reviewed: boolean }[];
      mergeOrder: string[];
      effective: Record<string, string>;
    },
  };
}

describe("English dictionary merge audit", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it("allows identical duplicates and derives effective values in runtime order", () => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": dictionary({ مشترك: "Shared", أساسي: "Base" }),
      "i18n-en-screen.ts": dictionary({ مشترك: "Shared", شاشة: "Screen" }),
    }, "{ ...screen, ...base }");
    const { status, report } = runAudit(sourceRoot);
    expect(status).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.mergeOrder).toEqual(["i18n-en-screen.ts", "i18n-en.ts"]);
    expect(report.effective).toEqual({ مشترك: "Shared", أساسي: "Base", شاشة: "Screen" });
  });

  it("rejects a conflicting later value and identifies the key, files and values", () => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": dictionary({ بحث: "Search in" }),
      "i18n-en-screen.ts": dictionary({ بحث: "Search" }),
    }, "{ ...screen, ...base }");
    const { status, report } = runAudit(sourceRoot);
    expect(status).toBe(1);
    expect(report.effective["بحث"]).toBe("Search in");
    expect(report.errors.join("\n")).toMatch(/بحث.*i18n-en-screen.ts:1.*"Search".*i18n-en.ts:1.*"Search in"/);
  });

  it("accepts only an exact documented override and rejects changed values or reversed priorities", () => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": dictionary({ بحث: "Search in" }),
      "i18n-en-screen.ts": dictionary({ بحث: "Search" }),
    }, "{ ...screen, ...base }");
    const reviews = [{
      key: "بحث",
      from: { file: "i18n-en-screen.ts", value: "Search" },
      to: { file: "i18n-en.ts", value: "Search in" },
      reason: "Preserve the reviewed label and existing priority.",
    }];
    const accepted = runAudit(sourceRoot, reviews);
    expect(accepted.status).toBe(0);
    expect(accepted.report.conflicts).toEqual([expect.objectContaining({ key: "بحث", reviewed: true })]);
    fs.writeFileSync(path.join(sourceRoot, "i18n-en.ts"), dictionary({ بحث: "Find" }));
    expect(runAudit(sourceRoot, reviews).report.errors.join("\n")).toMatch(/Conflicting English override/);
    fs.writeFileSync(path.join(sourceRoot, "i18n-en.ts"), dictionary({ بحث: "Search in" }));
    const runtime = path.join(sourceRoot, "i18n.ts");
    fs.writeFileSync(runtime, fs.readFileSync(runtime, "utf8").replace("...screen, ...base", "...base, ...screen"));
    const reversed = runAudit(sourceRoot, reviews);
    expect(reversed.status).toBe(1);
    expect(reversed.report.errors.join("\n")).toMatch(/Stale reviewed override/);
    expect(reversed.report.errors.join("\n")).toMatch(/Conflicting English override/);
  });

  it("does not count unmerged or invalid entries toward coverage, even when the dictionary is imported", () => {
    const { root, sourceRoot } = fixture({
      "i18n-en.ts": dictionary({ أساسي: "Base", فارغ: " ", عربي: "English عربي" }),
      "i18n-en-screen.ts": dictionary({ شاشة: "Screen" }),
    }, "{ ...base }");
    const { status, report } = runAudit(sourceRoot);
    expect(status).toBe(1);
    expect(report.errors).toContain("i18n-en-screen.ts: dictionary is not merged into en.translation");
    expect(report.effective["شاشة"]).toBeUndefined();
    fs.writeFileSync(path.join(sourceRoot, "page.ts"), 'translate("شاشة"); translate("فارغ"); translate("عربي");');
    const coverage = spawnSync(process.execPath, [coverageScript], { cwd: root, encoding: "utf8" });
    expect(coverage.status).toBe(1);
    expect(coverage.stdout).toContain("Missing English entries: 3");
    expect(coverage.stdout).toContain("page.ts:1 :: شاشة");
    expect(coverage.stdout).toContain("page.ts:1 :: فارغ");
    expect(coverage.stdout).toContain("page.ts:1 :: عربي");
  });

  it.each(["", "   ", "English عربي", "\u0750", "\u08a0", "\ufb50"])(
    "rejects invalid English values %j even when a later dictionary hides them",
    (value) => {
      const { sourceRoot } = fixture({
        "i18n-en.ts": dictionary({ مفتاح: "Valid" }),
        "i18n-en-screen.ts": dictionary({ مفتاح: value }),
      }, "{ ...screen, ...base }");
      const { status, report } = runAudit(sourceRoot);
      expect(status).toBe(1);
      expect(report.errors.join("\n")).toMatch(/i18n-en-screen.ts:1: invalid English value.*مفتاح/);
    },
  );

  it("reports duplicate-key conflicts inside a single dictionary", () => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": 'export default { "بحث": "Search", "بحث": "Find" };',
    }, "{ ...base }");
    const { status, report } = runAudit(sourceRoot);
    expect(status).toBe(1);
    expect(report.effective["بحث"]).toBe("Find");
    expect(report.errors.join("\n")).toMatch(/"Search".*"Find"/);
  });

  it.each([
    'export default { "مفتاح": 4 };',
    'export default { ["مفتاح"]: "Value" };',
    'export default { ...other };',
    'export default makeDictionary();',
    'export default { "مفتاح": "Value" ',
  ])("fails explicitly on unsupported or malformed dictionary definitions", (source) => {
    const { sourceRoot } = fixture({ "i18n-en.ts": source }, "{ ...base }");
    expect(runAudit(sourceRoot).status).toBe(1);
  });

  it.each([
    'dictionary["إضافة"] = "Added";',
    'dictionary.important = "Changed";',
    'Object.assign(dictionary, { "إضافة": "Added" });',
    'if (true) dictionary["إضافة"] = "Added";',
  ])("rejects dictionary mutations rather than silently reporting incomplete coverage: %s", (mutation) => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": `const dictionary = { "مفتاح": "Value" }; ${mutation} export default dictionary;`,
    }, "{ ...base }");
    const { status, report } = runAudit(sourceRoot);
    expect(status).toBe(1);
    expect(report.errors.join("\n")).toMatch(/unsupported dictionary statement/);
  });

  it.each(["{ ...missing }", '{ ...base, "مفتاح": "Inline override" }', "makeResources()"])(
    "fails explicitly on unsupported resource merges: %s",
    (translation) => {
      const { sourceRoot } = fixture({ "i18n-en.ts": dictionary({ مفتاح: "Value" }) }, translation);
      expect(runAudit(sourceRoot).status).toBe(1);
    },
  );

  it("rejects obsolete reviews when conflicting definitions become identical", () => {
    const { sourceRoot } = fixture({
      "i18n-en.ts": dictionary({ بحث: "Search" }),
      "i18n-en-screen.ts": dictionary({ بحث: "Search" }),
    }, "{ ...screen, ...base }");
    const { status, report } = runAudit(sourceRoot, [{
      key: "بحث", from: { file: "i18n-en-screen.ts", value: "Search" },
      to: { file: "i18n-en.ts", value: "Search in" }, reason: "Previously reviewed.",
    }]);
    expect(status).toBe(1);
    expect(report.errors.join("\n")).toMatch(/Stale reviewed override/);
  });
});