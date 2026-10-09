import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fetchOrderDetails, formatOrderDate, numberText, orderStatusLabel, personName, productionStatusLabel } from "../client/src/lib/order-details";

describe("order view/print display helpers", () => {
  afterEach(() => { jest.restoreAllMocks(); });
  it("groups numerical quantities but leaves codes and percentage labels alone", () => {
    expect(numberText("12345.50")).toBe("12,345.5");
    expect(numberText(null)).toBe("—");
    expect(numberText("invalid")).toBe("—");
    expect(personName(null)).toBe("—");
    expect(personName({ display_name_ar: "المنشئ", display_name: "Creator" })).toBe("المنشئ");
    expect(orderStatusLabel("in_production")).toBe("قيد الإنتاج");
    expect(orderStatusLabel("active")).toBe("نشط");
    expect(productionStatusLabel("active")).toBe("قيد الإنتاج");
  });
  it("uses the Gregorian accounting date in Riyadh rather than UTC", () => {
    expect(formatOrderDate("2026-10-02T22:30:00.000Z")).toBe("03/10/2026");
    expect(formatOrderDate("2026-10-03")).toBe("03/10/2026");
    expect(formatOrderDate(null)).toBe("—");
    expect(formatOrderDate("invalid")).toBe("—");
  });
  it("uses the authenticated detail endpoint with cancellation and no writes", async () => {
    const body = { order: { id: 7, order_number: "123" }, customer: null, creator: null, sales_representative: null,
      production_orders: [], totals: { requested_kg: "0.00", planned_kg: "0.00" }, actual_production: { available: false } };
    const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const controller = new AbortController();
    expect(await fetchOrderDetails(7, controller.signal)).toEqual(body);
    expect(fetch).toHaveBeenCalledWith("/api/orders/7/details", {
      credentials: "include", headers: { Accept: "application/json" }, signal: controller.signal,
    });
  });
  it.each([{}, { order: null, production_orders: [] }, { order: { id: 8 }, production_orders: [] }])("rejects incomplete or wrong-order successful responses", async (body) => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchOrderDetails(7, new AbortController().signal)).rejects.toThrow("غير مكتملة");
  });
  it("preserves 404 errors for the not-found state", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "الطلب غير موجود" }), { status: 404 }));
    await expect(fetchOrderDetails(7, new AbortController().signal)).rejects.toMatchObject({ status: 404, message: "الطلب غير موجود" });
  });
});