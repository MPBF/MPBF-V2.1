import { Printer, Plus, Trash2, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";

import type { ProductionOrderRecord, ProductionReceipt } from "../../../../shared/production";
import { deriveReceiptPacking, type ReceiptDraft } from "../../../../shared/receipt-draft";
import { ReceiptUnit, receiptUnitLabel } from "../../../../shared/production-packing";
import "./receipt-voucher.css";

export type { ReceiptDraft } from "../../../../shared/receipt-draft";

type Props = {
  language: string;
  eligible: ProductionOrderRecord[];
  drafts: ReceiptDraft[];
  notes: string;
  saving: boolean;
  locked?: boolean;
  error: string;
  savedReceipt: ProductionReceipt | null;
  openerRef: MutableRefObject<HTMLButtonElement | null>;
  onDraftChange: (index: number, key: keyof ReceiptDraft, value: string) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onNotesChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry?: () => void;
  onClose: () => void;
  onPrint?: (receipt: ProductionReceipt) => void;
  orderLabel: (order: ProductionOrderRecord) => string;
  customerLabel: (order: ProductionOrderRecord) => string;
  number: (value: string | number | null | undefined, language: string, digits?: number) => string;
};

// 1. نقل النصوص خارج الكومبوننت لتجنب إنشائها مع كل Render
const TRANSLATIONS = {
  en: {
    title: "Finished goods receipt voucher",
    subtitle: "Transfer between the halls.",
    source: "Source · production hall",
    destination: "Destination · finished-goods hall",
    sourceName: "Production hall",
    destName: "Finished goods",
    order: "Production order · product · customer",
    line: "Line",
    choose: "Choose an order",
    quantity: "Quantity to receive (kg)",
    available: "Available",
    unit: "Packing unit",
    count: "Packing-unit quantity",
    method: "Calculation method",
    unitWeight: "Derived unit weight (kg)",
    pieces: "Pieces per unit",
    pieceWeight: "Derived piece weight (grams)",
    notes: "Voucher notes",
    addLine: "Add packing line",
    remove: "Remove line",
    total: "Voucher total",
    save: "Save receipt voucher",
    saving: "Saving voucher…",
    close: "Close voucher",
    closeBtn: "Close",
    retry: "Retry exact same operation",
    saved: "Voucher saved",
    voucher: "Voucher number",
    time: "Recorded at",
    print: "Print A4",
    assignedOnSave: "Assigned on save · FP-Rec0001…",
    date: "Date",
    calculated: "Calculated",
    units: ["kg", "packet", "roll", "piece"] as ReceiptUnit[],
    modeUnit: "Count × unit weight",
    modePiece: "Count × pieces × piece weight",
  },
  ar: {
    title: "سند استلام مواد تامة",
    subtitle: "نقل بين الصالتين.",
    source: "المصدر · صالة الإنتاج",
    destination: "الوجهة · صالة المواد التامة",
    sourceName: "صالة الإنتاج",
    destName: "المواد التامة",
    order: "أمر الإنتاج · المنتج · العميل",
    line: "السطر",
    choose: "اختر أمراً",
    quantity: "الكمية المطلوب استلامها (كجم)",
    available: "المتاح",
    unit: "وحدة التعبئة",
    count: "عدد وحدات التعبئة",
    method: "طريقة الحساب",
    unitWeight: "وزن الوحدة المحسوب (كجم)",
    pieces: "عدد القطع في الوحدة",
    pieceWeight: "وزن القطعة المحسوب (جرام)",
    notes: "ملاحظات السند",
    addLine: "إضافة سطر تعبئة",
    remove: "إزالة السطر",
    total: "إجمالي السند",
    save: "حفظ سند الاستلام",
    saving: "جارٍ حفظ السند…",
    close: "إغلاق السند",
    closeBtn: "إغلاق",
    retry: "إعادة محاولة العملية نفسها",
    saved: "تم حفظ السند",
    voucher: "رقم السند",
    time: "وقت التسجيل",
    print: "طباعة A4",
    assignedOnSave: "يُخصص عند الحفظ · FP-Rec0001…",
    date: "التاريخ",
    calculated: "المحسوب",
    units: ["kg", "packet", "roll", "piece"] as ReceiptUnit[],
    modeUnit: "العدد × وزن الوحدة",
    modePiece: "العدد × القطع × وزن القطعة",
  },
};

const parseCents = (weight: string) => {
  const [whole = "0", fraction = ""] = weight.split(".");
  return BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};

export function ReceiptVoucherModal(props: Props) {
  const {
    language, eligible, drafts, notes, saving, locked = false, error, savedReceipt, openerRef,
    onDraftChange, onAddLine, onRemoveLine, onNotesChange, onSubmit, onRetry, onClose,
    onPrint, orderLabel, customerLabel, number,
  } = props;

  const t = language === "en" ? TRANSLATIONS.en : TRANSLATIONS.ar;
  const dialogRef = useRef<HTMLElement | null>(null);
  const openedAt = useRef(new Date());
  const editable = !saving && !locked;

  // إدارة التركيز والـ Keyboard Trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previous = openerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null);

    (getFocusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const items = getFocusable();
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        } else if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
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

  // 2. استخدام useMemo لتفادي إعادة الحسابات مع كتابة الملاحظات
  const derived = useMemo(() => {
    return drafts.map((row) => {
      try {
        return deriveReceiptPacking(row);
      } catch {
        return null;
      }
    });
  }, [drafts]);

  // حساب المجموع الكلي
  const total = useMemo(() => {
    const clearDraft = drafts.length === 1 && !drafts[0].orderId && !drafts[0].count;
    const validRows = derived.every((item) => item !== null);

    let centsTotal: bigint | null = null;
    if (clearDraft && savedReceipt) {
      centsTotal = savedReceipt.items.reduce((sum, item) => sum + parseCents(item.quantity_kg), 0n);
    } else if (validRows) {
      centsTotal = derived.reduce((sum, item) => sum + parseCents(item!.result.quantity_kg), 0n);
    }

    if (centsTotal === null) return "—";
    return `${centsTotal / 100n}.${String(centsTotal % 100n).padStart(2, "0")}`;
  }, [drafts, derived, savedReceipt]);

  // تجهيز التاريخ المنسق
  const dateTime = useMemo(() => {
    const shownDate = savedReceipt?.created_at ? new Date(savedReceipt.created_at) : openedAt.current;
    return new Intl.DateTimeFormat(
      language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }
    ).format(shownDate);
  }, [savedReceipt?.created_at, language]);

  return createPortal(
    <div
      className="production receipt-voucher-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
          <div className="receipt-voucher-header-actions">
            <button
              className="receipt-voucher-print"
              type="button"
              aria-label={t.print}
              title={t.print}
              disabled={!savedReceipt || !onPrint}
              onClick={() => savedReceipt && onPrint?.(savedReceipt)}
            >
              <Printer />
              <span>{t.print}</span>
            </button>
            <button
              className="receipt-voucher-close"
              type="button"
              aria-label={t.close}
              onClick={onClose}
            >
              <X />
            </button>
          </div>
        </header>

        <div className="receipt-voucher-route" aria-label={`${t.source} → ${t.destination}`}>
          <div>
            <small>{t.source}</small>
            <strong>{t.sourceName}</strong>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <small>{t.destination}</small>
            <strong>{t.destName}</strong>
          </div>
        </div>

        <section
          className={`receipt-voucher-saved${savedReceipt ? "" : " is-pending"}`}
          role={savedReceipt ? "status" : undefined}
          aria-live={savedReceipt ? "polite" : undefined}
          data-receipt-saved={
            savedReceipt
              ? JSON.stringify({
                  voucher_number: savedReceipt.voucher_number,
                  created_at: savedReceipt.created_at,
                })
              : undefined
          }
        >
          <div>
            {savedReceipt && <strong>{t.saved}</strong>}
            <small>{t.voucher}</small>
            {savedReceipt ? (
              <bdi data-receipt-voucher-number>{savedReceipt.voucher_number}</bdi>
            ) : (
              <span className="receipt-voucher-pending-number">{t.assignedOnSave}</span>
            )}
          </div>
          <div>
            <small>{savedReceipt ? t.time : t.date}</small>
            <bdi data-receipt-created-at={savedReceipt?.created_at}>{dateTime}</bdi>
          </div>
        </section>

        <form onSubmit={onSubmit}>
          <div className="receipt-voucher-table-wrap">
            <table className="receipt-voucher-table" aria-label={t.title}>
              <thead>
                <tr>
                  <th scope="col">{t.line}</th>
                  <th scope="col">{t.order}</th>
                  <th scope="col">{t.available} (kg)</th>
                  <th scope="col">{t.unit}</th>
                  <th scope="col">{t.count} · {t.method}</th>
                  <th scope="col">{t.quantity}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((row, index) => {
                  const order = eligible.find((item) => String(item.id) === row.orderId);
                  const packing = derived[index]?.packing;
                  const result = derived[index]?.result;

                  const handleFieldChange =
                    (field: keyof ReceiptDraft) =>
                    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
                      onDraftChange(index, field, e.target.value);

                  return (
                    <tr className="receipt-voucher-line" key={index}>
                      <td data-label={t.line}>
                        <div className="receipt-voucher-table-line">
                          {String(index + 1).padStart(2, "0")}
                          {drafts.length > 1 && (
                            <button
                              className="receipt-voucher-remove"
                              type="button"
                              aria-label={`${t.remove} ${index + 1}`}
                              disabled={!editable}
                              onClick={() => onRemoveLine(index)}
                            >
                              <Trash2 />
                              <span>{t.remove}</span>
                            </button>
                          )}
                        </div>
                      </td>

                      <td data-label={t.order}>
                        <div className="prod-field">
                          <select
                            id={`receipt-order-${index}`}
                            value={row.orderId}
                            required
                            disabled={!editable}
                            aria-label={t.order}
                            onChange={handleFieldChange("orderId")}
                          >
                            <option value="">{t.choose}</option>
                            {eligible.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.production_order_number} · {orderLabel(item)} · {customerLabel(item)}
                              </option>
                            ))}
                          </select>
                          {order && (
                            <small className="receipt-voucher-order-context">
                              <bdi>{order.production_order_number}</bdi>
                              <strong>{orderLabel(order)}</strong>
                              <span>{customerLabel(order)}</span>
                            </small>
                          )}
                        </div>
                      </td>

                      <td data-label={`${t.available} (kg)`}>
                        <bdi className="receipt-voucher-available">
                          {order ? number(order.remaining_kg, language) : "—"} kg
                        </bdi>
                      </td>

                      <td data-label={t.unit}>
                        <div className="prod-field">
                          <select
                            id={`receipt-unit-${index}`}
                            data-receipt-unit={index}
                            value={row.unit}
                            aria-label={t.unit}
                            disabled={!editable}
                            onChange={handleFieldChange("unit")}
                          >
                            {t.units.map((unit) => (
                              <option key={unit} value={unit}>
                                {receiptUnitLabel(unit, language)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      <td data-label={`${t.count} · ${t.method}`}>
                        <div className="receipt-voucher-packing-cell">
                          <div className="receipt-voucher-packing-controls">
                            <div className="receipt-voucher-control">
                              <label htmlFor={`receipt-unit-quantity-${index}`}>{t.count}</label>
                              <input
                                id={`receipt-unit-quantity-${index}`}
                                data-receipt-unit-quantity={index}
                                type="text"
                                inputMode={row.unit === "kg" ? "decimal" : "numeric"}
                                value={row.unit === "kg" ? row.quantity : row.count}
                                required={row.unit !== "kg"}
                                readOnly={row.unit === "kg"}
                                disabled={!editable}
                                onChange={handleFieldChange("count")}
                              />
                            </div>

                            {row.unit !== "kg" && (
                              <div className="receipt-voucher-control">
                                <label htmlFor={`receipt-method-${index}`}>{t.method}</label>
                                <select
                                  id={`receipt-method-${index}`}
                                  data-receipt-method={index}
                                  value={row.method}
                                  disabled={!editable}
                                  onChange={handleFieldChange("method")}
                                >
                                  <option value="unit_weight">{t.modeUnit}</option>
                                  <option value="piece_weight">{t.modePiece}</option>
                                </select>
                              </div>
                            )}

                            {row.unit !== "kg" && row.method === "piece_weight" && (
                              <div className="receipt-voucher-control">
                                <label htmlFor={`receipt-pieces-${index}`}>{t.pieces}</label>
                                <input
                                  id={`receipt-pieces-${index}`}
                                  data-receipt-pieces={index}
                                  type="text"
                                  inputMode="numeric"
                                  value={row.pieces}
                                  required
                                  disabled={!editable}
                                  onChange={handleFieldChange("pieces")}
                                />
                              </div>
                            )}

                            {row.unit !== "kg" && row.method === "unit_weight" && (
                              <div className="receipt-voucher-control">
                                <label htmlFor={`receipt-unit-weight-${index}`}>{t.unitWeight}</label>
                                <input
                                  id={`receipt-unit-weight-${index}`}
                                  data-receipt-unit-weight={index}
                                  type="text"
                                  inputMode="decimal"
                                  value={packing?.unit_weight_kg ?? ""}
                                  readOnly
                                  aria-readonly="true"
                                  disabled={!editable}
                                />
                              </div>
                            )}

                            {row.unit !== "kg" && row.method === "piece_weight" && (
                              <div className="receipt-voucher-control">
                                <label htmlFor={`receipt-piece-weight-${index}`}>{t.pieceWeight}</label>
                                <input
                                  id={`receipt-piece-weight-${index}`}
                                  data-receipt-piece-weight={index}
                                  type="text"
                                  inputMode="decimal"
                                  value={packing?.piece_weight_grams ?? ""}
                                  readOnly
                                  aria-readonly="true"
                                  disabled={!editable}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td data-label={t.quantity}>
                        <input
                          className="receipt-voucher-calculated receipt-voucher-requested"
                          id={`receipt-quantity-${index}`}
                          data-receipt-quantity={index}
                          type="text"
                          inputMode="decimal"
                          value={row.quantity}
                          required
                          disabled={!editable}
                          aria-label={t.quantity}
                          onChange={handleFieldChange("quantity")}
                        />
                        <small className="receipt-voucher-derived-total">
                          {result ? `${t.calculated}: ${number(result.quantity_kg, language)} kg` : ""}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            className="prod-btn secondary receipt-voucher-add"
            type="button"
            disabled={!editable || drafts.length >= 100 || !eligible.length}
            onClick={onAddLine}
          >
            <Plus />
            {t.addLine}
          </button>

          <div className="prod-field receipt-voucher-notes">
            <label htmlFor="receipt-notes">{t.notes}</label>
            <textarea
              id="receipt-notes"
              rows={2}
              value={notes}
              maxLength={2000}
              disabled={!editable}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </div>

          <div className="receipt-voucher-total" data-receipt-total={total}>
            <span>{t.total}</span>
            <strong>
              <bdi data-receipt-total-value>
                {total === "—" ? "—" : `${number(total, language)} kg`}
              </bdi>
            </strong>
          </div>

          {error && (
            <div className="prod-error receipt-voucher-error" role="alert">
              <span>{error}</span>
              {!saving && onRetry && (
                <button className="prod-btn quiet" type="button" onClick={onRetry}>
                  {t.retry}
                </button>
              )}
            </div>
          )}

          <footer className="receipt-voucher-footer">
            <button
              className="prod-btn quiet"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              {t.closeBtn}
            </button>
            <button
              className="prod-btn"
              data-receipt-submit
              type="submit"
              disabled={saving || locked || !eligible.length}
            >
              {saving ? t.saving : t.save}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  );
}