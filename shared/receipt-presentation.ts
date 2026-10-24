export type ReceiptBranding = {
  companyNameAr: string; companyNameEn: string; logoSrc: string;
  address: string; phone: string; email: string; taxNumber: string;
};

/** Names in English documents must never silently become Arabic labels. */
export function receiptName(arabic: string | null | undefined, english: string | null | undefined, language: string): string {
  if (language === "en") return english?.trim() && !/\p{Script=Arabic}/u.test(english) ? english.trim() : "—";
  return arabic?.trim() || english?.trim() || "—";
}

export function safeReceiptLogo(source: string | null | undefined): string {
  const value = source?.trim() ?? "";
  return /^(?:https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,)/i.test(value) ? value : "";
}
