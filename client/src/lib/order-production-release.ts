import { translateError } from "../i18n";
import type { OrderProductionReleaseStatus } from "../../../shared/order-production-release";

export async function releaseOrderToProduction(id: number, expected_status: OrderProductionReleaseStatus) {
  const response = await fetch(`/api/orders/${id}/release-production`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ expected_status }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(translateError(body?.message || "تعذر تحويل الطلب إلى الإنتاج."));
  if (!body?.order || body.order.id !== id || !["for_production", "in_production"].includes(body.order.status)) {
    throw new Error(translateError("تعذر تأكيد تحويل الطلب؛ حدّث البيانات قبل إعادة المحاولة."));
  }
  return body.order;
}