import type { OrderDisplayFolder } from "../../../shared/order-workspace";
export type { OrderDisplayFolder, OrderDisplayFilter } from "../../../shared/order-workspace";

export const ORDER_FOLDER_LABELS: Record<OrderDisplayFolder, string> = {
  new: "جديد",
  production: "الإنتاج",
  urgent: "عاجل",
  archive: "الأرشيف",
};

export const ORDER_FOLDER_KEYS: OrderDisplayFolder[] = ["new", "production", "urgent", "archive"];
export const ORDER_FILTER_KEYS = ["active", "all", "new", "production", "archive"] as const;
export const ORDER_FILTER_LABELS = { ...ORDER_FOLDER_LABELS, active: "نشط", all: "الكل" };