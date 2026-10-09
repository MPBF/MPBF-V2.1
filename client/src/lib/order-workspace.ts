import type { OrderDisplayFolder } from "../../../shared/order-workspace";
export type { OrderDisplayFolder } from "../../../shared/order-workspace";

export const ORDER_FOLDER_LABELS: Record<OrderDisplayFolder, string> = {
  new: "جديد",
  production: "الإنتاج",
  urgent: "عاجل",
  archive: "الأرشيف",
};

export const ORDER_FOLDER_KEYS: OrderDisplayFolder[] = ["new", "production", "urgent", "archive"];