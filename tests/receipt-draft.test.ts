import { describe, expect, test } from "@jest/globals";
import { normalizeReceiptQuantity, ReceiptQuantityError } from "../shared/receipt-draft";
import { receiptPrintHtml } from "../client/src/lib/receipt-print";
import type { ProductionReceipt } from "../shared/production";

describe("finished-goods receipts contain actual kilograms only", () => {
  test.each([
    ["10","10.00"],["1.25","1.25"],["0.01","0.01"],["999999999999.99","999999999999.99"],
    ["٣٠٫٠٠","30.00"],["۱۲٫۳۴","12.34"],[" 1.20 ","1.20"],["0001.5","1.50"],
  ])("normalizes %s exactly to %s without conversion", (input, expected) => {
    expect(normalizeReceiptQuantity(input)).toBe(expected);
  });
  test.each(["", "0", "0.00", "-1", "1.001", "1e3", "1,000", "NaN", "Infinity", "1000000000000", ".5", "1."])
  ("rejects invalid quantities rather than inventing weights: %s", input => {
    expect(()=>normalizeReceiptQuantity(input)).toThrow(ReceiptQuantityError);
  });
});
describe("receipt printing", () => {
  const receipt: ProductionReceipt = { id:1, voucher_number:"FP-Rec0001",created_at:"2026-10-11T12:00:00Z",
    created_by:1,notes:'<script>alert("bad")</script>',items:[{
      id:1,production_order_id:12,production_order_number:"PO-12",customer_product_id:1,item_id:"ITM-1",
      location_id:1,quantity_kg:"10.00",
    }] };
  test.each(["ar","en"])("prints saved quantities and escaped content on A4 in %s", language => {
    const html = receiptPrintHtml(receipt,language);
    expect(html).toContain("size:A4 portrait");
    expect(html).toContain("FP-Rec0001");
    expect(html).toContain("PO-12");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain(language==="ar"?'dir="rtl"':'dir="ltr"');
    expect(html).toContain("table-header-group");
    expect(html).not.toContain("Packing unit");
    expect(html).not.toContain("Unit quantity");
    expect(html).not.toContain("معامل الكمية");
  });
  test.each(["ar","en"])("prints numeric history quantities and mixed response formats in %s", language => {
    // Reproduce JSONB aggregation: PostgreSQL numeric becomes a JSON number.
    const historyReceipt = JSON.parse(JSON.stringify({
      ...receipt,
      items: [0.1, "0.20", 10, "1.05"].map((quantity_kg, index) => ({
        ...receipt.items[0], id:index+1, quantity_kg,
      })),
    })) as ProductionReceipt;
    const html = receiptPrintHtml(historyReceipt, language);
    expect(html).toContain("<bdi>11.35 kg</bdi>");
    expect((html.match(/<tr><td>/g) ?? []).length).toBe(4);
  });
  test.each([null, undefined, "invalid", -1, 1.234])("rejects invalid receipt weight %s rather than inventing a total", quantity_kg => {
    const invalidReceipt = JSON.parse(JSON.stringify({
      ...receipt, items: [{...receipt.items[0], quantity_kg}],
    })) as ProductionReceipt;
    expect(() => receiptPrintHtml(invalidReceipt,"en")).toThrow("Invalid quantity");
  });
});
