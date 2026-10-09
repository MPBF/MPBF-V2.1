import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { AlertTriangle, Plus, RefreshCw, RotateCw } from "lucide-react";
import type { MixingState, RawMaterialInput } from "../../../../shared/raw-mixing";
import { canViewRawInventory } from "../../../../shared/raw-mixing";
import { hasProductionPermission, type ProductionUser } from "../../../../shared/production";
import { availableProductionViews } from "../../lib/production-navigation";
import { availableWarehouseViews } from "../../lib/warehouse-navigation";
import { rawMixingApi } from "../../lib/raw-mixing-api";
import { confirmedProductionRejection } from "../../lib/production-api";
import { formatNumber, formatWholeNumber } from "../../lib/format-number";
import "../production/production.css";
import "../production/raw-operations.css";

export type RawInventoryPageProps = { user: ProductionUser };
type MaterialDraft = { code: string; name: string; nameAr: string; openingKg: string };
type PendingMaterial = { payload: RawMaterialInput; fingerprint: string; draft?: MaterialDraft };
const initialDraft: MaterialDraft = { code: "", name: "", nameAr: "", openingKg: "0" };
const messages: Record<string, [string, string]> = {
  title: ["مخزون المواد الخام", "Raw material inventory"], intro: ["أرصدة دليل المواد الخام، بما فيها الأرصدة السالبة.", "Balances for the raw-material catalog, including negative stock."],
  inventory: ["أرصدة المواد الخام", "Raw material balances"], catalog: ["إضافة مادة للدليل", "Add catalog material"],
  code: ["رمز المادة", "Material code"], name: ["الاسم", "Name"], nameAr: ["الاسم بالعربية", "Arabic name"],
  opening: ["الرصيد الافتتاحي (كجم)", "Opening balance (kg)"], add: ["إضافة المادة", "Add material"],
  refresh: ["تحديث", "Refresh"], retry: ["إعادة المحاولة", "Retry"], loading: ["جارٍ التحميل", "Loading"],
  permission: ["لا تتوفر صلاحية لعرض مخزون المواد الخام.", "You do not have permission to view raw inventory."],
  loadFail: ["تعذر تحميل أرصدة المواد الخام.", "Raw-material balances could not be loaded."],
  saveError: ["تعذر إضافة المادة. أعد المحاولة بالطلب نفسه.", "The material could not be added. Retry this exact request."],
  secure: ["تعذر إنشاء معرّف آمن. لا ترسل الطلب يدوياً.", "Could not create a secure request ID. Do not submit manually."],
  fields: ["أكمل الرمز والاسمين ضمن الأطوال المسموحة.", "Enter a code and both names within the allowed lengths."], invalidOpening: ["أدخل رصيداً افتتاحياً غير سالب بمنزلتين عشريتين كحد أقصى.", "Enter a non-negative opening balance with no more than two decimal places."],
  duplicate: ["رمز المادة موجود بالفعل.", "That material code already exists."], created: ["تمت إضافة المادة.", "Material added."],
  readOnly: ["عرض فقط — إضافة المواد متاحة للمسؤول أو لمن لديه صلاحية إدارة المواد الخام.", "Read only — adding materials requires administrator or raw-material management access."],
  failedRetry: ["لم يتأكد الحفظ. الحقول مجمدة؛ أعد إرسال الطلب نفسه.", "Save was not confirmed. Fields are locked; retry the same request."],
  recovered: ["يوجد طلب غير محسوم من جلسة سابقة. أعد إرسال الطلب نفسه للتأكد من نتيجته.", "An unresolved request from this session was found. Retry the exact request to confirm its result."],
  storageUnavailable: ["تعذر حفظ طلب الاسترداد في الجلسة؛ لم يتم الإرسال.", "Could not preserve this request in the session; it was not sent."],
  retryPermission: ["لم تعد تملك صلاحية إدارة المواد الخام، لذلك لم يُعاد إرسال الطلب.", "You no longer have raw-material management access, so the request was not retried."],
  material: ["المادة", "Material"], balance: ["الرصيد (كجم)", "Balance (kg)"], state: ["الحالة", "Status"],
  active: ["نشطة", "Active"], inactive: ["غير نشطة", "Inactive"], negative: ["رصيد سالب", "Negative balance"],
  negativeDetail: ["راجع الرصيد السالب مع مسؤول المخزون.", "Review the negative balance with the inventory lead."],
  rawTab: ["صالة الخام", "Raw materials"],
  noMaterials: ["لا توجد مواد في الدليل بعد.", "No materials are in the catalog yet."], count: ["مادة", "materials"],
  englishName: ["الاسم بالإنجليزية", "English name"], createdId: ["معرّف", "ID"],
};
const tx = (key: string, en: boolean) => messages[key]?.[en ? 1 : 0] ?? key;
const latin = (raw: string) => raw.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/٫/g, ".").replace(/٬/g, ",").trim();
const secureId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("secure");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const draftKey = (draft: MaterialDraft) => JSON.stringify(draft);
const requestError = (cause: unknown, en: boolean) => cause instanceof Error && cause.message && cause.message !== "secure" ? cause.message : tx(cause instanceof Error && cause.message === "secure" ? "secure" : "saveError", en);
const materialStorageKey = (userId: number) => `mpbf:raw-material:pending:${userId}`;
const readPendingMaterial = (key: string): PendingMaterial | null => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (!value || typeof value.fingerprint !== "string" || !value.payload ||
      typeof value.payload.request_id !== "string" || typeof value.payload.code !== "string" ||
      typeof value.payload.name !== "string" || typeof value.payload.name_ar !== "string" ||
      typeof value.payload.opening_kg !== "string") return null;
    return value as PendingMaterial;
  } catch { return null; }
};
const recoverMaterialDraft = (pending: PendingMaterial): MaterialDraft => pending.draft && typeof pending.draft.code === "string"
  ? pending.draft
  : { code: pending.payload.code, name: pending.payload.name, nameAr: pending.payload.name_ar, openingKg: pending.payload.opening_kg };
