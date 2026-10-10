import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, type ChangeEvent, type FormEvent, type MutableRefObject } from "react";
import { createPortal } from "react-dom";

import type { ProductionOrderRecord, ProductionReceipt } from "../../../../shared/production";
import { calculatePacking, receiptUnitLabel, type ReceiptUnit } from "../../../../shared/production-packing";
import "./receipt-voucher.css";

export type ReceiptDraft = {
  orderId: string; quantity: string;
  unit: ReceiptUnit; count: string; method: "unit_weight" | "piece_weight";
  unitWeight: string; pieces: string; pieceWeight: string;
};
type Props = {
  language: string; eligible: ProductionOrderRecord[];
  drafts: ReceiptDraft[]; notes: string; saving: boolean; locked?: boolean; error: string;
  savedReceipt: ProductionReceipt | null; openerRef: MutableRefObject<HTMLButtonElement | null>;
  onDraftChange: (index: number, key: keyof ReceiptDraft, value: string) => void;
  onAddLine: () => void; onRemoveLine: (index: number) => void; onNotesChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRetry?: () => void; onClose: () => void;
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
    quantity: en ? "Calculated weight (kg)" : "الوزن المحسوب (كجم)",
    available: en ? "Available" : "المتاح",
    unit: en ? "Packing unit" : "وحدة التعبئة",
    count: en ? "Packing-unit quantity" : "عدد وحدات التعبئة",
    method: en ? "Calculation method" : "طريقة الحساب",
    unitWeight: en ? "Weight per unit (kg)" : "وزن الوحدة (كجم)",
    pieces: en ? "Pieces per unit" : "عدد القطع في الوحدة",
    pieceWeight: en ? "Weight per piece (grams)" : "وزن القطعة (جرام)",
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
    units: ["kg", "packet", "roll", "piece"] as ReceiptUnit[],
    modeUnit: en ? "Count × unit weight" : "العدد × وزن الوحدة",
    modePiece: en ? "Count × pieces × piece weight" : "العدد × القطع × وزن القطعة",
  };
};
const latinDigits=(value:string)=>value.replace(/[٠-٩]/g,digit=>String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g,digit=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g,".").replace(/٬/g,",");
export function ReceiptVoucherModal(props: Props) {
  const {
    language, eligible, drafts, notes, saving, locked = false, error, savedReceipt, openerRef,
    onDraftChange, onAddLine, onRemoveLine, onNotesChange, onSubmit, onRetry, onClose,
    orderLabel, customerLabel, number,
  } = props;
  const t = copy(language), dialogRef = useRef<HTMLElement | null>(null), editable = !saving && !locked;
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
  const packed = drafts.map(row => {
    try {
      return calculatePacking(row.unit === "kg"
        ? { unit: "kg", method: "unit_weight", quantity: latinDigits(row.count) }
        : row.method === "unit_weight"
          ? { unit: row.unit, method: row.method, quantity: latinDigits(row.count), unit_weight_kg: latinDigits(row.unitWeight) }
          : { unit: row.unit, method: row.method, quantity: latinDigits(row.count), pieces_per_unit: Number(latinDigits(row.pieces)), piece_weight_grams: latinDigits(row.pieceWeight) });
    } catch { return null; }
  });
  const cents = (weight: string) => {
    const [whole, fraction = ""] = weight.split(".");
    return BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const clearDraft = drafts.length === 1 && !drafts[0].orderId && !drafts[0].count;
  const centsTotal = clearDraft && savedReceipt
    ? savedReceipt.items.reduce((sum, item) => sum + cents(item.quantity_kg), 0n)
    : packed.reduce((sum, result) => sum + (result ? cents(result.quantity_kg) : 0n), 0n);
  const total = `${centsTotal / 100n}.${String(centsTotal % 100n).padStart(2, "0")}`;
  const dateTime = savedReceipt?.created_at ? new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(savedReceipt.created_at)) : "—";
  return createPortal(<div className="production receipt-voucher-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="receipt-voucher-dialog" role="dialog" data-receipt-voucher aria-modal="true" aria-labelledby="receipt-voucher-title" dir={language === "ar" ? "rtl" : "ltr"} tabIndex={-1}>
      <header className="receipt-voucher-header"><div><span className="receipt-voucher-kicker">PRODUCTION / STOCK</span><h2 id="receipt-voucher-title">{t.title}</h2><p>{t.subtitle}</p></div><button className="receipt-voucher-close" type="button" aria-label={t.close} onClick={onClose}><X /></button></header>
      <div className="receipt-voucher-route" aria-label={`${t.source} → ${t.destination}`}><div><small>{t.source}</small><strong>{language === "en" ? "Production hall" : "صالة الإنتاج"}</strong></div><span aria-hidden="true">→</span><div><small>{t.destination}</small><strong>{language === "en" ? "Finished goods" : "المواد التامة"}</strong></div></div>
      {savedReceipt && <section className="receipt-voucher-saved" role="status" aria-live="polite" data-receipt-saved={JSON.stringify({voucher_number:savedReceipt.voucher_number,created_at:savedReceipt.created_at})}><div><strong>{t.saved}</strong><small>{t.voucher}</small><bdi data-receipt-voucher-number>{savedReceipt.voucher_number}</bdi></div><div><small>{t.time}</small><bdi data-receipt-created-at={savedReceipt.created_at}>{dateTime}</bdi></div></section>}
      <form onSubmit={onSubmit}>
        <div className="receipt-voucher-table-wrap">
          <table className="receipt-voucher-table" aria-label={t.title}>
             <thead><tr><th scope="col">{t.line}</th><th scope="col">{t.order}</th><th scope="col">{t.available} (kg)</th><th scope="col">{t.unit}</th><th scope="col">{t.count} · {t.method}</th><th scope="col">{t.quantity}</th></tr></thead>
            <tbody>{drafts.map((row,index)=>{
              const order=eligible.find(item=>String(item.id)===row.orderId), result=packed[index];
              const update=(field:keyof ReceiptDraft)=>(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>onDraftChange(index,field,event.target.value);
              return <tr className="receipt-voucher-line" key={index}>
                <td data-label={t.line}><div className="receipt-voucher-table-line">{String(index+1).padStart(2,"0")}{drafts.length>1&&<button className="receipt-voucher-remove" type="button" aria-label={`${t.remove} ${index+1}`} disabled={!editable} onClick={()=>onRemoveLine(index)}><Trash2/><span>{t.remove}</span></button>}</div></td>
                <td data-label={t.order}><div className="prod-field"><select id={`receipt-order-${index}`} value={row.orderId} required disabled={!editable} aria-label={t.order} onChange={update("orderId")}><option value="">{t.choose}</option>{eligible.map(item=><option key={item.id} value={item.id}>{item.production_order_number} · {orderLabel(item)} · {customerLabel(item)}</option>)}</select>{order&&<small className="receipt-voucher-order-context"><bdi>{order.production_order_number}</bdi><strong>{orderLabel(order)}</strong><span>{customerLabel(order)}</span></small>}</div></td>
                <td data-label={`${t.available} (kg)`}><bdi className="receipt-voucher-available">{order?number(order.remaining_kg,language):"—"} kg</bdi></td>
                <td data-label={t.unit}><div className="prod-field"><select id={`receipt-unit-${index}`} data-receipt-unit={index} value={row.unit} aria-label={t.unit} disabled={!editable} onChange={update("unit")}>{t.units.map(unit=><option key={unit} value={unit}>{receiptUnitLabel(unit,language)}</option>)}</select></div></td>
                <td data-label={`${t.count} · ${t.method}`}><div className="receipt-voucher-packing-cell">
                  <label className="sr-only" htmlFor={`receipt-unit-quantity-${index}`}>{t.count}</label><input id={`receipt-unit-quantity-${index}`} data-receipt-unit-quantity={index} type="text" inputMode={row.unit==="kg"?"decimal":"numeric"} value={row.count} required disabled={!editable} onChange={update("count")}/>
                  {row.unit==="kg"?<small>{language==="en"?"kg × 1.00 = kg":"كجم × 1٫00 = كجم"}</small>:<>
                    <label className="sr-only" htmlFor={`receipt-method-${index}`}>{t.method}</label><select id={`receipt-method-${index}`} data-receipt-method={index} value={row.method} disabled={!editable} onChange={update("method")}><option value="unit_weight">{t.modeUnit}</option><option value="piece_weight">{t.modePiece}</option></select>
                    {row.method==="unit_weight"?<><label htmlFor={`receipt-unit-weight-${index}`}>{t.unitWeight}</label><input id={`receipt-unit-weight-${index}`} data-receipt-unit-weight={index} type="text" inputMode="decimal" value={row.unitWeight} placeholder={t.unitWeight} required disabled={!editable} onChange={update("unitWeight")}/></>:
                    <div className="receipt-voucher-piece-spec"><label htmlFor={`receipt-pieces-${index}`}>{t.pieces}</label><input id={`receipt-pieces-${index}`} data-receipt-pieces={index} type="text" inputMode="numeric" value={row.pieces} placeholder={t.pieces} required disabled={!editable} onChange={update("pieces")}/><label htmlFor={`receipt-piece-weight-${index}`}>{t.pieceWeight}</label><input id={`receipt-piece-weight-${index}`} data-receipt-piece-weight={index} type="text" inputMode="decimal" value={row.pieceWeight} placeholder={t.pieceWeight} required disabled={!editable} onChange={update("pieceWeight")}/></div>}
                  </>}
                </div></td>
                <td data-label={t.quantity}><input className="receipt-voucher-calculated" id={`receipt-quantity-${index}`} data-receipt-quantity={index} readOnly value={result?.quantity_kg??""} aria-label={t.quantity}/></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <button className="prod-btn secondary receipt-voucher-add" type="button" disabled={!editable||drafts.length>=100||!eligible.length} onClick={onAddLine}><Plus/>{t.addLine}</button>
        <div className="prod-field receipt-voucher-notes"><label htmlFor="receipt-notes">{t.notes}</label><textarea id="receipt-notes" value={notes} maxLength={2000} disabled={!editable} onChange={event=>onNotesChange(event.target.value)}/></div>
        <div className="receipt-voucher-total" data-receipt-total={total}><span>{t.total}</span><strong><bdi data-receipt-total-value>{number(total,language)} kg</bdi></strong></div>
        {error&&<div className="prod-error receipt-voucher-error" role="alert"><span>{error}</span>{!saving&&onRetry&&<button className="prod-btn quiet" type="button" onClick={onRetry}>{t.retry}</button>}</div>}
        <footer className="receipt-voucher-footer"><button className="prod-btn quiet" type="button" disabled={saving} onClick={onClose}>{language==="en"?"Close":"إغلاق"}</button><button className="prod-btn" data-receipt-submit type="submit" disabled={saving||locked||!eligible.length}>{saving?t.saving:t.save}</button></footer>
      </form>
    </section>
  </div>,document.body);
}
