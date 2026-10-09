import { describe, expect, it } from "@jest/globals";
import { isProtectedProductionOrder } from "../server/audit-rules";
import { productionOrderDetails, productionQuantityLocked, productionQuantityPayload } from "../client/src/lib/production-order-form";

describe("production order quantity-only form", () => {
  it("sends only the quantity and accepts Arabic digits", () => {
    expect(productionQuantityPayload(" 150.25 ")).toEqual({ quantity_kg: "150.25" });
    expect(productionQuantityPayload("١٢٥٫٥٠")).toEqual({ quantity_kg: "125.50" });
    expect(productionQuantityPayload("۱۲۵.۵")).toEqual({ quantity_kg: "125.5" });
    expect(productionQuantityPayload("99999999.99")).toEqual({ quantity_kg: "99999999.99" });
  });
  it("rejects blank, zero, negative, over-precision and oversized quantities", () => {
    for (const value of ["", " ", "0", "-1", "1.234", "100000000", "NaN", "1e3", "1,000"]) {
      expect(() => productionQuantityPayload(value)).toThrow();
    }
  });
  it("keeps frontend protection identical to backend rules", () => {
    for (const status of ["pending", "active", "completed", "cancelled", "archived"]) {
      for (const batch_number of [null, "", "  ", "BATCH"]) {
        for (const previous_status of [null, "pending", "active"]) {
          const row = { status, batch_number, previous_status };
          expect(productionQuantityLocked(row)).toBe(isProtectedProductionOrder(status, batch_number, previous_status));
        }
      }
    }
  });
  it("shows readable production order data without editable controls", () => {
    const fields = productionOrderDetails({
      production_order_number: "123-01", order_number: "123",
      customer_name_ar: "عميل", product_size_caption: "كيس 40 × 50", customer_product_id: 7,
      quantity_kg: "1500", final_quantity_kg: "1575", overrun_percentage: "5", status: "pending",
    });
    expect(fields).toContainEqual({ label: "العميل", value: "عميل" });
    expect(fields).toContainEqual({ label: "الكمية المطلوبة", value: "1,500 كجم" });
    expect(fields).toContainEqual({ label: "الكمية النهائية", value: "1,575 كجم" });
    expect(fields).toContainEqual({ label: "الحالة", value: "قيد الانتظار" });
    expect(fields).toContainEqual({ label: "رقم التشغيلة", value: "—" });
  });
});