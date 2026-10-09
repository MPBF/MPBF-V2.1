import type { ProductionActor } from "../../../shared/production";

const hasArabic = (value: string) => /[\u0600-\u06ff]/.test(value);

export function productionActorName(
  actor: ProductionActor | null | undefined,
  id: number | null,
  language: string,
): string {
  if (id === null) return language === "en" ? "Not recorded" : "غير مسجل";

  const candidates = language === "en"
    ? [actor?.display_name, actor?.full_name, actor?.username]
    : [actor?.display_name_ar, actor?.full_name, actor?.display_name, actor?.username];
  const name = candidates
    .map(value => value?.trim() ?? "")
    .find(value => value.length > 0 && (language !== "en" || !hasArabic(value)));

  return name || `#${id}`;
}
