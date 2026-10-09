import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import english from "./i18n-en";
import reviewedEnglish from "./i18n-en-reviewed";
import productionEnglish from "./i18n-en-production";
import orderWorkspaceEnglish from "./i18n-en-order-workspace";

export type AppLanguage = "ar" | "en";

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: {} },
    en: { translation: { ...productionEnglish, ...reviewedEnglish, ...orderWorkspaceEnglish, ...english } },
  },
  lng: "ar",
  fallbackLng: "ar",
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

export function translate(source: string, values?: Record<string, unknown>): string {
  return i18n.t(source, values) as string;
}

export function translateError(message: unknown): string {
  const source = typeof message === "string" && message.trim() ? message : "تعذر تنفيذ الطلب";
  const translated = translate(source);
  if (i18n.language === "en" && /[\u0600-\u06ff]/.test(translated) && translated === source) {
    return "Request failed. Please check the details and try again.";
  }
  return translated;
}

export function normalizeLanguage(value: unknown, fallback: AppLanguage = "ar"): AppLanguage {
  return value === "en" ? "en" : value === "ar" ? "ar" : fallback;
}

export function intlLocale(): string {
  return i18n.language === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
}

export function localizedName(arabic: unknown, english: unknown, fallback = "—"): string {
  const arabicName = typeof arabic === "string" ? arabic.trim() : "";
  const englishName = typeof english === "string" ? english.trim() : "";
  // Some legacy API "English" fields contain an Arabic SQL fallback.
  return (i18n.language === "en"
    ? (/[\u0600-\u06ff]/.test(englishName) ? "" : englishName)
    : arabicName || englishName) || fallback;
}

export function applyLanguage(language: AppLanguage): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.body.dir = language === "ar" ? "rtl" : "ltr";
  document.body.lang = language;
  document.title = language === "ar" ? "MPBF | نظام تشغيل المصنع" : "MPBF | Factory Operations System";
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    language === "ar"
      ? "نظام MPBF لإدارة العملاء والطلبات والإنتاج والماكينات"
      : "MPBF system for managing customers, orders, production, and machines",
  );
}