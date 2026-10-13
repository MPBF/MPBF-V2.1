import { Printer, Plus, Trash2, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";

import type { ProductionOrderRecord, ProductionReceipt } from "../../../../shared/production";
import { deriveReceiptPacking, type ReceiptDraft } from "../../../../shared/receipt-draft";
import { packingUnitWeightKg, receiptUnitLabel } from "../../../../shared/production-packing";
import { ReceiptVoucherPreview } from "./ReceiptVoucherPreview";
import { receiptVoucherCopy } from "./receipt-voucher-copy";
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

// تحويل أي قيمة رقمية/نصية إلى سنتات مع التقريب الصحيح لمنزلتين
const parseCents = (weight: string | number | null | undefined): bigint => {
  if (weight === null || weight === undefined) return 0n;
  const num = typeof weight === "number" ? weight : parseFloat(String(weight).trim());
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0n;
  return BigInt(Math.round(num * 100));
};

// تنسيق السنتات إلى صيغة X.XX دائماً بخانتين
const formatCents = (cents: bigint): string => {
  const isNegative = cents < 0n;
  const abs = isNegative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = String(abs % 100n).padStart(2, "0");
  return `${isNegative ? "-" : ""}${whole}.${fraction}`;
};

export function ReceiptVoucherModal(props: Props) {
  const {
    language, eligible, drafts, notes, saving, locked = false, error, savedReceipt, openerRef,
    onDraftChange, onAddLine, onRemoveLine, onNotesChange, onSubmit, onRetry, onClose,
    onPrint, orderLabel, customerLabel, number,
  } = props;

  const t = receiptVoucherCopy(language);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewOpenRef = useRef(false);
  const wasPreviewOpen = useRef(false);
  const openedAt = useRef(new Date());
  
  const [previewOpen, setPreviewOpen] = useState(false);
  previewOpenRef.current = previewOpen;
  const editable = !saving && !locked;

  // قفل الـ Scroll فقط عند الفتح والإنهاء
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // إدارة Focus والـ Keyboard Trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previous = openerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const getFocusable = (root: ParentNode) =>
      [...root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null);

    (getFocusable(dialog)[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (previewOpenRef.current) {
          setPreviewOpen(false);
        } else {
          onClose();
        }
        return;
      }

      if (event.key === "Tab") {
        const activeDialog = (previewOpenRef.current ? previewRef.current : dialog) ?? dialog;
        const items = getFocusable(activeDialog);
        if (!items.length) {
          event.preventDefault();
          activeDialog.focus();
          return;
        }

        const isFirst = document.activeElement === items[0];
        const isLast = document.activeElement === items[items.length - 1];

        if (event.shiftKey && isFirst) {
          event.preventDefault();
          items[items.length - 1]?.focus();
        } else if (!event.shiftKey && isLast) {
          event.preventDefault();
          items[0]?.focus();
        } else if (!activeDialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose, openerRef]);

  useEffect(() => {
    if (previewOpen) {
      previewRef.current?.focus();
    } else if (wasPreviewOpen.current) {
      previewTriggerRef.current?.focus();
    }
    wasPreviewOpen.current = previewOpen;
  }, [previewOpen]);

  // الحسابات المشتقة لكل سطر
  const derived = useMemo(() => {
    return drafts.map((row) => {
      try {
        return deriveReceiptPacking(row);
      } catch {
        return null;
      }
    });
  }, [drafts]);

  // معاملات الوزن المحددة لكل سطر بخانتين عشريتين
  const factors = useMemo(() => {
    return derived.map((item) => {
      if (!item) return null;
      try {
        const wt = packingUnitWeightKg(item.result.specification);
        return formatCents(parseCents(wt));
      } catch {
        return null;
      }
    });
  }, [derived]);

  // حساب المجموع الكلي بخانتين عشريتين
  const total = useMemo(() => {
    const isSingleEmptyDraft = drafts.length === 1 && !drafts[0].orderId && !drafts[0].count;
    const allValid = derived.every((item) => item !== null);

    let centsTotal: bigint | null = null;
    if (isSingleEmptyDraft && savedReceipt) {
      centsTotal = savedReceipt.items.reduce((sum, item) => sum + parseCents(item.quantity_kg), 0n);
    } else if (allValid) {
      centsTotal = derived.reduce((sum, item) => sum + parseCents(item!.result.quantity_kg), 0n);
    }

    return centsTotal === null ? "—" : formatCents(centsTotal);
  }, [drafts, derived, savedReceipt]);

  const previewTotal = useMemo(() => {
    if (!derived.length || derived.some((item) => item === null)) return null;
    const cents = derived.reduce((sum, item) => sum + parseCents(item!.result.quantity_kg), 0n);
    return formatCents(cents);
  }, [derived]);

  // تنسيق التواريخ
  const draftDateTime = useMemo(() => {
    return new Intl.DateTimeFormat(
      language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { dateStyle: "medium", timeZone: "Asia/Riyadh" }
    ).format(openedAt.current);
  }, [language]);

  const dateTime = useMemo(() => {
    const shownDate = savedReceipt?.created_at ? new Date(savedReceipt.created_at) : openedAt.current;
    return new Intl.DateTimeFormat(
      language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { dateStyle: "medium", timeZone: "Asia/Riyadh" }
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
          <div className="receipt-voucher-metadata-grid">
            <div className="receipt-voucher-meta-item" data-receipt-meta="number">
              {savedReceipt && <strong>{t.saved}</strong>}
              <small>{t.voucher}</small>
              {savedReceipt ? (
                <bdi data-receipt-voucher-number>{savedReceipt.voucher_number}</bdi>
              ) : (
                <span className="receipt-voucher-pending-number">{t.assignedOnSave}</span>
              )}
            </div>
            <div className="receipt-voucher-meta-item" data-receipt-meta="date">
              <small>{t.date}</small>
              <bdi data-receipt-created-at={savedReceipt?.created_at}>{dateTime}</bdi>
            </div>
            <div className="receipt-voucher-meta-item" data-receipt-meta="source">
              <small>{t.source}</small>
              <bdi>{t.sourceName}</bdi>
            </div>
            <div className="receipt-voucher-meta-item" data-receipt-meta="destination">
              <small>{t.destination}</small>
              <bdi>{t.destName}</bdi>
            </div>
          </div>
        </section>

        <form onSubmit={onSubmit}>
          <div className="receipt-voucher-table-wrap">
            <table className="receipt-voucher-table" aria-label={t.title}>
              <thead>
                <tr>
                  <th scope="col">{t.line}</th>
                  <th scope="col">{t.order}</th>
                  <th scope="col">{t.availableColumn}</th>
                  <th scope="col">{t.unit}</th>
                  <th scope="col">{t.factor}</th>
                  <th scope="col">{t.count}</th>
                  <th scope="col">{t.quantity}</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((row, index) => {
                  const order = eligible.find((item) => String(item.id) === row.orderId);
                  const packing = derived[index]?.packing;
                  const rowKey = (row as { id?: string | number }).id ?? index;

                  const handleFieldChange =
                    (field: keyof ReceiptDraft) =>
                    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
                      onDraftChange(index, field, e.target.value);

                  return (
                    <tr className="receipt-voucher-line" key={rowKey}>
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
                        </div>
                      </td>

                      <td data-label={t.availableColumn}>
                        <bdi className="receipt-voucher-available">
                          {order ? number(order.remaining_kg, language, 2) : "—"} kg
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

                      <td data-label={t.factor}>
                        <div className="receipt-voucher-factor">
                          {row.unit !== "kg" && row.method === "unit_weight" ? (
                            <input
                              id={`receipt-unit-weight-${index}`}
                              data-receipt-unit-weight={index}
                              data-receipt-factor={index}
                              type="text"
                              inputMode="decimal"
                              value={factors[index] ?? ""}
                              readOnly
                              aria-readonly="true"
                              disabled={!editable}
                              aria-label={t.factor}
                              title={t.unitWeight}
                            />
                          ) : (
                            <output data-receipt-factor={index} title={t.unitWeight}>
                              {factors[index] ?? "—"}
                            </output>
                          )}
                          <small>kg / {receiptUnitLabel(row.unit, language)}</small>
                        </div>
                      </td>

                      <td data-label={t.count}>
                        <div className="receipt-voucher-packing-cell">
                          <div className="receipt-voucher-packing-controls">
                            <div className="receipt-voucher-control">
                              <label className="sr-only" htmlFor={`receipt-unit-quantity-${index}`}>
                                {t.count}
                              </label>
                              <input
                                id={`receipt-unit-quantity-${index}`}
                                data-receipt-unit-quantity={index}
                                type="text"
                                inputMode="numeric"
                                value={row.unit === "kg" ? "" : row.count}
                                placeholder={row.unit === "kg" ? "—" : ""}
                                required={row.unit !== "kg"}
                                disabled={!editable || row.unit === "kg"}
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

                            {row.unit !== "kg" && row.method === "piece_weight" && (
                              <div className="receipt-voucher-control">
                                <label htmlFor={`receipt-piece-weight-${index}`}>{t.pieceWeight}</label>
                                <input
                                  id={`receipt-piece-weight-${index}`}
                                  data-receipt-piece-weight={index}
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    packing?.piece_weight_grams !== undefined
                                      ? formatCents(parseCents(packing.piece_weight_grams))
                                      : ""
                                  }
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
                {total === "—" ? "—" : `${number(total, language, 2)} kg`}
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
              className="prod-btn secondary"
              type="button"
              ref={previewTriggerRef}
              data-receipt-preview-trigger
              onClick={() => setPreviewOpen(true)}
            >
              {t.preview}
            </button>
            <button
              className="prod-btn"
              data-receipt-submit
              type="submit"
              disabled={saving || locked || !eligible.length}
              aria-busy={saving}
            >
              {t.save}
            </button>
            <button
              className="prod-btn quiet"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              {t.closeBtn}
            </button>
          </footer>
        </form>

        {previewOpen && (
          <ReceiptVoucherPreview
            language={language}
            copy={t}
            eligible={eligible}
            drafts={drafts}
            derived={derived}
            factors={factors}
            savedReceipt={savedReceipt}
            dateTime={dateTime}
            draftDateTime={draftDateTime}
            notes={notes}
            total={previewTotal}
            previewRef={previewRef}
            onClose={() => setPreviewOpen(false)}
            orderLabel={orderLabel}
            number={number}
          />
        )}
      </section>
    </div>,
    document.body
  );
}