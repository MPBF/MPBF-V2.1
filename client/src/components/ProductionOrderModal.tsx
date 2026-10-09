import { translate, translateError } from "../i18n";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { productionOrderDetails, productionQuantityLocked, productionQuantityPayload } from "../lib/production-order-form";
import "./ProductionOrderModal.css";

type Row = Record<string, any>;

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error(translateError(body.message || "تعذر تعديل الكمية؛ تغيّرت حالة أمر الإنتاج وأصبح محمياً. أغلق النافذة وحدّث قائمة الإنتاج."));
    }
    throw new Error(translateError(body.message || "تعذر حفظ كمية الإنتاج. تحقق من البيانات وحاول مجدداً."));
  }
  return body;
}

export default function ProductionOrderModal({
  row,
  mode,
  onClose,
  onSaved,
}: {
  row: Row;
  mode: "view" | "edit";
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [quantity, setQuantity] = useState(() => row.quantity_kg == null ? "" : String(row.quantity_kg));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const saveLock = useRef(false);
  const live = useRef(true);
  const locked = productionQuantityLocked(row);
  const titleId = "production-order-modal-title";
  const orderNumber = row.production_order_number == null || row.production_order_number === "" ? "—" : String(row.production_order_number);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      returnFocus.current?.focus();
    };
  }, []);

  const close = () => {
    if (!saveLock.current) onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    )].filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      modalRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveLock.current || locked) return;
    setError("");

    let payload: { quantity_kg: string };
    try {
      payload = productionQuantityPayload(quantity);
    } catch (validationError) {
      setError((validationError as Error).message);
      return;
    }

    let originalQuantity: string;
    try {
      originalQuantity = productionQuantityPayload(String(row.quantity_kg ?? "")).quantity_kg;
    } catch {
      originalQuantity = String(row.quantity_kg ?? "").trim();
    }
    if (payload.quantity_kg === originalQuantity) {
      onSaved?.();
      onClose();
      return;
    }

    saveLock.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/production-orders/${encodeURIComponent(String(row.id))}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      await responseMessage(response);
      onSaved?.();
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message || "تعذر حفظ كمية الإنتاج.");
    } finally {
      saveLock.current = false;
      if (live.current) setSaving(false);
    }
  };

  const details = productionOrderDetails(row);

  return <div
    className="modal-backdrop production-order-modal-backdrop"
    onMouseDown={(event) => event.target === event.currentTarget && close()}
  >
    <div
      className="modal production-order-modal"
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="production-order-modal-head">
        <div className="production-order-modal-heading">
          <span className="production-order-modal-kicker">{mode === "view" ? translate("سجل الإنتاج") : translate("تحديث أمر الإنتاج")}</span>
          <h3 id={titleId}>{mode === "view" ? translate("تفاصيل أمر الإنتاج") : translate("تعديل الكمية المطلوبة")}</h3>
          {mode === "edit" && <p className="production-order-context">
            <span>{translate("رقم أمر الإنتاج")}</span>
            <strong dir="ltr">{orderNumber}</strong>
          </p>}
        </div>
        <button className="btn btn-muted production-order-modal-close" type="button" aria-label={translate("إغلاق النافذة")} onClick={close} disabled={saving}>
          <X size={18} />
        </button>
      </header>

      {mode === "view" ? <>
        <dl className="production-order-details">
          {details.map((detail, index) => <div className="production-order-detail" key={`${detail.label}-${index}`}>
            <dt>{translate(detail.label)}</dt>
            <dd dir="auto">{detail.value}</dd>
          </div>)}
        </dl>
        <footer className="production-order-modal-footer">
          <button type="button" className="btn btn-muted" onClick={close}>{translate("إغلاق")}</button>
        </footer>
      </> : <>
        {locked && <div className="production-order-protection" role="status">
          <strong>{translate("الكمية محمية")}</strong>
          <span>{translate("لا يمكن تعديل الكمية بعد بدء الإنتاج أو إكماله أو ربط الأمر بتشغيلة.")}</span>
        </div>}
        {error && <div className="error production-order-error" role="alert" aria-live="assertive">{error}</div>}
        <form onSubmit={submit} noValidate>
          <div className="production-order-form-body">
            <div className="field production-order-quantity-field">
              <label htmlFor="production-order-quantity">{translate("الكمية المطلوبة (كجم)")}</label>
              <div className="production-order-input-wrap">
                <input
                  id="production-order-quantity"
                  name="quantity_kg"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setError("");
                  }}
                  disabled={locked || saving}
                  aria-describedby={locked ? "production-order-lock-note" : "production-order-quantity-hint"}
                />
                <span aria-hidden="true">{translate("كجم")}</span>
              </div>
              <small id={locked ? "production-order-lock-note" : "production-order-quantity-hint"}>
                {locked ? translate("الكمية غير قابلة للتغيير لهذا الأمر.") : translate("أدخل رقماً موجباً حتى ٨ أرقام ومنزلتين عشريتين.")}
              </small>
            </div>
          </div>
          <footer className="production-order-modal-footer">
            <button type="button" className="btn btn-muted" onClick={close} disabled={saving}>{translate("إلغاء")}</button>
            <button type="submit" className="btn btn-primary production-order-submit" disabled={saving || locked}>
              {saving && <LoaderCircle size={16} className="production-order-spinner" aria-hidden="true" />}
              {saving ? translate("جارٍ الحفظ…") : translate("حفظ الكمية")}
            </button>
          </footer>
        </form>
      </>}
    </div>
  </div>;
}