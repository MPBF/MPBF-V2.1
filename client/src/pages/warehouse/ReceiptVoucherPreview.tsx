import { X } from "lucide-react";
import type { MutableRefObject } from "react";

import type { ProductionOrderRecord, ProductionReceipt, ReceiptItem } from "../../../../shared/production";
import { deriveReceiptPacking, type ReceiptDraft } from "../../../../shared/receipt-draft";
import { packingUnitWeightKg, receiptUnitLabel, type PackingSpecification, type ReceiptPacking } from "../../../../shared/production-packing";
import type { ReceiptVoucherCopy } from "./receipt-voucher-copy";

type DerivedReceiptRow = ReturnType<typeof deriveReceiptPacking> | null;

type Props = {
  language: string;
  copy: ReceiptVoucherCopy;
  eligible: ProductionOrderRecord[];
  drafts: ReceiptDraft[];
  derived: DerivedReceiptRow[];
  factors: (string | null)[];
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

const stringValue = (value: unknown) => String(value ?? "");

function parseCents(value: string | number): bigint {
  const [whole = "0", fraction = ""] = String(value).split(".");
  return BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function savedPackingSpecification(packing: ReceiptPacking): PackingSpecification {
  if (packing.method === "unit_weight") {
    return {
      unit: packing.unit,
      method: packing.method,
      unit_weight_kg: stringValue(packing.unit_weight_kg ?? (packing.unit === "kg" ? "1" : "")),
    };
  }
  return {
    unit: packing.unit,
    method: packing.method,
    pieces_per_unit: Number(packing.pieces_per_unit),
    piece_weight_grams: stringValue(packing.piece_weight_grams),
  };
}

function savedPackingFactor(packing: ReceiptPacking | null): string {
  if (!packing) return "1.000000";
  try {
    return packingUnitWeightKg(savedPackingSpecification(packing));
  } catch {
    return "—";
  }
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
      {items.map((item, index) => {
        const quantity = stringValue(item.quantity_kg);
        const packing = item.packing ? {
          ...item.packing,
          quantity: stringValue(item.packing.quantity),
          unit_weight_kg: item.packing.unit_weight_kg === undefined ? undefined : stringValue(item.packing.unit_weight_kg),
          piece_weight_grams: item.packing.piece_weight_grams === undefined ? undefined : stringValue(item.packing.piece_weight_grams),
          pieces_per_unit: item.packing.pieces_per_unit === undefined ? undefined : Number(item.packing.pieces_per_unit),
        } : null;
        const unit = packing?.unit ?? "kg";
        const factor = savedPackingFactor(packing);
        const orderIdentifier = item.production_order_number || `#${item.production_order_id}`;
        return (
          <article className="receipt-voucher-preview-row" key={`saved-preview-${item.id}`}>
            <div className="receipt-voucher-preview-row-head">
              <strong>{String(item.line_number ?? index + 1).padStart(2, "0")} · {orderIdentifier}</strong>
            </div>
            <div className="receipt-voucher-preview-values">
              <span><small>{t.unit}</small>{receiptUnitLabel(unit, language)}</span>
              <span><small>{t.factor}</small>{factor} kg</span>
              <span><small>{t.count}</small>{packing ? packing.quantity : quantity}</span>
              <span><small>{t.quantity}</small>{number(quantity, language)} kg</span>
              <span className="receipt-voucher-preview-spec">
                <small>{t.method}</small>
                {packing?.method === "piece_weight"
                  ? `${String(packing.pieces_per_unit)} ${t.pieces} · ${stringValue(packing.piece_weight_grams)} g`
                  : packing?.method === "unit_weight" ? t.modeUnit : "—"}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ReceiptVoucherPreview({
  language,
  copy: t,
  eligible,
  drafts,
  derived,
  factors,
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
            {drafts.map((row, index) => {
              const order = eligible.find((item) => String(item.id) === row.orderId);
              const valid = derived[index] !== null && Boolean(row.orderId && order);
              const packing = derived[index]?.packing;
              return (
                <article className={`receipt-voucher-preview-row${valid ? "" : " is-invalid"}`} key={`preview-${index}`}>
                  <div className="receipt-voucher-preview-row-head">
                    <strong>{String(index + 1).padStart(2, "0")} · {order ? orderLabel(order) : t.choose}</strong>
                    {!valid && <span role="status">{t.invalid}</span>}
                  </div>
                  {valid ? (
                    <div className="receipt-voucher-preview-values">
                      <span><small>{t.order}</small>{order ? order.production_order_number : "—"}</span>
                      <span><small>{t.available}</small>{order ? `${number(order.remaining_kg, language)} kg` : "—"}</span>
                      <span><small>{t.unit}</small>{receiptUnitLabel(row.unit, language)}</span>
                      <span><small>{t.factor}</small>{factors[index] ?? "—"} kg</span>
                      <span><small>{t.count}</small>{row.unit === "kg" ? row.quantity : row.count}</span>
                      <span><small>{t.quantity}</small>{row.quantity} kg</span>
                      <span className="receipt-voucher-preview-spec">
                        <small>{t.method}</small>
                        {packing?.method === "piece_weight"
                          ? `${packing.pieces_per_unit} ${t.pieces} · ${packing.piece_weight_grams} g`
                          : row.unit === "kg" ? "—" : t.modeUnit}
                      </span>
                    </div>
                  ) : (
                    <div className="receipt-voucher-preview-invalid-values">
                      <span>{t.order}: {order ? order.production_order_number : t.choose}</span>
                      <span>{t.available}: {order ? `${number(order.remaining_kg, language)} kg` : "—"}</span>
                      <span>{t.unit}: {receiptUnitLabel(row.unit, language)}</span>
                      <span>{t.factor}: {factors[index] ?? "—"} kg</span>
                      <span>{t.count}: {row.unit === "kg" ? row.quantity : row.count || "—"}</span>
                      <span>{t.quantity}: {row.quantity || "—"} kg</span>
                      {row.unit !== "kg" && <span>{t.method}: {row.method === "piece_weight" ? t.modePiece : t.modeUnit}</span>}
                      {row.method === "piece_weight" && (
                        <span>{t.pieces}: {row.pieces || "—"} · {t.pieceWeight}: {packing?.piece_weight_grams ?? (row.pieceWeight || "—")}</span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <div className="receipt-voucher-preview-total">
          <span>{t.total}</span><strong>{shownTotal === null ? "—" : `${number(shownTotal, language)} kg`}</strong>
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
