type CategorizedProduct = {
  category_id?: string | null;
  category_name_ar?: string | null;
  category_name?: string | null;
};

const categoryNames = {
  ar: new Intl.Collator("ar", { sensitivity: "base", numeric: true }),
  en: new Intl.Collator("en", { sensitivity: "base", numeric: true }),
};

/** Display-only sorting; preserve the source order inside each category. */
export function sortCustomerProductsByCategory<T extends CategorizedProduct>(products: readonly T[], language: "ar" | "en" = "ar"): T[] {
  const collator = categoryNames[language];
  return products.map((product) => {
    const categoryId = product.category_id?.trim() || "";
    const englishName = product.category_name?.trim() || "";
    const name = language === "en"
      ? (/[\u0600-\u06ff]/.test(englishName) ? "" : englishName)
      : product.category_name_ar?.trim() || englishName;
    return { product, categoryId, name, rank: !categoryId ? 2 : !name ? 1 : 0 };
  }).sort((a, b) =>
    a.rank - b.rank ||
    (a.rank === 2 ? 0 : collator.compare(a.name, b.name) || collator.compare(a.categoryId, b.categoryId)),
  ).map(({ product }) => product);
}