const storePendingMaterial = (key: string, pending: PendingMaterial) => window.sessionStorage.setItem(key, JSON.stringify(pending));
const removePendingMaterial = (key: string) => { try { window.sessionStorage.removeItem(key); } catch { /* Best-effort cleanup after a confirmed outcome. */ } };

function ModuleNav({ user, en }: { user: ProductionUser; en: boolean }) {
  const prodLabels: Record<string, [string, string]> = {
    management: ["إدارة الإنتاج", "Production management"], film: ["تشغيل الفيلم", "Film operations"], printing: ["الطباعة", "Printing"],
    cutting: ["القص", "Cutting"], mixing: ["خلط مواد الخام", "Raw material mixing"],
  };
  const warehouseLabels: Record<string, [string, string]> = {
    hall: ["صالة الإنتاج", "Production hall"], warehouse: ["المخزون التام", "Finished inventory"],
    raw: ["صالة الخام", "Raw materials"], "raw-materials": ["صالة الخام", "Raw materials"],
  };
  const production = availableProductionViews(user), warehouse = availableWarehouseViews(user);
  return <nav className="raw-ops-nav" aria-label={en ? "Production and warehouse modules" : "وحدات الإنتاج والمستودع"}>
    {production.map(view => <Link key={view.view} href={view.href}>{prodLabels[view.view]?.[en ? 1 : 0] ?? view.view}</Link>)}
    {warehouse.map(view => <Link key={view.view} href={view.href} aria-current={view.href === "/warehouse/raw-materials" ? "page" : undefined}>{view.href === "/warehouse/raw-materials" ? tx("rawTab", en) : warehouseLabels[view.view]?.[en ? 1 : 0] ?? view.view}</Link>)}
    {!warehouse.some(view => view.href === "/warehouse/raw-materials") && canViewRawInventory(user) && <Link href="/warehouse/raw-materials" aria-current="page">{tx("title", en)}</Link>}
  </nav>;
}

