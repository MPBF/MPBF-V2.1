/** Continue the dominant existing MAC01, MAC02, … machine identifier series. */
export function nextMachineId(number: string | null): string {
  if (number !== null && !/^\d+$/.test(number)) throw new Error("آخر رمز ماكينة غير صالح");
  const next = BigInt(number ?? "0") + 1n;
  if (next > 999n) throw new Error("تعذر إنشاء ماكينة جديدة: بلغ التسلسل الحد الأقصى MAC999");
  return `MAC${next.toString().padStart(2, "0")}`;
}