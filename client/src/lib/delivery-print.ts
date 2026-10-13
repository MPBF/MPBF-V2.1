import type { FinishedDelivery } from "../../../shared/production";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
const local = (ar: string|null|undefined,en:string|null|undefined,language:string,fallback="—") =>
  language==="en" ? en && !/[\u0600-\u06ff]/.test(en) ? en : fallback : ar || en || fallback;
export function deliveryPrintHtml(delivery: FinishedDelivery, language: string) {
  const en=language==="en";
  const tr=(ar:string,english:string)=>en?english:ar;
  const quantity=(value:string)=>new Intl.NumberFormat(en?"en-US":"ar-SA-u-nu-latn",{maximumFractionDigits:2}).format(Number(value));
  const date=new Intl.DateTimeFormat(en?"en-GB":"ar-SA-u-ca-gregory-nu-latn",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Riyadh"}).format(new Date(delivery.created_at));
  return `<!doctype html><html lang="${en?"en":"ar"}" dir="${en?"ltr":"rtl"}"><head><meta charset="utf-8">
    <title>${escape(delivery.voucher_number)}</title><style>
    @page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#152c25;margin:0}
    h1{font-size:24px;margin:0 0 18px}header{border-bottom:2px solid #28644e;padding-bottom:14px}
    .meta{display:flex;flex-wrap:wrap;gap:14px;line-height:1.8;margin:18px 0}table{border-collapse:collapse;width:100%;table-layout:fixed}
    th,td{padding:9px;border:1px solid #bbb;text-align:start;overflow-wrap:anywhere}th{background:#f1f5f1}
    thead{display:table-header-group}tr{break-inside:avoid}td:first-child{font-size:12px}.note{white-space:pre-wrap;overflow-wrap:anywhere}
    footer{margin-top:25px;display:flex;justify-content:space-between;gap:12px}
    </style></head><body><header><h1>${tr("سند تسليم مواد تامة","Finished-goods delivery voucher")}</h1><b>MPBF · ${escape(delivery.voucher_number)}</b></header>
    <div class="meta"><span>${tr("التاريخ","Date")}: ${escape(date)}</span><span>${tr("المصدر: مخزون المواد التامة","Source: Finished inventory")}</span>
    <span>${tr("الجهة المستلمة (العميل)","Recipient (customer)")}: ${escape(local(delivery.customer_name_ar,delivery.customer_name,language,delivery.customer_id))}</span></div>
    <table><thead><tr><th style="width:24%">${tr("أمر الإنتاج","Production order")}</th><th>${tr("المنتج","Product")}</th><th style="width:22%">${tr("الكمية المسلّمة (كجم)","Delivered (kg)")}</th></tr></thead><tbody>
    ${delivery.items.map(i=>`<tr><td>${escape(i.production_order_number)}</td><td>${escape(local(i.product.name_ar,i.product.name,language,i.item_id))}</td><td>${escape(quantity(i.quantity_kg))}</td></tr>`).join("")}
    </tbody></table><p><b>${tr("إجمالي التسليم","Total delivery")}: ${escape(quantity(String(delivery.items.reduce((sum,i)=>sum+Number(i.quantity_kg),0))))} kg</b></p>
    <p class="note">${tr("ملاحظات","Notes")}: ${escape(delivery.notes||"—")}</p><footer><span>${tr("توقيع أمين المستودع","Warehouse signature")}: __________</span><span>${tr("توقيع العميل المستلم","Customer signature")}: __________</span></footer></body></html>`;
}
export function printDelivery(delivery: FinishedDelivery, language: string) {
  const popup=window.open("","_blank");
  if(!popup) throw new Error(language==="en"?"Allow pop-ups to print the saved voucher.":"اسمح بالنوافذ المنبثقة لطباعة السند المحفوظ.");
  popup.opener=null;popup.document.write(deliveryPrintHtml(delivery,language));popup.document.close();
  let printed=false;
  const print=()=>{if(printed)return;printed=true;popup.focus();popup.print();};
  popup.onload=print;
  if(popup.document.readyState==="complete")print();
}