export default function RawInventoryPage({ user }: RawInventoryPageProps) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const allowed = canViewRawInventory(user);
  const mayManage = hasProductionPermission(user, "manage_raw_materials");
  const storageKey = materialStorageKey(user.id);
  const [initialPending] = useState(() => readPendingMaterial(storageKey));
  const [recoveredDraft] = useState(() => initialPending ? recoverMaterialDraft(initialPending) : null);
  const [state, setState] = useState<MixingState | null>(null);
  const [loading, setLoading] = useState(allowed), [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<MaterialDraft>(recoveredDraft ?? initialDraft), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMaterial | null>(initialPending);
  const [pendingFailed, setPendingFailed] = useState(Boolean(initialPending));
  const [saveError, setSaveError] = useState(initialPending ? tx("recovered", en) : ""), [success, setSuccess] = useState("");
  const generation = useRef(0);
  const hydratedKey = useRef(storageKey);
  const fingerprint = draftKey(draft);
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const currentDraftRef = useRef(draft);
  currentDraftRef.current = draft;
  const locked = Boolean(pending && pendingFailed);

  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setLoadError("");
    try {
      const snapshot = await rawMixingApi.state();
      if (current === generation.current) setState(snapshot);
    } catch (cause) {
      if (current === generation.current) setLoadError(cause instanceof Error ? cause.message : tx("loadFail", en));
    } finally { if (current === generation.current) setLoading(false); }
  }, [allowed, en]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (hydratedKey.current === storageKey) return;
    hydratedKey.current = storageKey;
    const recovered = readPendingMaterial(storageKey);
    setPending(recovered);
    setPendingFailed(Boolean(recovered));
    setSaveError(recovered ? tx("recovered", en) : "");
    setDraft(recovered ? recoverMaterialDraft(recovered) : initialDraft);
  }, [storageKey, en]);
  useEffect(() => {
    if (!pending || !busy || pendingFailed) return;
    try { storePendingMaterial(storageKey, { ...pending, draft: { ...draft } }); }
    catch { /* The original payload was already stored before its first send. */ }
  }, [busy, draft, pending, pendingFailed, storageKey]);

  const setField = (field: keyof MaterialDraft, value: string) => setDraft(previous => ({ ...previous, [field]: value }));
  const submit = async (event?: FormEvent, retrying = false) => {
    event?.preventDefault();
    if (busy) return;
    setSaveError(""); setSuccess("");
    let operation = pending;
    if (!retrying) {
      if (!mayManage || pending) return;
      const code = draft.code.trim(), name = draft.name.trim(), nameAr = draft.nameAr.trim();
      const opening = latin(draft.openingKg);
      if (!code || !name || !nameAr || code.length > 40 || name.length > 120 || nameAr.length > 120) { setSaveError(tx("fields", en)); return; }
      if ((state?.materials ?? []).some(material => material.code.trim().toLocaleLowerCase() === code.toLocaleLowerCase())) { setSaveError(tx("duplicate", en)); return; }
      if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(opening) || !Number.isFinite(Number(opening)) || Number(opening) < 0) { setSaveError(tx("invalidOpening", en)); return; }
      let id: string;
      try { id = secureId(); } catch { setSaveError(tx("secure", en)); return; }
      const payload: RawMaterialInput = { request_id: id, code, name, name_ar: nameAr, opening_kg: opening };
      operation = { payload, fingerprint, draft: { ...draft } };
      try { storePendingMaterial(storageKey, operation); }
      catch { setSaveError(tx("storageUnavailable", en)); return; }
      setPendingFailed(false);
      setPending(operation);
    }
    if (!operation) return;
    if (!mayManage) { setSaveError(tx("retryPermission", en)); return; }
    setBusy(true);
    try {
      const material = await rawMixingApi.createMaterial(operation.payload);
      removePendingMaterial(storageKey);
      setPending(null); setPendingFailed(false); setSaveError(""); setSuccess(tx("created", en));
      if (fingerprintRef.current === operation.fingerprint) setDraft(initialDraft);
      setState(previous => previous ? { ...previous, materials: [...previous.materials.filter(item => item.id !== material.id), material] } : previous);
      await load();
    } catch (cause) {
      if (confirmedProductionRejection(cause)) {
        removePendingMaterial(storageKey);
        setPending(null); setPendingFailed(false); setSaveError(cause instanceof Error ? cause.message : tx("saveError", en));
      } else {
        try { storePendingMaterial(storageKey, { ...operation, draft: { ...currentDraftRef.current } }); } catch { /* Keep the original persisted request if storage is unavailable. */ }
        setPendingFailed(true); setSaveError(requestError(cause, en));
      }
    }
    finally { setBusy(false); }
  };
  const materials = state?.materials ?? [];
  const hasNegative = materials.some(material => Number(latin(material.quantity_kg)) < 0);

  return <main className="raw-ops production">
    <header className="raw-ops-header">
      <div className="raw-ops-heading"><div className="raw-ops-kicker">MPBF / MATERIAL CONTROL</div><h1>{tx("title", en)}</h1><p>{tx("intro", en)}</p></div>
      <div className="raw-ops-actions"><button className="raw-btn quiet" onClick={() => void load()} disabled={loading}><RefreshCw />{tx("refresh", en)}</button><div className="raw-ops-mark" aria-hidden="true"><i /><span>STOCK<br />TRACE / 03</span></div></div>
    </header>
    <ModuleNav user={user} en={en} />
    {!allowed ? <div className="raw-ops-banner error" role="alert">{tx("permission", en)}</div> : <>
      {loadError && <div className="raw-ops-banner error" role="alert"><span>{loadError || tx("loadFail", en)}</span><button className="raw-btn quiet" onClick={() => void load()}><RefreshCw />{tx("retry", en)}</button></div>}
      {hasNegative && <div className="raw-ops-banner warning" role="status"><AlertTriangle size={17} />{tx("negative", en)}</div>}
      {(saveError || pending) && <div className="raw-ops-banner error" role="alert"><div>{pending ? <>{tx("failedRetry", en)}<div className="raw-ops-helper">{saveError || tx("recovered", en)}</div>{!mayManage && <div className="raw-ops-helper">{tx("retryPermission", en)}</div>}</> : saveError}</div>{pending && <button className="raw-btn" onClick={() => void submit(undefined, true)} disabled={busy || !mayManage}><RotateCw />{busy ? tx("loading", en) : tx("retry", en)}</button>}</div>}
      {success && <div className="raw-ops-banner success" role="status">{success}</div>}
      {mayManage && <section className="raw-ops-card">
        <div className="raw-ops-card-head"><h2>{tx("catalog", en)}</h2></div>
        <div className="raw-ops-card-body"><form onSubmit={event => void submit(event)}>
          <div className="raw-ops-form-grid">
            <div className="raw-ops-field"><label htmlFor="raw-code">{tx("code", en)}</label><input id="raw-code" maxLength={40} required value={draft.code} disabled={locked} onChange={event => setField("code", event.target.value)} /></div>
            <div className="raw-ops-field"><label htmlFor="raw-name">{tx("englishName", en)}</label><input id="raw-name" maxLength={120} required value={draft.name} disabled={locked} onChange={event => setField("name", event.target.value)} /></div>
            <div className="raw-ops-field"><label htmlFor="raw-name-ar">{tx("nameAr", en)}</label><input id="raw-name-ar" maxLength={120} required dir="rtl" value={draft.nameAr} disabled={locked} onChange={event => setField("nameAr", event.target.value)} /></div>
            <div className="raw-ops-field"><label htmlFor="raw-opening">{tx("opening", en)}</label><input id="raw-opening" inputMode="decimal" maxLength={15} required value={draft.openingKg} disabled={locked} onChange={event => setField("openingKg", event.target.value)} /></div>
          </div>
          <div className="raw-ops-form-actions"><button className="raw-btn" type="submit" disabled={busy || locked}><Plus />{busy ? tx("loading", en) : tx("add", en)}</button></div>
        </form></div>
      </section>}
      {!mayManage && <div className="raw-ops-banner">{tx("readOnly", en)}</div>}
      <section className="raw-ops-card">
        <div className="raw-ops-card-head"><h2>{tx("inventory", en)}</h2><span className="raw-ops-helper">{state ? `${formatWholeNumber(materials.length)} ${tx("count", en)}` : ""}</span></div>
        <div className="raw-ops-card-body">
          {loading && !state ? <div className="raw-ops-skeleton" aria-label={tx("loading", en)}><i /><i /><i /></div> : materials.length ? <div className="raw-ops-table-wrap">
            <table className="raw-ops-table">
              <thead><tr><th>{tx("code", en)}</th><th>{tx("material", en)}</th><th>{tx("balance", en)}</th><th>{tx("state", en)}</th><th>{tx("createdId", en)}</th></tr></thead>
              <tbody>{materials.map(material => {
                const negative = Number(latin(material.quantity_kg)) < 0;
                const materialName = en ? (/[\u0600-\u06ff]/.test(material.name) ? material.code : material.name) : material.name_ar || material.code;
                return <tr key={material.id}>
                  <td className="raw-ops-number">{material.code}</td>
                  <td>{materialName}</td>
                  <td><span className={`raw-ops-balance${negative ? " negative" : ""}`}><bdi className="raw-ops-number">{formatNumber(material.quantity_kg)}</bdi> kg</span>{negative && <div className="raw-ops-helper">{tx("negativeDetail", en)}</div>}</td>
                  <td>{material.is_active ? tx("active", en) : tx("inactive", en)}</td>
                  <td className="raw-ops-number">{formatWholeNumber(material.id)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <div className="raw-ops-empty"><strong>{tx("noMaterials", en)}</strong><span>{mayManage ? tx("catalog", en) : tx("readOnly", en)}</span></div>}
        </div>
      </section>
    </>}
  </main>;
}
