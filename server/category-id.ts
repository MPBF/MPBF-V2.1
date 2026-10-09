/** Keep the existing CAT01, CAT02, … category identifier format. */
export function nextCategoryId(lastNumber: string | null, suffixWidth: number | null): string {
  if (lastNumber !== null && !/^\d+$/.test(lastNumber)) {
    throw new Error("آخر رمز تصنيف غير صالح");
  }
  const number = (BigInt(lastNumber ?? "0") + 1n).toString();
  const width = Math.max(2, suffixWidth ?? 2);
  if (Math.max(number.length, width) > 17) {
    throw new Error("تعذر إنشاء رمز تصنيف جديد: بلغ التسلسل الحد الأقصى");
  }
  return `CAT${number.padStart(width, "0")}`;
}