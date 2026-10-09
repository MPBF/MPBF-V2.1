import { afterEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import i18n, { localizedName, normalizeLanguage, translate, translateError } from "../client/src/i18n";
import { rollLabelPreviewCopy } from "../client/src/pages/production/roll-label-document";

const dictionaryAudit = JSON.parse(execFileSync(process.execPath, [
  "scripts/lib/i18n-audit.mjs", "client/src", "scripts/i18n-reviewed-overrides.json",
], { encoding: "utf8" })) as {
  mergeOrder: string[];
  errors: string[];
  effective: Record<string, string>;
};
const dictionaries = fs.readdirSync(path.resolve("client/src"))
  .filter((file) => /^i18n-en(?:-[a-z0-9-]+)?\.ts$/i.test(file))
  .map((file) => ({
    file,
    // Jest must transform each discovered TypeScript dictionary at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    values: require(path.resolve("client/src", file)).default as Record<string, string>,
  }));

describe("interface localization", () => {
  afterEach(async () => {
    await i18n.changeLanguage("ar");
  });

  it("translates known interface keys and falls back to Arabic", async () => {
    await i18n.changeLanguage("en");
    expect(translate("لوحة الإدارة")).toBe("Admin dashboard");
    expect(translate("عبارة غير مترجمة")).toBe("عبارة غير مترجمة");
  });

  it("uses English-only display names and a neutral fallback when unavailable", async () => {
    await i18n.changeLanguage("en");
    expect(localizedName("اسم عربي", "English name")).toBe("English name");
    expect(localizedName("اسم عربي", null)).toBe("—");
    expect(localizedName("اسم عربي", "اسم عربي", "CAT01")).toBe("CAT01");
    expect(localizedName("اسم عربي", "Mixed عربي", "CAT01")).toBe("CAT01");
    expect(localizedName("اسم عربي", "  English name  ")).toBe("English name");
    await i18n.changeLanguage("ar");
    expect(localizedName("اسم عربي", "English name")).toBe("اسم عربي");
  });

  it("uses a readable English fallback for unrecognized Arabic API errors", async () => {
    await i18n.changeLanguage("en");
    expect(translateError("تعذر تنفيذ طلب مخصص"))
      .toBe("Request failed. Please check the details and try again.");
    expect(translateError("The service is unavailable"))
      .toBe("The service is unavailable");
  });

  it("normalizes unsupported locales to the configured fallback", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("fr")).toBe("ar");
    expect(normalizeLanguage(undefined, "en")).toBe("en");
  });

  it("audits every discovered dictionary and preserves the existing merge priorities", () => {
    expect(dictionaryAudit.errors).toEqual([]);
    expect(dictionaryAudit.mergeOrder).toEqual([
      "i18n-en-production.ts", "i18n-en-reviewed.ts", "i18n-en-order-workspace.ts", "i18n-en.ts",
    ]);
    expect([...new Set(dictionaryAudit.mergeOrder)].sort()).toEqual(dictionaries.map((d) => d.file).sort());
    const merged = Object.assign({}, ...dictionaryAudit.mergeOrder.map((file) =>
      dictionaries.find((dictionary) => dictionary.file === file)!.values));
    expect(dictionaryAudit.effective).toEqual(merged);
    expect(i18n.getResourceBundle("en", "translation")).toEqual(merged);
  });

  for (const { file, values } of dictionaries) {
    it(`retains valid runtime translations for every entry in ${file}`, async () => {
      await i18n.changeLanguage("en");
      for (const [source, english] of Object.entries(values)) {
        expect(english.trim()).not.toBe("");
        expect(english).not.toMatch(/\p{Script=Arabic}/u);
        // Check the resource itself as well as its literal lookup. Natural-language
        // colons are not namespace separators; default separator behavior is a
        // separate UI concern, not evidence of a lost dictionary entry.
        expect(i18n.getResource("en", "translation", source)).toBe(dictionaryAudit.effective[source]);
        // Reviewed overrides must resolve to the final value, not the losing definition.
        expect(translate(source, { nsSeparator: false })).toBe(dictionaryAudit.effective[source]);
      }
      await i18n.changeLanguage("ar");
      for (const source of Object.keys(values)) expect(translate(source, { nsSeparator: false })).toBe(source);
    });
  }

  it("keeps print preview labels and failure messages consistent with the dictionaries", async () => {
    const arabic = rollLabelPreviewCopy("ar");
    const english = rollLabelPreviewCopy("en");
    await i18n.changeLanguage("en");
    for (const key of Object.keys(arabic) as (keyof typeof arabic)[]) {
      if (key !== "direction") expect(translate(arabic[key])).toBe(english[key]);
    }
  });

  it("translates indirect configuration, validation, and unit labels", async () => {
    await i18n.changeLanguage("en");
    expect(translate("الاسم بالعربية")).toBe("Name in Arabic");
    expect(translate("التصنيفات")).toBe("Categories");
    expect(translate("غير مصنف")).toBe("Unclassified");
    expect(translateError("اختر دوراً صالحاً من القائمة")).toBe("Select a valid role from the list");
    expect(translate("كيلو")).toBe("Kilogram");
  });
});