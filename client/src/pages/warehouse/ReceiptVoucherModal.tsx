import { Printer, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, type ChangeEvent, type FormEvent, type MutableRefObject } from "react";
import { createPortal } from "react-dom";

import type { ProductionOrderRecord, ProductionReceipt } from "../../../../shared/production";
import { deriveReceiptPacking, type ReceiptDraft } from "../../../../shared/receipt-draft";
import { ReceiptUnit, receiptUnitLabel } from "../../../../shared/production-packing";
import "./receipt-voucher.css";

export type { ReceiptDraft } from "../../../../shared/receipt-draft";
type Props = {
  language: string; eligible: ProductionOrderRecord[];
  drafts: ReceiptDraft[]; notes: string; saving: boolean; locked?: boolean; error: string;
  savedReceipt: ProductionReceipt | null; openerRef: MutableRefObject<HTMLButtonElement | null>;
  onDraftChange: (index: number, key: keyof ReceiptDraft, value: string) => void;
  onAddLine: () => void; onRemoveLine: (index: number) => void; onNotesChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRetry?: () => void; onClose: () => void;
  onPrint?: (receipt: ProductionReceipt) => void;
  orderLabel: (order: ProductionOrderRecord) => string; customerLabel: (order: ProductionOrderRecord) => string;
  number: (value: string | number | null | undefined, language: string, digits?: number) => string;
};
const copy = (language: string) => {
  const en = language === "en";
  return {
    title: en ? "Finished goods receipt voucher" : "سند استلام مواد تامة",
    subtitle: en ? "Transfer between the halls." : "نقل بين الصالتين.",
    source: en ? "Source · production hall" : "المصدر · صالة الإنتاج",
    destination: en ? "Destination · finished-goods hall" : "الوجهة · صالة المواد التامة",
    order: en ? "Production order · product · customer" : "أمر الإنتاج · المنتج · العميل",
    line: en ? "Line" : "السطر",
    productCustomer: en ? "Product · customer" : "المنتج · العميل",
    choose: en ? "Choose an order" : "اختر أمراً",
    quantity: en ? "Quantity to receive (kg)" : "الكمية المطلوب استلامها (كجم)",
    available: en ? "Available" : "المتاح",
    unit: en ? "Packing unit" : "وحدة التعبئة",
    count: en ? "Packing-unit quantity" : "عدد وحدات التعبئة",
    method: en ? "Calculation method" : "طريقة الحساب",
    unitWeight: en ? "Derived unit weight (kg)" : "وزن الوحدة المحسوب (كجم)",
    pieces: en ? "Pieces per unit" : "عدد القطع في الوحدة",
    pieceWeight: en ? "Derived piece weight (grams)" : "وزن القطعة المحسوب (جرام)",
    notes: en ? "Voucher notes" : "ملاحظات السند",
    addLine: en ? "Add packing line" : "إضافة سطر تعبئة",
    remove: en ? "Remove line" : "إزالة السطر",
    total: en ? "Voucher total" : "إجمالي السند",
    save: en ? "Save receipt voucher" : "حفظ سند الاستلام",
    saving: en ? "Saving voucher…" : "جارٍ حفظ السند…",
    close: en ? "Close voucher" : "إغلاق السند",
    retry: en ? "Retry exact same operation" : "إعادة محاولة العملية نفسها",
    saved: en ? "Voucher saved" : "تم حفظ السند",
    voucher: en ? "Voucher number" : "رقم السند",
    time: en ? "Recorded at" : "وقت التسجيل",
    print: en ? "Print A4" : "طباعة A4",
    assignedOnSave: en ? "Assigned on save · FP-Rec0001…" : "يُخصص عند الحفظ · FP-Rec0001…",
    date: en ? "Date" : "التاريخ",
    units: ["kg", "packet", "roll", "piece"] as ReceiptUnit[],
    modeUnit: en ? "Count × unit weight" : "العدد × وزن الوحدة",
    modePiece: en ? "Count × pieces × piece weight" : "العدد × القطع × وزن القطعة",
  };
};
export function ReceiptVoucherModal(props: Props) {
  const {
    language, eligible, drafts, notes, saving, locked = false, error, savedReceipt, openerRef,
    onDraftChange, onAddLine, onRemoveLine, onNotesChange, onSubmit, onRetry, onClose,
    onPrint, orderLabel, customerLabel, number,
  } = props;
  const t = copy(language), dialogRef = useRef<HTMLElement | null>(null), editable = !saving && !locked;
  const openedAt = useRef(new Date());
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = openerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
        else if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, [onClose, openerRef]);
  const derived = drafts.map(row => {
    try { return deriveReceiptPacking(row); } catch { return null; }
  });
  const cents = (weight: string) => {
    const [whole, fraction = ""] = weight.split(".");
    return BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const clearDraft = drafts.length === 1 && !drafts[0].orderId && !drafts[0].count;
  const validRows = derived.every(item => item !== null);
  const centsTotal = clearDraft && savedReceipt
    ? savedReceipt.items.reduce((sum, item) => sum + cents(item.quantity_kg), 0n)
    : validRows ? derived.reduce((sum, item) => sum + cents(item!.result.quantity_kg), 0n) : null;
  const total = centsTotal === null ? "—" : `${centsTotal / 100n}.${String(centsTotal % 100n).padStart(2, "0")}`;
  const shownDate = savedReceipt?.created_at ? new Date(savedReceipt.created_at) : openedAt.current;
  const dateTime = new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(shownDate);
  return createPortal(<div className="production receipt-voucher-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="receipt-voucher-dialog" role="dialog" data-receipt-voucher aria-modal="true" aria-labelledby="receipt-voucher-title" dir={language === "ar" ? "rtl" : "ltr"} tabIndex={-1}>
      <header className="receipt-voucher-header"><div><span className="receipt-voucher-kicker">PRODUCTION / STOCK</span><h2 id="receipt-voucher-title">{t.title}</h2><p>{t.subtitle}</p></div><div className="receipt-voucher-header-actions"><button className="receipt-voucher-print" type="button" aria-label={t.print} title={t.print} disabled={!savedReceipt||!onPrint} onClick={()=>savedReceipt&&onPrint?.(savedReceipt)}><Printer/><span>{t.print}</span></button><button className="receipt-voucher-close" type="button" aria-label={t.close} onClick={onClose}><X /></button></div></header>
      <div className="receipt-voucher-route" aria-label={`${t.source} → ${t.destination}`}><div><small>{t.source}</small><strong>{language === "en" ? "Production hall" : "صالة الإنتاج"}</strong></div><span aria-hidden="true">→</span><div><small>{t.destination}</small><strong>{language === "en" ? "Finished goods" : "المواد التامة"}</strong></div></div>
       <section className={`receipt-voucher-saved${savedReceipt ? "" : " is-pending"}`} role={savedReceipt ? "status" : undefined} aria-live={savedReceipt ? "polite" : undefined} data-receipt-saved={savedReceipt ? JSON.stringify({voucher_number:savedReceipt.voucher_number,created_at:savedReceipt.created_at}) : undefined}>
         <div>{savedReceipt&&<strong>{t.saved}</strong>}<small>{t.voucher}</small>{savedReceipt?<bdi data-receipt-voucher-number>{savedReceipt.voucher_number}</bdi>:<span className="receipt-voucher-pending-number">{t.assignedOnSave}</span>}</div>
         <div><small>{savedReceipt?t.time:t.date}</small><bdi data-receipt-created-at={savedReceipt?.created_at}>{dateTime}</bdi></div>
       </section>
      <form onSubmit={onSubmit}>
        <div className="receipt-voucher-table-wrap">
          <table className="receipt-voucher-table" aria-label={t.title}>
             <thead><tr><th scope="col">{t.line}</th><th scope="col">{t.order}</th><th scope="col">{t.available} (kg)</th><th scope="col">{t.unit}</th><th scope="col">{t.count} · {t.method}</th><th scope="col">{t.quantity}</th></tr></thead>
            <tbody>{drafts.map((row,index)=>{
               const order=eligible.find(item=>String(item.id)===row.orderId), packing=derived[index]?.packing, result=derived[index]?.result;
              const update=(field:keyof ReceiptDraft)=>(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>onDraftChange(index,field,event.target.value);
              return <tr className="receipt-voucher-line" key={index}>
                <td data-label={t.line}><div className="receipt-voucher-table-line">{String(index+1).padStart(2,"0")}{drafts.length>1&&<button className="receipt-voucher-remove" type="button" aria-label={`${t.remove} ${index+1}`} disabled={!editable} onClick={()=>onRemoveLine(index)}><Trash2/><span>{t.remove}</span></button>}</div></td>
                <td data-label={t.order}><div className="prod-field"><select id={`receipt-order-${index}`} value={row.orderId} required disabled={!editable} aria-label={t.order} onChange={update("orderId")}><option value="">{t.choose}</option>{eligible.map(item=><option key={item.id} value={item.id}>{item.production_order_number} · {orderLabel(item)} · {customerLabel(item)}</option>)}</select>{order&&<small className="receipt-voucher-order-context"><bdi>{order.production_order_number}</bdi><strong>{orderLabel(order)}</strong><span>{customerLabel(order)}</span></small>}</div></td>
                <td data-label={`${t.available} (kg)`}><bdi className="receipt-voucher-available">{order?number(order.remaining_kg,language):"—"} kg</bdi></td>
                <td data-label={t.unit}><div className="prod-field"><select id={`receipt-unit-${index}`} data-receipt-unit={index} value={row.unit} aria-label={t.unit} disabled={!editable} onChange={update("unit")}>{t.units.map(unit=><option key={unit} value={unit}>{receiptUnitLabel(unit,language)}</option>)}</select></div></td>
                 <td data-label={`${t.count} · ${t.method}`}><div className="receipt-voucher-packing-cell">
                   <div className="receipt-voucher-packing-controls">
                     <div className="receipt-voucher-control"><label htmlFor={`receipt-unit-quantity-${index}`}>{t.count}</label><input id={`receipt-unit-quantity-${index}`} data-receipt-unit-quantity={index} type="text" inputMode={row.unit==="kg"?"decimal":"numeric"} value={row.unit==="kg"?row.quantity:row.count} required={row.unit!=="kg"} readOnly={row.unit==="kg"} disabled={!editable} onChange={update("count")}/></div>
                     {row.unit!=="kg"&&<div className="receipt-voucher-control"><label htmlFor={`receipt-method-${index}`}>{t.method}</label><select id={`receipt-method-${index}`} data-receipt-method={index} value={row.method} disabled={!editable} onChange={update("method")}><option value="unit_weight">{t.modeUnit}</option><option value="piece_weight">{t.modePiece}</option></select></div>}
                     {row.unit!=="kg"&&row.method==="piece_weight"&&<div className="receipt-voucher-control"><label htmlFor={`receipt-pieces-${index}`}>{t.pieces}</label><input id={`receipt-pieces-${index}`} data-receipt-pieces={index} type="text" inputMode="numeric" value={row.pieces} required disabled={!editable} onChange={update("pieces")}/></div>}
                     {row.unit!=="kg"&&row.method==="unit_weight"&&<div className="receipt-voucher-control"><label htmlFor={`receipt-unit-weight-${index}`}>{t.unitWeight}</label><input id={`receipt-unit-weight-${index}`} data-receipt-unit-weight={index} type="text" inputMode="decimal" value={packing?.unit_weight_kg??""} readOnly aria-readonly="true" disabled={!editable}/></div>}
                     {row.unit!=="kg"&&row.method==="piece_weight"&&<div className="receipt-voucher-control"><label htmlFor={`receipt-piece-weight-${index}`}>{t.pieceWeight}</label><input id={`receipt-piece-weight-${index}`} data-receipt-piece-weight={index} type="text" inputMode="decimal" value={packing?.piece_weight_grams??""} readOnly aria-readonly="true" disabled={!editable}/></div>}
                   </div>
                 </div></td>
                 <td data-label={t.quantity}><input className="receipt-voucher-calculated receipt-voucher-requested" id={`receipt-quantity-${index}`} data-receipt-quantity={index} type="text" inputMode="decimal" value={row.quantity} required disabled={!editable} aria-label={t.quantity} onChange={update("quantity")}/><small className="receipt-voucher-derived-total">{result?`${language==="en"?"Calculated":"المحسوب"}: ${number(result.quantity_kg,language)} kg`:""}</small></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <button className="prod-btn secondary receipt-voucher-add" type="button" disabled={!editable||drafts.length>=100||!eligible.length} onClick={onAddLine}><Plus/>{t.addLine}</button>
         <div className="prod-field receipt-voucher-notes"><label htmlFor="receipt-notes">{t.notes}</label><textarea id="receipt-notes" rows={2} value={notes} maxLength={2000} disabled={!editable} onChange={event=>onNotesChange(event.target.value)}/></div>
         <div className="receipt-voucher-total" data-receipt-total={total}><span>{t.total}</span><strong><bdi data-receipt-total-value>{total==="—"?"—":`${number(total,language)} kg`}</bdi></strong></div>
        {error&&<div className="prod-error receipt-voucher-error" role="alert"><span>{error}</span>{!saving&&onRetry&&<button className="prod-btn quiet" type="button" onClick={onRetry}>{t.retry}</button>}</div>}
        <footer className="receipt-voucher-footer"><button className="prod-btn quiet" type="button" disabled={saving} onClick={onClose}>{language==="en"?"Close":"إغلاق"}</button><button className="prod-btn" data-receipt-submit type="submit" disabled={saving||locked||!eligible.length}>{saving?t.saving:t.save}</button></footer>
      </form>
    </section>
  </div>,document.body);
}
