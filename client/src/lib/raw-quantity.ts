import { latinDigits } from "./number-input";

/** Normalize input without accepting grouped quantities or changing precision. */
export const normalizeRawNumber = (raw: string) => latinDigits(raw).trim();

export const rawQuantityValue = (raw: string): string | null => {
  const value = normalizeRawNumber(raw);
  return /^\d{1,12}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 ? value : null;
};
