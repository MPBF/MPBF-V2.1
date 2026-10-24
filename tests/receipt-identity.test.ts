import { describe, expect, it, jest } from "@jest/globals";
import { receiptName, safeReceiptLogo, type ReceiptBranding } from "../shared/receipt-presentation";
import { receiptPrintHtml } from "../client/src/lib/receipt-print";
import { ProductionReadService } from "../server/production/read";
import { receiptSelect } from "../server/production/read-queries";
import type { ProductionReceipt } from "../shared/production";

const branding: ReceiptBranding = {
  companyNameAr: "مصنع اختبار", companyNameEn: "Test Factory", logoSrc: "/logo.png",
  address: "Factory address", phone: "+966000", email: "test@example.invalid", taxNumber: "TAX-TEST",
};
const receipt: ProductionReceipt = {
  id: 1, voucher_number: "FP-Rec0001", created_at: "2026-10-16T10:00:00Z", created_by: 7,
  receiver_name: "Actual Keeper", receiver_name_ar: "أمين الاستلام", notes: null,
  items: [{ id: 1, production_order_id: 2, customer_product_id: 3, item_id: "ITM001",
    location_id: 1, quantity_kg: "1250.25", production_order_number: "JO0001",
    customer_name: "Stored Customer", customer_name_ar: "عميل السند",
    product_name: "Stored Item", product_name_ar: "صنف السند" }],
};

describe("finished receipt identity and factory presentation", () => {
  it.each(["ar", "en"])("prints actual receipt identities and configured branding in %s", language => {
    const html = receiptPrintHtml(receipt, language, branding);
    expect(html).toContain(language === "ar" ? "عميل السند" : "Stored Customer");
    expect(html).toContain(language === "ar" ? "صنف السند" : "Stored Item");
    expect(html).toContain(language === "ar" ? "أمين الاستلام" : "Actual Keeper");
    for (const field of Object.values(branding)) expect(html).toContain(field);
    expect(html).toContain("1,250.25 kg");
    expect(html).toContain("size:A4 portrait");
    expect(html).toContain("display:table-header-group");
    expect((html.match(/<th>/g) ?? []).length).toBe(5);
  });
  it("uses dashes for missing historical identities, never a current viewer", () => {
    const html = receiptPrintHtml({ ...receipt, receiver_name: null, receiver_name_ar: null,
      items: receipt.items.map(item => ({ ...item, customer_name: null, customer_name_ar: null, product_name: null, product_name_ar: null })) }, "en");
    expect(html).not.toContain("Actual Keeper");
    expect(html).toContain("Warehouse keeper: —");
  });
  it("escapes persisted labels, notes, and factory fields", () => {
    const html = receiptPrintHtml({ ...receipt, notes: '<script>alert("x")</script>',
      receiver_name: "<b>keeper</b>", items: receipt.items.map(item => ({ ...item, customer_name: "<script>customer</script>" })) },
    "en", { ...branding, companyNameEn: "<img onerror=x>", logoSrc: 'javascript:alert("x")' });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain('src="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });
  it("keeps English fields free of Arabic fallback", () => {
    expect(receiptName("عميل", null, "en")).toBe("—");
    expect(receiptName("عميل", "عميل", "en")).toBe("—");
    expect(receiptName("عميل", "Customer", "en")).toBe("Customer");
    expect(receiptName(null, "Customer", "ar")).toBe("Customer");
  });
  it.each(["/logo.png", "https://example.invalid/logo.png", "data:image/png;base64,AAAA"])("accepts configured image %s", source => {
    expect(safeReceiptLogo(source)).toBe(source);
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "//unknown.invalid/image", "file:///tmp/a"])("rejects unsafe image %s", source => {
    expect(safeReceiptLogo(source)).toBe("");
  });
  it("projects the receipt creator and frozen execution names rather than a current viewer/product", () => {
    expect(receiptSelect).toContain("receiver.id=r.created_by");
    expect(receiptSelect).toContain("e.product->>'customer_name'");
    expect(receiptSelect).toContain("e.product->>'name_ar'");
    expect(receiptSelect).toContain("'quantity_kg',ri.quantity_kg::text");
    expect(receiptSelect).not.toContain("JOIN customer_products");
  });
  it.each(["view_production_hall", "receive_production", "view_finished_inventory", "manage_finished_warehouse"])(
    "allows receipt factory lookup with %s without settings administration", async grant => {
      const query = jest.fn(async (sql: string) => ({ rows: sql.includes("FROM company_profile") ? [branding] : [] }));
      const release = jest.fn();
      const read = new ProductionReadService({ connect: async () => ({ query, release }) });
      await expect(read.receiptBranding({ id: 7, permissions: [grant] })).resolves.toEqual(branding);
      expect(release).toHaveBeenCalled();
      expect(query.mock.calls.every(([sql]) => !/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
    },
  );
  it("denies unrelated production operators and handles unconfigured factory explicitly", async () => {
    const connect = jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() }));
    const read = new ProductionReadService({ connect });
    await expect(read.receiptBranding({ id: 7, permissions: ["operate_film"] })).rejects.toMatchObject({ status: 403 });
    expect(connect).not.toHaveBeenCalled();
    await expect(read.receiptBranding({ id: 7, permissions: ["receive_production"] })).rejects.toMatchObject({ status: 409 });
  });
});
