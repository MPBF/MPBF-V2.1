/** New master-batch colors use application IDs, not supplier/model codes already in use. */
export function nextMasterBatchColorId(number: string | null, suffixWidth: number | null = null): string {
  if (number !== null && !/^\d+$/.test(number)) throw new Error("آخر رمز لون خامة غير صالح");
  const next = (BigInt(number ?? "0") + 1n).toString();
  const width = Math.max(2, suffixWidth ?? 2);
  if (Math.max(next.length, width) > 17) throw new Error("تعذر إنشاء رمز لون خامة جديد: بلغ التسلسل الحد الأقصى");
  return `MB${next.padStart(width, "0")}`;
}