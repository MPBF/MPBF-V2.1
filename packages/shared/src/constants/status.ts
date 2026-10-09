// Status labels (Arabic + English) shared across UIs.

export const OrderStatusLabels: Record<
  string,
  { ar: string; en: string; color: string }
> = {
  pending: { ar: "قيد الانتظار", en: "Pending", color: "#f59e0b" },
  for_production: { ar: "للإنتاج", en: "For Production", color: "#0ea5e9" },
  in_production: { ar: "قيد الإنتاج", en: "In Production", color: "#3b82f6" },
  completed: { ar: "مكتمل", en: "Completed", color: "#10b981" },
  cancelled: { ar: "ملغي", en: "Cancelled", color: "#ef4444" },
  on_hold: { ar: "معلق", en: "On Hold", color: "#6b7280" },
};

export const PriorityLabels: Record<
  string,
  { ar: string; en: string; color: string }
> = {
  low: { ar: "منخفضة", en: "Low", color: "#6b7280" },
  medium: { ar: "متوسطة", en: "Medium", color: "#f59e0b" },
  high: { ar: "عالية", en: "High", color: "#ef4444" },
  urgent: { ar: "عاجلة", en: "Urgent", color: "#dc2626" },
  critical: { ar: "حرجة", en: "Critical", color: "#991b1b" },
};

export function getStatusLabel(
  map: Record<string, { ar: string; en: string; color: string }>,
  key: string | undefined,
  lang: "ar" | "en" = "ar",
) {
  if (!key) return { label: "-", color: "#6b7280" };
  const entry = map[key];
  return entry
    ? { label: entry[lang], color: entry.color }
    : { label: key, color: "#6b7280" };
}
