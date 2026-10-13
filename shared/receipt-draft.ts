import { kgHundredths, kgString } from "./production";

export type ReceiptDraft = { orderId: string; quantity: string };
export class ReceiptQuantityError extends Error {
  readonly message_ar = "أدخل كمية استلام موجبة بالكيلو بمنزلتين عشريتين كحد أقصى.";
  readonly message_en = "Enter a positive receipt quantity in kg with at most two decimal places.";
  constructor() {
    super("Enter a positive receipt quantity in kg with at most two decimal places.");
    this.name = "ReceiptQuantityError";
  }
}
const latin = (value: string) => value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, ".");
/** Normalize actual received kg exactly; no units or conversion factors. */
export function normalizeReceiptQuantity(value: string): string {
  const quantity = latin(value.trim());
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(quantity)) throw new ReceiptQuantityError();
  const weight = kgHundredths(quantity);
  if (weight <= 0n) throw new ReceiptQuantityError();
  return kgString(weight);
}
