import { useEffect, useMemo, useState } from "react";
import type { TransferPreviewRow, TransferRow, TransferTable } from "../../../../shared/data-transfer";

type Representative = { id: number; display_name: string | null; display_name_ar: string | null };
type Props = {
  row: TransferPreviewRow; table: TransferTable; language: string; busy: boolean;
  onSave: (values: TransferRow) => Promise<void>; onCancel: () => void;
};

export default function ImportRowRepair({ row, table, language, busy, onSave, onCancel }: Props) {
  const ar = language === "ar";
  const [changes, setChanges] = useState<TransferRow>({});
  const [representatives, setRepresentatives] = useState<Representative[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState(false);
  const fields = useMemo(() => {
    const names = new Set([
      ...Object.keys(row.sourceValues ?? row.values),
      ...row.errors.flatMap(error => error.column.split(",")),
      "name", "name_ar", "display_name", "display_name_ar",
      ...(row.table === "customers" ? ["sales_rep_id"] : []),
    ]);
    return table.columns.filter(column => column.writable && !column.generated &&
      (names.has(column.name) || (!column.nullable && !column.default)));
  }, [row, table]);

  useEffect(() => {
    if (row.table !== "customers" || !fields.some(column => column.name === "sales_rep_id")) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/customers/sales-representatives", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error("Representative lookup failed");
        const body = await response.json();
        if (!Array.isArray(body)) throw Error("Invalid representative response");
        setRepresentatives(body);
      }).catch(() => { if (!controller.signal.aborted) setLookupError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [row.table, fields]);

  return <form className="transfer-repair-form" onSubmit={event => { event.preventDefault(); void onSave(changes); }}>
    <strong>{ar ? "تصحيح السجل وإعادة التحقق" : "Correct record and revalidate"}</strong>
    <p>{ar ? "التعديل يخص بيانات الاستيراد فقط، ولا يغيّر أي سجل موجود. لا تُملأ الحقول تلقائيًا." : "Edits affect import data only, not existing records. No values are filled automatically."}</p>
    <div className="transfer-repair-fields">
      {fields.map(column => {
        const value = Object.hasOwn(changes, column.name) ? changes[column.name] : (row.sourceValues ?? row.values)[column.name];
        const update = (next: string) => setChanges(current => ({ ...current, [column.name]: next === "" && column.nullable ? null : next }));
        const label = ar ? column.labelAr : column.labelEn;
        return <label key={column.name}>
          <span>{label} <code>{column.name}</code>{!column.nullable && !column.default ? " *" : ""}</span>
          {row.table === "customers" && column.name === "sales_rep_id"
            ? <select aria-label={label} disabled={busy || loading || lookupError} value={value ?? ""} onChange={event => update(event.target.value)}>
                <option value="">{loading ? (ar ? "جارٍ تحميل المندوبين…" : "Loading representatives…") : (ar ? "بدون مندوب" : "No representative")}</option>
                {value && !representatives.some(rep => String(rep.id) === value) && <option value={value}>{ar ? "القيمة الحالية غير متاحة:" : "Current value unavailable:"} {value}</option>}
                {representatives.map(rep => <option key={rep.id} value={String(rep.id)}>{ar ? rep.display_name_ar || rep.display_name || String(rep.id) : rep.display_name && !/[\u0600-\u06ff]/.test(rep.display_name) ? rep.display_name : `Representative ${rep.id}`}</option>)}
              </select>
            : <input aria-label={label} type="text" value={value ?? ""} disabled={busy} maxLength={column.maxLength ?? 10000} onChange={event => update(event.target.value)} />}
        </label>;
      })}
    </div>
    {lookupError && <p role="alert">{ar ? "تعذر تحميل المندوبين. أغلق التصحيح وافتحه للمحاولة مجددًا." : "Could not load representatives. Close and reopen the correction to retry."}</p>}
    <div className="transfer-inline">
      <button type="submit" className="btn btn-primary" disabled={busy || !Object.keys(changes).length}>{busy ? (ar ? "جارٍ التحقق…" : "Validating…") : (ar ? "حفظ التصحيح وإعادة التحقق" : "Save correction and revalidate")}</button>
      <button type="button" className="btn btn-muted" disabled={busy} onClick={onCancel}>{ar ? "إلغاء" : "Cancel"}</button>
    </div>
  </form>;
}
