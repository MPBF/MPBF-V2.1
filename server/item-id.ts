/** Continue the existing ITM01, ITM02, … item identifier series. */
export function nextItemId(lastNumber: string | null, suffixWidth: number | null): string {
  if (lastNumber !== null && !/^\d+$/.test(lastNumber)) {
    throw new Error("آخر رمز صنف غير صالح");
  }
  const number = (BigInt(lastNumber ?? "0") + 1n).toString();
  const width = Math.max(2, suffixWidth ?? 2);
  if (Math.max(number.length, width) > 17) {
    throw new Error("تعذر إنشاء رمز صنف جديد: بلغ التسلسل الحد الأقصى");
  }
  return `ITM${number.padStart(width, "0")}`;
}