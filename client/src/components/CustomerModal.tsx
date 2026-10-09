import { localizedName, translate, translateError } from "../i18n";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import "./CustomerModal.css";

type Row = Record<string, any>;
type SalesRepresentative = {
  id: number;
  display_name: string | null;
  display_name_ar: string | null;
};
type CustomerForm = {
  name: string;
  name_ar: string;
  tax_number: string;
  phone: string;
  sales_rep_id: string;
  city: string;
  is_active: boolean;
};

const toText = (value: unknown) => value == null ? "" : String(value);
const toBoolean = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";
const editableTextKeys = ["name", "name_ar", "tax_number", "phone", "city"] as const;

function initialForm(row: Row): CustomerForm {
  return {
    name: toText(row.name),
    name_ar: toText(row.name_ar),
    tax_number: toText(row.tax_number),
    phone: toText(row.phone),
    sales_rep_id: row.sales_rep_id == null ? "" : String(row.sales_rep_id),
    city: toText(row.city),
    is_active: row.id ? toBoolean(row.is_active) : true,
  };
}

function representativeLabel(rep: Pick<SalesRepresentative, "display_name" | "display_name_ar">) {
  return localizedName(rep.display_name_ar, rep.display_name, translate("مندوب مبيعات"));
}

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر حفظ بيانات العميل. تحقق من البيانات وحاول مجدداً."));
  return body?.data ?? body;
}

