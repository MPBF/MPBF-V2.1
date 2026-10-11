import type { ProductionReceipt } from "../../../shared/production";
import { receiptUnitLabel } from "../../../shared/production-packing";

const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function receiptPrintHtml(receipt: ProductionReceipt, language: string) {
  const en = language === "en", label = (ar: string, english: string) => en ? english : ar;
  const number = (value: unknown, digits = 2) => escape(new Intl.NumberFormat(en ? "en-GB" : "ar-SA-u-nu-latn",
    { maximumFractionDigits: digits }).format(Number(value ?? 0)));
  const date = new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(receipt.created_at));
  const total = receipt.items.reduce((sum, item) => {
    const [whole, fraction = ""] = item.quantity_kg.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  }, 0n);
  const rows = receipt.items.map((item, index) => {
    const packing = item.packing;
    const specification = packing ? packing.method === "unit_weight"
      ? `${number(packing.unit_weight_kg ?? "1", 6)} kg`
      : `${number(packing.pieces_per_unit, 0)} × ${number(packing.piece_weight_grams, 4)} ${label("جرام", "g")}`
      : item.packaging ? `${number(item.packaging.roll_weight_grams, 4)} ${label("جرام", "g")} × ${number(item.packaging.rolls_per_unit, 0)}`
      : label("غير مسجلة تاريخيًا", "Not recorded historically");
    return `<tr><td>${item.line_number ?? index + 1}</td><td><bdi>${escape(item.production_order_number ?? `#${item.production_order_id}`)}</bdi></td>
      <td><bdi>${escape(item.item_id)}</bdi></td><td class="numeric">${number(item.quantity_kg)}</td>
      <td>${escape(packing ? receiptUnitLabel(packing.unit, language) : label("كيلو", "kg"))}</td>
      <td class="numeric">${number(packing?.quantity ?? item.quantity_kg)}</td><td>${specification}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="${en ? "en" : "ar"}" dir="${en ? "ltr" : "rtl"}"><head><meta charset="utf-8">
    <title>${escape(receipt.voucher_number)}</title><style>
    @page { size:A4 portrait; margin:12mm; }
    * { box-sizing:border-box; } body { margin:0; font-family:Tahoma,Arial,sans-serif; color:#173d35; font-size:11px; line-height:1.5; }
    header { border-bottom:2px solid #376554; padding-bottom:10px; margin-bottom:12px; }
    h1 { font-size:20px; margin:0 0 8px; } .meta { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .route { padding:8px 0; } table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th,td { padding:6px 5px; border:1px solid #c7d5ce; vertical-align:top; overflow-wrap:anywhere; }
    th { background:#edf4ef; font-size:10px; } th:first-child { width:6%; } th:nth-child(2) { width:20%; } th:last-child { width:23%; }
    thead { display:table-header-group; } tr { break-inside:avoid; } .numeric { direction:ltr; font-variant-numeric:tabular-nums; }
    .total { text-align:end; font-weight:bold; margin:12px 0; } .notes { white-space:pre-wrap; overflow-wrap:anywhere; }
    .closing { break-inside:avoid; } .signatures { display:flex; justify-content:space-between; gap:20px; margin-top:30px; }
    .signatures span { width:45%; border-top:1px solid #748d80; padding-top:5px; }
    </style></head><body><header><h1>${label("سند استلام مواد تامة", "Finished goods receipt voucher")}</h1>
    <div class="meta"><span>${label("رقم السند", "Voucher number")}: <bdi>${escape(receipt.voucher_number)}</bdi></span>
    <span>${label("التاريخ", "Date")}: <bdi>${escape(date)}</bdi></span></div></header>
    <div class="route">${label("المصدر: صالة الإنتاج · الوجهة: صالة المواد التامة", "Source: production hall · Destination: finished-goods hall")}</div>
    <table aria-label="${label("بنود السند", "Voucher lines")}"><thead><tr>
    <th>#</th><th>${label("أمر الإنتاج", "Production order")}</th><th>${label("الصنف", "Item")}</th>
    <th>${label("الكمية المستلمة (كجم)", "Received weight (kg)")}</th><th>${label("الوحدة", "Unit")}</th>
    <th>${label("كمية التعبئة", "Packing quantity")}</th><th>${label("وزن الوحدة / بيانات القطع", "Unit weight / piece specification")}</th>
    </tr></thead><tbody>${rows}</tbody></table><div class="closing">
    <p class="total">${label("إجمالي السند", "Voucher total")}: <bdi>${number(`${total / 100n}.${String(total % 100n).padStart(2, "0")}`)} kg</bdi></p>
    ${receipt.notes ? `<p class="notes">${label("ملاحظات", "Notes")}: ${escape(receipt.notes)}</p>` : ""}
    <div class="signatures"><span>${label("التسليم · صالة الإنتاج", "Released by · production hall")}</span>
    <span>${label("الاستلام · صالة المواد التامة", "Received by · finished-goods hall")}</span></div></div></body></html>`;
}

/** Print only persisted receipt data in its own document, never the dashboard or an unsaved draft. */
export function printReceipt(receipt: ProductionReceipt, language: string) {
  const frame = document.createElement("iframe");
  frame.dataset.receiptPrintFrame = String(receipt.id);
  frame.title = language === "en" ? "Receipt A4 print" : "طباعة سند الاستلام A4";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  const cleanup = () => frame.remove();
  frame.onload = async () => {
    const target = frame.contentWindow;
    if (!target) { cleanup(); return; }
    await target.document.fonts.ready;
    target.addEventListener("afterprint", cleanup, { once: true });
    target.focus();
    target.print();
  };
  frame.srcdoc = receiptPrintHtml(receipt, language);
  document.body.appendChild(frame);
  window.setTimeout(cleanup, 300000);
}
