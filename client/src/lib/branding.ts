import { translateError } from "../i18n";

export type Row = Record<string, unknown>;

export type BrandingSnapshot = {
  companyNameAr: string;
  companyNameEn: string;
  logoSrc: string;
  defaultLanguage: "ar" | "en";
};

const apiFetch = async (path: string) => {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر تنفيذ الطلب"));
  return body;
};

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const normalizeSettings = (settings: unknown): Row[] => (Array.isArray(settings) ? (settings as Row[]) : []);

export const brandingFromSources = (profile: Row | null | undefined, settingsRaw: unknown): BrandingSnapshot => {
  const settings = normalizeSettings(settingsRaw);
  const byKey = Object.fromEntries(settings.map((row) => [String(row.setting_key), row]));
  const settingLogo = firstString((byKey.company_logo_data_url as Row | undefined)?.setting_value);
  const profileLogo = firstString(profile?.logo_url);
  return {
    companyNameAr: firstString(profile?.name_ar, profile?.name, "MPBF"),
    companyNameEn: firstString(profile?.name, profile?.name_ar, "PLASTIC MANUFACTURING"),
    logoSrc: firstString(settingLogo, profileLogo),
    defaultLanguage: profile?.default_language === "en" ? "en" : "ar",
  };
};

export const fetchBrandingSnapshot = async (): Promise<BrandingSnapshot> => {
  const fallback = brandingFromSources(null, []);
  const payload = await apiFetch("/public-branding").catch(() => null);
  if (!payload || typeof payload !== "object") return fallback;

  return {
    companyNameAr: firstString((payload as Row).companyNameAr, fallback.companyNameAr),
    companyNameEn: firstString((payload as Row).companyNameEn, fallback.companyNameEn),
    logoSrc: firstString((payload as Row).logoSrc),
    defaultLanguage: payload.defaultLanguage === "en" ? "en" : "ar",
  };
};

export const defaultBranding: BrandingSnapshot = {
  companyNameAr: "MPBF",
  companyNameEn: "PLASTIC MANUFACTURING",
  logoSrc: "",
  defaultLanguage: "ar",
};