export default function CustomerModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: (saved: Row) => void }) {
  const editing = Boolean(row.id);
  const [form, setForm] = useState<CustomerForm>(() => initialForm(row));
  const [representatives, setRepresentatives] = useState<SalesRepresentative[]>([]);
  const [loadingReps, setLoadingReps] = useState(true);
  const [repsError, setRepsError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const saveLock = useRef(false);
  const live = useRef(true);
  const titleId = "customer-modal-title";

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("input, select, button")?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      returnFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadRepresentatives = async () => {
      setLoadingReps(true);
      setRepsError("");
      try {
        const response = await fetch("/api/customers/sales-representatives", {
          credentials: "include",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(translateError(body.message || "تعذر تحميل مندوبي المبيعات."));
        const list = body?.data ?? body;
        if (!Array.isArray(list)) throw new Error(translate("تعذر تحميل قائمة مندوبي المبيعات."));
        if (!controller.signal.aborted) setRepresentatives(list);
      } catch (error) {
        if (!controller.signal.aborted) setRepsError(translate((error as Error).message || "تعذر تحميل مندوبي المبيعات."));
      } finally {
        if (!controller.signal.aborted) setLoadingReps(false);
      }
    };
    void loadRepresentatives();
    return () => controller.abort();
  }, [retry]);

  const set = <K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError("");
  };

  const close = () => { if (!saveLock.current) onClose(); };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
    )].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
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
    if (saveLock.current || loadingReps || repsError) return;
    setSaveError("");
    const name = form.name.trim();
    const nameAr = form.name_ar.trim();
    if (!name) { setSaveError(translate("اسم العميل بالإنجليزية مطلوب.")); return; }
    const limits: Record<(typeof editableTextKeys)[number], number> = { name: 200, name_ar: 200, tax_number: 20, phone: 20, city: 50 };
    const invalidLength = editableTextKeys.some((key) =>
      (!editing || form[key] !== toText(row[key])) && form[key].trim().length > limits[key],
    );
    if (invalidLength) { setSaveError(translate("تجاوز أحد الحقول الحد الأقصى المسموح به.")); return; }

    const currentRep = form.sales_rep_id === "" ? null : Number(form.sales_rep_id);
    const originalRep = row.sales_rep_id == null ? null : Number(row.sales_rep_id);
    const unchangedAssignedRep = editing && currentRep === originalRep;
    if (currentRep !== null && (!Number.isInteger(currentRep) || (!unchangedAssignedRep && !representatives.some((rep) => rep.id === currentRep)))) {
      setSaveError(translate("اختر مندوب مبيعات من القائمة المتاحة."));
      return;
    }

    let payload: Record<string, unknown>;
    if (editing) {
      payload = {};
      for (const key of editableTextKeys) {
        const current = form[key];
        if (current !== toText(row[key])) payload[key] = current.trim();
      }
      if (currentRep !== originalRep) payload.sales_rep_id = currentRep;
      if (form.is_active !== toBoolean(row.is_active)) payload.is_active = form.is_active;
    } else {
      payload = {
        name,
        name_ar: nameAr,
        tax_number: form.tax_number.trim(),
        phone: form.phone.trim(),
        sales_rep_id: currentRep,
        city: form.city.trim(),
        is_active: form.is_active,
      };
    }

    if (editing && !Object.keys(payload).length) {
      onSaved(row);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/customers${editing ? `/${encodeURIComponent(String(row.id))}` : ""}`, {
        method: editing ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await responseJson(response);
      if (!saved || typeof saved.id !== "string" || !saved.id) {
        throw new Error("لم يُرجع الخادم بيانات العميل المحفوظ. أعد تحميل صفحة العملاء للتحقق قبل المحاولة مجدداً.");
      }
      onSaved(saved as Row);
    } catch (error) {
      setSaveError((error as Error).message || "تعذر حفظ بيانات العميل.");
    } finally {
      saveLock.current = false;
      if (live.current) setSaving(false);
    }
  };

  const selectedRep = form.sales_rep_id;
  const selectedRepMissing = Boolean(selectedRep) && !representatives.some((rep) => String(rep.id) === selectedRep);
  const existingRepLabel = localizedName(row.sales_rep_name_ar || row.sales_rep?.display_name_ar, row.sales_rep_name || row.sales_rep?.display_name, translate("المندوب الحالي"));

  return <div className="modal-backdrop customer-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <div className="modal customer-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="customer-modal-head">
        <div>
          <span className="customer-modal-kicker">{editing ? translate("ملف العميل") : translate("سجل جديد")}</span>
          <h3 id={titleId}>{editing ? translate("تعديل بيانات العميل") : translate("إضافة عميل")}</h3>
          <p>{editing ? translate("حدّث بيانات التواصل والتكليف عند الحاجة.") : translate("أدخل بيانات العميل للانتقال إلى تعريف منتجات الأكياس.")}</p>
        </div>
        <button className="btn btn-muted customer-modal-close" type="button" aria-label={translate("إغلاق النافذة")} onClick={close} disabled={saving}><X size={18} /></button>
      </header>

      {repsError && <div className="customer-modal-alert" role="alert">
        <span>{repsError}</span>
        <button type="button" className="customer-modal-retry" onClick={() => setRetry((value) => value + 1)}>{translate("إعادة المحاولة")}</button>
      </div>}
      {saveError && <div className="error customer-modal-save-error" role="alert" aria-live="assertive">{saveError}</div>}

      <form onSubmit={submit} noValidate>
        <div className="customer-modal-fields">
          <div className="customer-modal-grid customer-modal-names">
            <div className="field">
              <label htmlFor="customer-name-ar">{translate("اسم العميل بالعربية")}</label>
              <input id="customer-name-ar" value={form.name_ar} onChange={(event) => set("name_ar", event.target.value)} maxLength={200} autoComplete="organization" dir="rtl" />
            </div>
            <div className="field">
              <label htmlFor="customer-name">{translate("اسم العميل بالإنجليزية")}{" "}<span aria-hidden="true">*</span></label>
              <input id="customer-name" value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={200} required autoComplete="organization" dir="ltr" />
            </div>
          </div>

          <div className="customer-modal-grid customer-modal-contact">
            <div className="field">
              <label htmlFor="customer-tax-number">{translate("الرقم الضريبي")}</label>
              <input id="customer-tax-number" value={form.tax_number} onChange={(event) => set("tax_number", event.target.value)} maxLength={20} dir="ltr" />
            </div>
            <div className="field">
              <label htmlFor="customer-phone">{translate("الهاتف")}</label>
              <input id="customer-phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} maxLength={20} autoComplete="tel" dir="ltr" />
            </div>
            <div className="field">
              <label htmlFor="customer-sales-rep">{translate("مندوب المبيعات")}</label>
              <select id="customer-sales-rep" value={form.sales_rep_id} onChange={(event) => set("sales_rep_id", event.target.value)} disabled={loadingReps || Boolean(repsError)}>
                <option value="">{loadingReps ? translate("جارٍ تحميل المندوبين…") : representatives.length ? translate("بدون مندوب") : translate("لا يوجد مندوبون متاحون")}</option>
                {selectedRepMissing && <option value={selectedRep} disabled>{existingRepLabel}{" "}{translate("· التكليف الحالي")}</option>}
                {representatives.map((rep) => <option key={rep.id} value={String(rep.id)}>{representativeLabel(rep)}</option>)}
              </select>
              {loadingReps && <span className="customer-modal-hint" role="status">{translate("جارٍ تحميل قائمة المندوبين…")}</span>}
              {!loadingReps && !repsError && representatives.length === 0 && <span className="customer-modal-hint">{translate("لا يتوفر مندوب مؤهل للتكليف حالياً.")}</span>}
            </div>
          </div>

          <div className="customer-modal-grid customer-modal-extra">
            <div className="field">
              <label htmlFor="customer-city">{translate("المدينة")}</label>
              <input id="customer-city" value={form.city} onChange={(event) => set("city", event.target.value)} maxLength={50} autoComplete="address-level2" />
            </div>
            <label className="customer-modal-active" htmlFor="customer-active">
              <input id="customer-active" type="checkbox" checked={form.is_active} onChange={(event) => set("is_active", event.target.checked)} />
              <span><strong>{translate("عميل نشط")}</strong><small>{translate("يمكن استخدامه في الطلبات الجديدة")}</small></span>
            </label>
          </div>
        </div>

        <footer className="customer-modal-footer">
          <button type="button" className="btn btn-muted" onClick={close} disabled={saving}>{translate("إلغاء")}</button>
          <button type="submit" className="btn btn-primary customer-modal-submit" disabled={saving || loadingReps || Boolean(repsError)}>
            {saving && <LoaderCircle size={16} className="customer-modal-spinner" aria-hidden="true" />}
            {saving ? translate("جارٍ الحفظ…") : editing ? translate("حفظ التعديلات") : translate("حفظ ومتابعة")}
          </button>
        </footer>
      </form>
    </div>
  </div>;
}