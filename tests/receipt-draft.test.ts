import { describe, expect, test } from "@jest/globals";
import { deriveReceiptPacking, type ReceiptDraft } from "../shared/receipt-draft";
import { PackingError } from "../shared/production-packing";
import { receiptPrintHtml } from "../client/src/lib/receipt-print";
import type { ProductionReceipt } from "../shared/production";

const draft = (changes: Partial<ReceiptDraft> = {}): ReceiptDraft => ({
  orderId: "1", quantity: "10", unit: "packet", count: "2", method: "unit_weight",
  unitWeight: "", pieces: "", pieceWeight: "", ...changes,
});
describe("requested kilograms drive finished-goods packing", () => {
  test("derives weight per unit and ignores stale manual weights", () => {
    const { packing, result } = deriveReceiptPacking(draft({ unitWeight: "999" }));
    expect(packing.unit_weight_kg).toBe("5.000000");
    expect(result.quantity_kg).toBe("10.00");
    expect(result.unit_quantity).toBe("2");
  });
  test("derives per-piece grams and supports Arabic digits", () => {
    const { packing, result } = deriveReceiptPacking(draft({
      quantity: "٣٠٫٠٠", count: "٣", unit: "roll", method: "piece_weight", pieces: "٢٠",
    }));
    expect(packing.piece_weight_grams).toBe("500.0000");
    expect(result.quantity_kg).toBe("30.00");
  });
  test("kg uses the requested quantity directly", () => {
    expect(deriveReceiptPacking(draft({unit:"kg",quantity:"1.25",count:""})).packing.quantity).toBe("1.25");
  });
  test("rounds representable recurring unit weights without changing total", () => {
    expect(deriveReceiptPacking(draft({quantity:"1",count:"3"})).result.quantity_kg).toBe("1.00");
  });
  test.each([
    {quantity:""}, {quantity:"0"}, {quantity:"-1"}, {quantity:"1.001"},
    {count:"0"}, {count:"2.5"}, {method:"piece_weight" as const,pieces:"0"},
    {method:"piece_weight" as const,pieces:"1000001"},
    {quantity:"0.01",count:"999999999999"},
  ])("rejects invalid or unrepresentable packing %p", changes => {
    expect(()=>deriveReceiptPacking(draft(changes))).toThrow(PackingError);
  });
});
describe("receipt printing", () => {
  const receipt: ProductionReceipt = { id:1, voucher_number:"FP-Rec0001",created_at:"2026-10-11T12:00:00Z",
    created_by:1,notes:'<script>alert("bad")</script>',items:[{
      id:1,production_order_id:12,production_order_number:"PO-12",customer_product_id:1,item_id:"ITM-1",
      location_id:1,quantity_kg:"10.00",packaging:null,packing:deriveReceiptPacking(draft()).packing,
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
  });
});
