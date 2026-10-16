import { X } from "lucide-react";
import type { MutableRefObject } from "react";

import type { ProductionOrderRecord, ProductionReceipt, ReceiptItem } from "../../../../shared/production";
import { normalizeReceiptQuantity, type ReceiptDraft } from "../../../../shared/receipt-draft";
import type { ReceiptVoucherCopy } from "./receipt-voucher-copy";

type Props = {
  language: string;
  copy: ReceiptVoucherCopy;
  eligible: ProductionOrderRecord[];
  drafts: ReceiptDraft[];
  savedReceipt: ProductionReceipt | null;
  dateTime: string;
  draftDateTime: string;
  notes: string;
  total: string | null;
  previewRef: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  orderLabel: (order: ProductionOrderRecord) => string;
  number: (value: string | number | null | undefined, language: string, digits?: number) => string;
};

function parseCents(value: string | number): bigint {
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function savedReceiptTotal(items: ReceiptItem[]): string {
  const total = items.reduce((sum, item) => sum + parseCents(item.quantity_kg), 0n);
  return `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
}

function SavedReceiptRows({
  items,
  language,
  copy: t,
  number,
}: {
  items: ReceiptItem[];
  language: string;
  copy: ReceiptVoucherCopy;
  number: Props["number"];
}) {
  return (
    <div className="receipt-voucher-preview-rows">
      {items.map((item, index) => (
        <article className="receipt-voucher-preview-row" key={`saved-preview-${item.id}`}>
          <div className="receipt-voucher-preview-values">
            <span><small>{t.line}</small>{String(item.line_number ?? index + 1).padStart(2, "0")}</span>
            <span><small>{t.order}</small><bdi>{item.production_order_number || `#${item.production_order_id}`}</bdi></span>
            <span><small>{t.quantity}</small>{number(item.quantity_kg, language, 2)} kg</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ReceiptVoucherPreview({
  language,
  copy: t,
  eligible,
  drafts,
  savedReceipt,
  dateTime,
  draftDateTime,
  notes,
  total,
  previewRef,
  onClose,
  orderLabel,
  number,
}: Props) {
  const savedSnapshot = Boolean(
    savedReceipt && drafts.every((row) => !row.orderId.trim() && !row.quantity.trim())
  );
  const metadataNumber = savedSnapshot ? savedReceipt!.voucher_number : t.assignedOnSave;
  const metadataDate = savedSnapshot ? dateTime : draftDateTime;
  const shownNotes = savedSnapshot ? savedReceipt!.notes ?? "" : notes;
  const shownTotal = savedSnapshot ? savedReceiptTotal(savedReceipt!.items) : total;
  const draftRows = drafts.map((row) => {
    const order = eligible.find((item) => String(item.id) === row.orderId) ?? null;
    let quantity = "";
    let cents = 0n;
    try {
      quantity = normalizeReceiptQuantity(row.quantity);
      cents = parseCents(quantity);
    } catch { /* Keep incomplete rows visible in the local preview. */ }
    return { order, quantity, cents };
  });
  const totalsByOrder = new Map<string, bigint>();
  draftRows.forEach(({ order, quantity, cents }) => {
    if (order && quantity) {
      const key = String(order.id);
      totalsByOrder.set(key, (totalsByOrder.get(key) ?? 0n) + cents);
    }
  });

  return (
    <div className="receipt-voucher-preview-backdrop">
      <section
        ref={previewRef}
        className="receipt-voucher-preview"
        role="dialog"
        data-receipt-preview
        aria-modal="true"
        aria-labelledby="receipt-voucher-preview-title"
        tabIndex={-1}
        dir={language === "ar" ? "rtl" : "ltr"}
      >
        <header>
          <div>
            <span className="receipt-voucher-kicker">{savedSnapshot ? t.previewSavedKicker : t.previewKicker}</span>
            <h3 id="receipt-voucher-preview-title">{savedSnapshot ? t.previewSavedTitle : t.previewTitle}</h3>
          </div>
          <button
            type="button"
            className="receipt-voucher-close"
            aria-label={t.close}
            data-receipt-preview-back
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="receipt-voucher-preview-meta">
          <div><small>{t.voucher}</small><bdi>{metadataNumber}</bdi></div>
          <div><small>{t.date}</small><bdi>{metadataDate}</bdi></div>
          <div><small>{t.source}</small><bdi>{t.sourceName}</bdi></div>
          <div><small>{t.destination}</small><bdi>{t.destName}</bdi></div>
        </div>
        {savedSnapshot ? (
          <SavedReceiptRows items={savedReceipt!.items} language={language} copy={t} number={number} />
        ) : (
          <div className="receipt-voucher-preview-rows">
            {draftRows.map(({ order, quantity }, index) => {
              const valid = Boolean(
                order &&
                quantity &&
                (totalsByOrder.get(String(order.id)) ?? 0n) <= parseCents(order.remaining_kg)
              );
              return (
                <article className={`receipt-voucher-preview-row${valid ? "" : " is-invalid"}`} key={`preview-${index}`}>
                  <div className="receipt-voucher-preview-values">
                    <span><small>{t.line}</small>{String(index + 1).padStart(2, "0")}</span>
                    <span><small>{t.order}</small>{order ? `${order.production_order_number} · ${orderLabel(order)}` : t.choose}</span>
                    <span><small>{t.available}</small>{order ? `${number(order.remaining_kg, language, 2)} kg` : "—"}</span>
                    <span><small>{t.quantity}</small>{quantity ? `${quantity} kg` : "—"}</span>
                  </div>
                  {!valid && <span className="receipt-voucher-preview-invalid">{t.invalid}</span>}
                </article>
              );
            })}
          </div>
        )}
        <div className="receipt-voucher-preview-total">
          <span>{t.total}</span><strong>{shownTotal === null ? "—" : `${shownTotal} kg`}</strong>
        </div>
        <div className="receipt-voucher-preview-notes">
          <small>{t.notes}</small><p>{shownNotes || "—"}</p>
        </div>
        <footer>
          <span>{savedSnapshot ? t.previewSaved : t.previewLocal}</span>
          <button className="prod-btn" type="button" data-receipt-preview-back onClick={onClose}>{t.closeBtn}</button>
        </footer>
      </section>
    </div>
  );
}
