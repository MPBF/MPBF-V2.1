import type { ProductionReceipt } from "../../../shared/production";
import { kgHundredths } from "../../../shared/production";
import { formatNumber, formatWholeNumber } from "./format-number";
import { receiptName, safeReceiptLogo, type ReceiptBranding } from "../../../shared/receipt-presentation";
import { fetchReceiptBranding } from "./receipt-branding";

const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function receiptPrintHtml(receipt: ProductionReceipt, language: string, branding?: ReceiptBranding | null) {
  const en = language === "en", label = (ar: string, english: string) => en ? english : ar;
  const date = new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn",
    { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(receipt.created_at));
  // Historical JSON aggregates can contain numeric weights, unlike direct
  // PostgreSQL numeric columns. Accept both without floating-point summation.
  const total = receipt.items.reduce((sum, item) => sum + kgHundredths(String(item.quantity_kg)), 0n);
  const totalKg = `${formatWholeNumber((total / 100n).toString())}.${String(total % 100n).padStart(2, "0")}`;
  const rows = receipt.items.map((item, index) =>
    `<tr><td>${item.line_number ?? index + 1}</td><td><bdi>${escape(item.production_order_number ?? `#${item.production_order_id}`)}</bdi></td>
      <td>${escape(receiptName(item.customer_name_ar, item.customer_name, language))}</td>
      <td>${escape(receiptName(item.product_name_ar, item.product_name, language))}</td>
      <td class="numeric"><bdi>${escape(formatNumber(item.quantity_kg))}</bdi> kg</td></tr>`
  ).join("");
  const logo = safeReceiptLogo(branding?.logoSrc);
  const header = branding ? `<div class="factory-header">
    ${logo ? `<img src="${escape(logo)}" alt="${label("شعار المصنع", "Factory logo")}">` : ""}
    <div class="factory-identity">
      ${branding.companyNameAr ? `<strong lang="ar" dir="rtl">${escape(branding.companyNameAr)}</strong>` : ""}
      ${branding.companyNameEn ? `<strong lang="en" dir="ltr">${escape(branding.companyNameEn)}</strong>` : ""}
      ${branding.address ? `<div>${escape(branding.address)}</div>` : ""}
      ${branding.phone || branding.email ? `<div dir="ltr">${[branding.phone, branding.email].filter(Boolean).map(escape).join(" · ")}</div>` : ""}
      ${branding.taxNumber ? `<div>${label("الرقم الضريبي", "Tax number")}: <bdi>${escape(branding.taxNumber)}</bdi></div>` : ""}
    </div></div>` : "";
  const receiver = receiptName(receipt.receiver_name_ar, receipt.receiver_name, language);
  return `<!doctype html><html lang="${en ? "en" : "ar"}" dir="${en ? "ltr" : "rtl"}"><head><meta charset="utf-8">
    <title>${escape(receipt.voucher_number)}</title><style>
    @page { size:A4 portrait; margin:12mm; }
    * { box-sizing:border-box; } body { margin:0; font-family:Tahoma,Arial,sans-serif; color:#173d35; font-size:11px; line-height:1.5; }
    header { border-bottom:2px solid #376554; padding-bottom:10px; margin-bottom:12px; }
    .factory-header { display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:12px; }
    .factory-header img { width:72px; height:72px; object-fit:contain; flex-shrink:0; }
    .factory-identity { min-width:0; text-align:center; overflow-wrap:anywhere; }
    .factory-identity strong { display:block; font-size:15px; }
    h1 { font-size:20px; margin:0 0 8px; } .meta { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .route { padding:8px 0; } table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th,td { padding:6px 5px; border:1px solid #c7d5ce; vertical-align:top; overflow-wrap:anywhere; }
     th { background:#edf4ef; font-size:10px; } th:first-child { width:5%; } th:nth-child(2) { width:20%; } th:nth-child(3),th:nth-child(4) { width:27%; } th:last-child { width:21%; }
    thead { display:table-header-group; } tr { break-inside:avoid; } .numeric { direction:ltr; font-variant-numeric:tabular-nums; }
    .total { text-align:end; font-weight:bold; margin:12px 0; } .notes { white-space:pre-wrap; overflow-wrap:anywhere; }
    .closing { break-inside:avoid; } .signatures { display:flex; justify-content:space-between; gap:20px; margin-top:30px; }
    .signatures span { width:45%; border-top:1px solid #748d80; padding-top:5px; }
    </style></head><body><header>${header}<h1>${label("سند استلام مواد تامة", "Finished goods receipt voucher")}</h1>
    <div class="meta"><span>${label("رقم السند", "Voucher number")}: <bdi>${escape(receipt.voucher_number)}</bdi></span>
    <span>${label("التاريخ", "Date")}: <bdi>${escape(date)}</bdi></span></div></header>
    <div class="route">${label("المصدر: صالة الإنتاج · الوجهة: صالة المواد التامة", "Source: production hall · Destination: finished-goods hall")}</div>
    <table aria-label="${label("بنود السند", "Voucher lines")}"><thead><tr>
     <th>${label("م", "Line")}</th><th>${label("أمر الإنتاج", "Production order")}</th>
     <th>${label("العميل", "Customer")}</th><th>${label("الصنف", "Item")}</th>
     <th>${label("الكمية المستلمة (كجم)", "Received quantity (kg)")}</th>
    </tr></thead><tbody>${rows}</tbody></table><div class="closing">
     <p class="total">${label("إجمالي السند", "Voucher total")}: <bdi>${totalKg} kg</bdi></p>
    ${receipt.notes ? `<p class="notes">${label("ملاحظات", "Notes")}: ${escape(receipt.notes)}</p>` : ""}
    <div class="signatures"><span>${label("التسليم · صالة الإنتاج", "Released by · production hall")}</span>
    <span>${label("الاستلام · صالة المواد التامة", "Received by · finished-goods hall")}<br>
      ${label("أمين المستودع", "Warehouse keeper")}: ${escape(receiver)}</span></div></div></body></html>`;
}

/** Print only persisted receipt data in its own document, never the dashboard or an unsaved draft. */
export async function printReceipt(receipt: ProductionReceipt, language: string) {
  let branding: ReceiptBranding;
  try { branding = await fetchReceiptBranding(); }
  catch {
    window.alert(language === "en" ? "Factory details could not be loaded. Retry printing." : "تعذر تحميل بيانات المصنع. أعد محاولة الطباعة.");
    return;
  }
  const frame = document.createElement("iframe");
  frame.dataset.receiptPrintFrame = String(receipt.id);
  frame.title = language === "en" ? "Receipt A4 print" : "طباعة سند الاستلام A4";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  const cleanup = () => frame.remove();
  frame.onload = async () => {
    const target = frame.contentWindow;
    if (!target) { cleanup(); return; }
    try {
      await Promise.race([
        Promise.all([target.document.fonts.ready, ...Array.from(target.document.images).map(image => image.decode())]),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Print assets timed out")), 15000)),
      ]);
      target.addEventListener("afterprint", cleanup, { once: true });
      target.focus();
      target.print();
    } catch {
      cleanup();
      window.alert(language === "en" ? "The factory logo could not be prepared for printing." : "تعذر تجهيز شعار المصنع للطباعة.");
    }
  };
  frame.srcdoc = receiptPrintHtml(receipt, language, branding);
  document.body.appendChild(frame);
  window.setTimeout(cleanup, 300000);
}
