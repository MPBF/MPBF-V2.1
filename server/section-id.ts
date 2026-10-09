/** Continue the existing SEC01, SEC02, … section identifier series. */
export function nextSectionId(number: string | null, suffixWidth: number | null = null): string {
  if (number !== null && !/^\d+$/.test(number)) throw new Error("آخر رمز قسم غير صالح");
  const next = (BigInt(number ?? "0") + 1n).toString();
  const width = Math.max(2, suffixWidth ?? 2);
  if (Math.max(next.length, width) > 17) throw new Error("تعذر إنشاء رمز قسم جديد: بلغ التسلسل الحد الأقصى");
  return `SEC${next.padStart(width, "0")}`;
}