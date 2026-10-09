import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, type FormEvent, type MutableRefObject } from "react";
import { createPortal } from "react-dom";

import type { ProductionOrderRecord, ProductionReceipt, StorageLocation } from "../../../../shared/production";
import "./receipt-voucher.css";

export type ReceiptDraft = {
  orderId: string;
  locationId: string;
  quantity: string;
  packaging: boolean;
  rollWeight: string;
  rollsPerUnit: string;
  units: string;
};

type Props = {
  language: string;
  eligible: ProductionOrderRecord[];
  locations: StorageLocation[];
  drafts: ReceiptDraft[];
  notes: string;
  saving: boolean;
  error: string;
  savedReceipt: ProductionReceipt | null;
  openerRef: MutableRefObject<HTMLButtonElement | null>;
  onDraftChange: (index: number, key: keyof ReceiptDraft, value: string | boolean) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onNotesChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry?: () => void;
  onClose: () => void;
  orderLabel: (order: ProductionOrderRecord) => string;
  customerLabel: (order: ProductionOrderRecord) => string;
  locationLabel: (location: StorageLocation) => string;
  number: (value: string | number | null | undefined, language: string, digits?: number) => string;
};

const copy = (language: string) => {
  const en = language === "en";
  return {
    title: en ? "Finished goods receipt voucher" : "سند استلام مواد تامة",
    subtitle: en ? "Record finished production into a warehouse location." : "تسجيل الإنتاج التام في موقع تخزين.",
    source: en ? "Source · production hall" : "المصدر · صالة الإنتاج",
    destination: en ? "Destination · finished-goods hall" : "الوجهة · صالة المواد التامة",
    order: en ? "Production order" : "أمر الإنتاج",
    choose: en ? "Choose an order" : "اختر أمراً",
    location: en ? "Finished-goods location" : "موقع المواد التامة",
    chooseLocation: en ? "Choose a location" : "اختر موقعاً",
    quantity: en ? "Receipt quantity (kg)" : "كمية الاستلام (كجم)",
    available: en ? "Available" : "المتاح",
    packaging: en ? "Packaging details (optional)" : "بيانات التعبئة (اختيارية)",
    rollWeight: en ? "Roll weight (grams)" : "وزن الرول (جرام)",
    rollsPerUnit: en ? "Rolls per unit" : "رولات في الوحدة",
    units: en ? "Units" : "عدد الوحدات",
    notes: en ? "Voucher notes" : "ملاحظات السند",
    addLine: en ? "Add order line" : "إضافة أمر للاستلام",
    remove: en ? "Remove line" : "إزالة السطر",
    total: en ? "Voucher total" : "إجمالي السند",
    save: en ? "Save receipt voucher" : "حفظ سند الاستلام",
    saving: en ? "Saving voucher…" : "جارٍ حفظ السند…",
    close: en ? "Close voucher" : "إغلاق السند",
    retry: en ? "Retry same operation" : "إعادة محاولة العملية نفسها",
    saved: en ? "Voucher saved" : "تم حفظ السند",
    voucher: en ? "Voucher number" : "رقم السند",
    time: en ? "Recorded at" : "وقت التسجيل",
    noLocations: en ? "No active finished-goods locations are available." : "لا توجد مواقع نشطة للمواد التامة.",
    kg: "kg",
  };
};

