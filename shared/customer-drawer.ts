export const DRAWER_LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
export const DRAWER_NUMBERS = Array.from({ length: 100 }, (_, index) => String(index + 1));
export const DRAWER_CODE_PATTERN = /^([A-Z])-(100|[1-9]\d?)$/;

export function splitDrawerCode(value: unknown): { letter: string; number: string } {
  const match = typeof value === "string" ? DRAWER_CODE_PATTERN.exec(value) : null;
  return match ? { letter: match[1], number: match[2] } : { letter: "", number: "" };
}

export function joinDrawerCode(letter: string, number: string): string | null {
  if (!letter && !number) return null;
  const code = `${letter}-${number}`;
  if (!DRAWER_CODE_PATTERN.test(code)) throw new Error("اختر حرف الدرج ورقمه معًا.");
  return code;
}