export function ReceiptVoucherModal(props: Props) {
  const {
    language, eligible, locations, drafts, notes, saving, error, savedReceipt, openerRef,
    onDraftChange, onAddLine, onRemoveLine, onNotesChange, onSubmit, onRetry, onClose,
    orderLabel, customerLabel, locationLabel, number,
  } = props;
  const t = copy(language);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : openerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.offsetParent !== null);
    (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
          event.preventDefault();
          items[0].focus();
        } else if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0]).focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose, openerRef]);

  const draftTotal = drafts.reduce((sum, row) => {
    const parsed = Number(row.quantity);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  const currentDraftIsCleared = drafts.length === 1 && !drafts[0].orderId && !drafts[0].locationId &&
    !drafts[0].quantity && !drafts[0].packaging && !drafts[0].rollWeight && !drafts[0].rollsPerUnit && !drafts[0].units;
  const total = savedReceipt && currentDraftIsCleared
    ? savedReceipt.items.reduce((sum, item) => sum + Number(item.quantity_kg), 0)
    : draftTotal;
  const dateTime = savedReceipt?.created_at
    ? new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
    }).format(new Date(savedReceipt.created_at))
    : "—";

  return createPortal(
    <div className="production receipt-voucher-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="receipt-voucher-dialog"
        role="dialog"
        data-receipt-voucher
        aria-modal="true"
        aria-labelledby="receipt-voucher-title"
        dir={language === "ar" ? "rtl" : "ltr"}
        tabIndex={-1}
      >
        <header className="receipt-voucher-header">
          <div>
            <span className="receipt-voucher-kicker">PRODUCTION / STOCK</span>
            <h2 id="receipt-voucher-title">{t.title}</h2>
            <p>{t.subtitle}</p>
          </div>
          <button className="receipt-voucher-close" type="button" aria-label={t.close} onClick={onClose}><X /></button>
        </header>

        <div className="receipt-voucher-route" aria-label={`${t.source} → ${t.destination}`}>
          <div><small>{t.source}</small><strong>{language === "en" ? "Production hall" : "صالة الإنتاج"}</strong></div>
          <span aria-hidden="true">→</span>
          <div><small>{t.destination}</small><strong>{language === "en" ? "Finished goods" : "المواد التامة"}</strong></div>
        </div>

        {savedReceipt && <section className="receipt-voucher-saved" role="status" aria-live="polite" data-receipt-saved={JSON.stringify({voucher_number:savedReceipt.voucher_number,created_at:savedReceipt.created_at})}>
          <div><strong>{t.saved}</strong><small>{t.voucher}</small><bdi data-receipt-voucher-number>{savedReceipt.voucher_number}</bdi></div>
          <div><small>{t.time}</small><bdi data-receipt-created-at={savedReceipt.created_at}>{dateTime}</bdi></div>
        </section>}

        <form onSubmit={onSubmit}>
          {!locations.length && <div className="receipt-voucher-alert">{t.noLocations}</div>}
          <div className="receipt-voucher-lines">
            {drafts.map((row, index) => {
              const order = eligible.find(item => String(item.id) === row.orderId);
              return <article className="receipt-voucher-line" key={index}>
                <div className="receipt-voucher-line-head">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {drafts.length > 1 && <button className="receipt-voucher-remove" type="button" aria-label={`${t.remove} ${index + 1}`} disabled={saving} onClick={() => onRemoveLine(index)}><Trash2 />{t.remove}</button>}
                </div>
                <div className="prod-form-grid">
                  <div className="prod-field">
                    <label htmlFor={`receipt-order-${index}`}>{t.order}</label>
                    <select id={`receipt-order-${index}`} value={row.orderId} required disabled={saving} onChange={event => onDraftChange(index, "orderId", event.target.value)}>
                      <option value="">{t.choose}</option>
                      {eligible.map(item => <option key={item.id} value={item.id}>{item.production_order_number} · {item.order_number} · {orderLabel(item)}{customerLabel(item) !== "—" ? ` · ${customerLabel(item)}` : ""}</option>)}
                    </select>
                  </div>
                  <div className="prod-field">
                    <label htmlFor={`receipt-location-${index}`}>{t.location}</label>
                    <select id={`receipt-location-${index}`} value={row.locationId} required disabled={saving} onChange={event => onDraftChange(index, "locationId", event.target.value)}>
                      <option value="">{t.chooseLocation}</option>
                      {locations.map(location => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                    </select>
                  </div>
                  <div className="prod-field">
                    <label htmlFor={`receipt-quantity-${index}`}>{t.quantity}</label>
                    <div className="receipt-voucher-quantity">
                      <input id={`receipt-quantity-${index}`} type="number" inputMode="decimal" min="0.01" max={order?.remaining_kg} step="0.01" value={row.quantity} required disabled={saving} aria-describedby={`receipt-available-${index}`} onChange={event => onDraftChange(index, "quantity", event.target.value)} />
                      <small id={`receipt-available-${index}`}>{t.available}: <bdi>{order ? number(order.remaining_kg, language) : "—"} {t.kg}</bdi></small>
                    </div>
                  </div>
                  <label className="prod-label-inline receipt-voucher-packaging"><input type="checkbox" checked={row.packaging} disabled={saving} onChange={event => onDraftChange(index, "packaging", event.target.checked)} />{t.packaging}</label>
                </div>
                {row.packaging && <div className="prod-form-grid receipt-voucher-packaging-fields">
                  <div className="prod-field"><label htmlFor={`grams-${index}`}>{t.rollWeight}</label><input id={`grams-${index}`} type="number" min="0.0001" step="0.0001" value={row.rollWeight} required disabled={saving} onChange={event => onDraftChange(index, "rollWeight", event.target.value)} /></div>
                  <div className="prod-field"><label htmlFor={`per-unit-${index}`}>{t.rollsPerUnit}</label><input id={`per-unit-${index}`} type="number" min="1" step="1" value={row.rollsPerUnit} required disabled={saving} onChange={event => onDraftChange(index, "rollsPerUnit", event.target.value)} /></div>
                  <div className="prod-field"><label htmlFor={`units-${index}`}>{t.units}</label><input id={`units-${index}`} type="number" min="1" step="1" value={row.units} required disabled={saving} onChange={event => onDraftChange(index, "units", event.target.value)} /></div>
                </div>}
              </article>;
            })}
          </div>
          <button className="prod-btn secondary receipt-voucher-add" type="button" disabled={saving || !eligible.length} onClick={onAddLine}><Plus />{t.addLine}</button>
          <div className="prod-field receipt-voucher-notes"><label htmlFor="receipt-notes">{t.notes}</label><textarea id="receipt-notes" value={notes} maxLength={2000} disabled={saving} onChange={event => onNotesChange(event.target.value)} /></div>
          <div className="receipt-voucher-total" data-receipt-total={total}><span>{t.total}</span><strong><bdi>{number(total, language)} kg</bdi></strong></div>
          {error && <div className="prod-error receipt-voucher-error" role="alert"><span>{error}</span>{!saving && onRetry && <button className="prod-btn quiet" type="button" onClick={onRetry}>{t.retry}</button>}</div>}
          <footer className="receipt-voucher-footer">
            <button className="prod-btn quiet" type="button" disabled={saving} onClick={onClose}>{language === "en" ? "Close" : "إغلاق"}</button>
            <button className="prod-btn" type="submit" disabled={saving || !locations.length || !eligible.length}>{saving ? t.saving : t.save}</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
