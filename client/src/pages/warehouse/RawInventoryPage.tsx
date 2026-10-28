import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Plus, RefreshCw, RotateCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { hasProductionPermission, type ProductionUser } from "../../../../shared/production";
import { canViewRawInventory, type MixingState, type RawMovementInput, type RawVoucher } from "../../../../shared/raw-mixing";
import { formatNumber, formatWholeNumber } from "../../lib/format-number";
import { confirmedProductionRejection } from "../../lib/production-api";
import { rawMixingApi } from "../../lib/raw-mixing-api";
import { normalizeRawNumber as latin, rawQuantityValue as quantityValue } from "../../lib/raw-quantity";
import { availableWarehouseViews } from "../../lib/warehouse-navigation";

import "../production/production.css";
import "../production/raw-operations.css";
import "./warehouse-cards.css";

export type RawInventoryPageProps = { user: ProductionUser };
type MovementLine = { materialId: string; quantity: string };
type MovementDraft = { kind: "receipt" | "issue"; rows: MovementLine[]; notes: string };
type PendingMovement = { payload: RawMovementInput; fingerprint: string; draft?: MovementDraft };
const blankDraft = (kind: MovementDraft["kind"] = "receipt"): MovementDraft => ({ kind, rows: [{ materialId: "", quantity: "" }], notes: "" });
const messages: Record<string, [string, string]> = {
  title: ["مخزون المواد الخام", "Raw material inventory"], intro: ["أرصدة المواد وحركات الاستلام والصرف من دليل المواد المعتمد.", "Balances and stock movements from the approved material catalog."],
  inventory: ["أرصدة المواد الخام", "Raw material balances"], receipt: ["إدخال مواد خام", "Receive raw materials"], issue: ["صرف مواد خام", "Issue raw materials"],
  material: ["المادة", "Material"], chooseMaterial: ["اختر مادة من الدليل", "Select a catalog material"], balance: ["الرصيد الحالي", "Current balance"],
  totalReceived: ["مجموع الداخل", "Total received"], totalIssued: ["مجموع الخارج", "Total issued"],
  quantity: ["الكمية (كجم)", "Quantity (kg)"], notes: ["ملاحظات (اختياري)", "Notes (optional)"], addLine: ["إضافة مادة", "Add material"], removeLine: ["حذف السطر", "Remove line"],
  save: ["تأكيد الحركة", "Confirm movement"], cancel: ["إلغاء", "Cancel"], refresh: ["تحديث", "Refresh"], retry: ["إعادة المحاولة", "Retry"], loading: ["جارٍ التحميل", "Loading"],
  permission: ["لا تتوفر صلاحية لعرض مخزون المواد الخام.", "You do not have permission to view raw inventory."],
  loadFail: ["تعذر تحميل أرصدة المواد الخام.", "Raw-material balances could not be loaded."], secure: ["تعذر إنشاء معرّف آمن. لم يتم إرسال الطلب.", "Could not create a secure request ID. The request was not sent."],
  fields: ["اختر مادة وأدخل كمية موجبة لكل سطر.", "Select a material and enter a positive quantity on every line."],
  duplicate: ["اختر كل مادة مرة واحدة فقط.", "Each material can only be selected once."], invalidWeight: ["أدخل كمية موجبة لا تتجاوز ١٢ رقماً ومنزلتين عشريتين.", "Enter a positive quantity with up to 12 digits and 2 decimal places."],
  invalidNotes: ["يجب ألا تتجاوز الملاحظات ٢٠٠٠ حرف.", "Notes must be 2,000 characters or fewer."], maxLines: ["الحد الأقصى ١٠٠ مادة في الحركة.", "A movement can include at most 100 materials."],
  saveError: ["تعذر تأكيد الحركة. أعد المحاولة بالطلب نفسه.", "Movement could not be confirmed. Retry the exact request."],
  failedRetry: ["لم يتأكد الحفظ. أعد المحاولة بالطلب نفسه لتجنب التكرار.", "The result is unconfirmed. Retry the exact request to avoid duplication."],
  recovered: ["يوجد طلب غير محسوم من جلسة سابقة. أعد إرساله للتأكد من نتيجته.", "An unresolved request was recovered. Retry it to confirm the result."],
  storageUnavailable: ["تعذر حفظ طلب الاسترداد؛ لم يتم الإرسال.", "Could not preserve the recovery request; nothing was sent."],
  retryPermission: ["لم تعد تملك صلاحية إدارة المواد الخام، لذلك لم يُعد إرسال الطلب.", "You no longer have raw-material management access, so the request was not retried."],
  successReceipt: ["تم إدخال المواد الخام.", "Raw materials received."], successIssue: ["تم صرف المواد الخام.", "Raw materials issued."],
  readonly: ["عرض فقط — تسجيل الحركات متاح لمن لديه صلاحية إدارة المواد الخام.", "Read only — movements require raw-material management access."],
  active: ["نشطة", "Active"], inactive: ["غير نشطة", "Inactive"], negative: ["رصيد سالب", "Negative balance"],
  negativeDetail: ["الرصيد السالب مسموح؛ راجعه مع مسؤول المخزون.", "Negative stock is allowed; review it with the inventory lead."],
  issueMayGoNegative: ["تنبيه: قد يصبح رصيد مادة أو أكثر سالباً بعد الصرف. الحركة مسموحة؛ راجع الرصيد لاحقاً.", "Warning: this issue may make one or more balances negative. The movement is allowed; review the balance afterward."],
  noMaterials: ["لا توجد مواد خام معتمدة متاحة.", "No approved raw materials are available."], count: ["مادة", "materials"], vouchers: ["آخر حركات المواد", "Recent raw-material movements"],
  noVouchers: ["لا توجد حركات مسجلة بعد.", "No movements recorded yet."], actor: ["المسجل", "Recorded by"], at: ["وقت الحركة", "Movement time"], total: ["الإجمالي", "Total"],
  notesLabel: ["ملاحظة", "Note"], receiptKind: ["إدخال", "Receipt"], issueKind: ["صرف", "Issue"],
};
const tx = (key: string, en: boolean) => messages[key]?.[en ? 1 : 0] ?? key;
const requestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("secure");
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const timeLabel = (value: string, en: boolean) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(date);
};
const localized = (ar: string | null | undefined, english: string | null | undefined, en: boolean, fallback: string) => {
  const safeEnglish = (english ?? "").trim();
  return (en ? (/[\u0600-\u06ff]/.test(safeEnglish) ? "" : safeEnglish) : (ar ?? "").trim() || safeEnglish) || fallback;
};
const englishMaterialName = (english: string | null | undefined, code: string) => {
  const safeEnglish = (english ?? "").trim();
  return safeEnglish && !/[\u0600-\u06ff]/.test(safeEnglish) ? safeEnglish : code;
};
const storageKey = (userId: number) => `mpbf:raw-movement:pending:${userId}`;
const readPending = (key: string): PendingMovement | null => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (!value?.payload || typeof value.fingerprint !== "string" || !["receipt", "issue"].includes(value.payload.kind) ||
      typeof value.payload.request_id !== "string" || !Array.isArray(value.payload.items) ||
      value.payload.items.length < 1 || value.payload.items.length > 100 ||
      !value.payload.items.every((item: unknown) => item && typeof item === "object" &&
        Number.isInteger((item as { material_id?: unknown }).material_id) && typeof (item as { quantity_kg?: unknown }).quantity_kg === "string")) return null;
    return value as PendingMovement;
  } catch { return null; }
};
const persistPending = (key: string, operation: PendingMovement) => window.sessionStorage.setItem(key, JSON.stringify(operation));
const clearPending = (key: string) => { try { window.sessionStorage.removeItem(key); } catch { /* Best-effort cleanup after a confirmed outcome. */ } };
const errorText = (cause: unknown, en: boolean) => cause instanceof Error && cause.message && cause.message !== "secure" ? cause.message : tx(cause instanceof Error && cause.message === "secure" ? "secure" : "saveError", en);

function ModuleNav({ user, en }: { user: ProductionUser; en: boolean }) {
  const warehouseLabels: Record<string, [string, string]> = { hall: ["صالة الإنتاج", "Production hall"], warehouse: ["المنتجات التامة", "Finished products"], deliveries: ["تسليم العملاء", "Customer deliveries"], raw: ["صالة الخام", "Raw materials"], "raw-materials": ["صالة الخام", "Raw materials"] };
  const warehouse = availableWarehouseViews(user);
  return <nav className="raw-ops-nav" aria-label={en ? "Warehouse modules" : "أقسام المستودع"}>
    {warehouse.map(view => <Link key={view.view} href={view.href} aria-current={view.href === "/warehouse/raw-materials" ? "page" : undefined}>{warehouseLabels[view.view]?.[en ? 1 : 0] ?? view.view}</Link>)}
  </nav>;
}

export default function RawInventoryPage({ user }: RawInventoryPageProps) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const allowed = canViewRawInventory(user), mayManage = hasProductionPermission(user, "manage_raw_materials");
  const key = storageKey(user.id);
  const [initialPending] = useState(() => readPending(key));
  const [state, setState] = useState<MixingState | null>(null);
  const [loading, setLoading] = useState(allowed), [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<MovementDraft>(() => initialPending?.draft ?? blankDraft(initialPending?.payload.kind));
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialPending)), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMovement | null>(initialPending);
  const [pendingFailed, setPendingFailed] = useState(Boolean(initialPending));
  const [saveError, setSaveError] = useState(initialPending ? tx("recovered", en) : ""), [success, setSuccess] = useState("");
  const generation = useRef(0);
  const draftRef = useRef(draft); draftRef.current = draft;
  const fingerprint = JSON.stringify(draft), fingerprintRef = useRef(fingerprint); fingerprintRef.current = fingerprint;
  const hydratedKey = useRef(key);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setLoadError("");
    try { const snapshot = await rawMixingApi.state(); if (request === generation.current) setState(snapshot); }
    catch (cause) { if (request === generation.current) setLoadError(cause instanceof Error ? cause.message : tx("loadFail", en)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [allowed, en]);
  useEffect(() => {
    const currentGeneration = generation;
    void load();
    return () => { currentGeneration.current++; };
  }, [load]);
  useEffect(() => {
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    const recovered = readPending(key);
    setPending(recovered);
    setPendingFailed(Boolean(recovered));
    setSaveError(recovered ? tx("recovered", en) : "");
    setDraft(recovered?.draft ?? blankDraft(recovered?.payload.kind));
    setDialogOpen(Boolean(recovered));
    setSuccess("");
  }, [key, en]);
  useEffect(() => {
    if (!dialogOpen) {
      returnFocusRef.current?.focus();
      return;
    }
    const dialog = dialogRef.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  const setLine = (index: number, field: keyof MovementLine, value: string) =>
    setDraft(current => ({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, [field]: value } : row) }));
  const submit = async (event?: FormEvent, retrying = false) => {
    event?.preventDefault();
    if (busy) return;
    if (hydratedKey.current !== key) { setSaveError(tx("retryPermission", en)); return; }
    setSaveError(""); setSuccess("");
    let operation = pending;
    if (!retrying) {
      if (!mayManage || pending) return;
      if (draft.notes.length > 2000) { setSaveError(tx("invalidNotes", en)); return; }
      if (draft.rows.length > 100) { setSaveError(tx("maxLines", en)); return; }
      if (!draft.rows.length || draft.rows.some(row => !row.materialId)) { setSaveError(tx("fields", en)); return; }
      const ids = draft.rows.map(row => Number(row.materialId));
      if (new Set(ids).size !== ids.length) { setSaveError(tx("duplicate", en)); return; }
      const items = draft.rows.map(row => ({ material_id: Number(row.materialId), quantity_kg: quantityValue(row.quantity) ?? "" }));
      if (items.some(item => !item.quantity_kg)) { setSaveError(tx("invalidWeight", en)); return; }
      if (items.some(item => !materials.some(material => material.id === item.material_id && material.is_active))) { setSaveError(tx("fields", en)); return; }
      let id: string;
      try { id = requestId(); } catch { setSaveError(tx("secure", en)); return; }
      const payload: RawMovementInput = { request_id: id, kind: draft.kind, ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}), items };
      operation = { payload, fingerprint, draft: { ...draft, rows: draft.rows.map(row => ({ ...row })) } };
      try { persistPending(key, operation); } catch { setSaveError(tx("storageUnavailable", en)); return; }
      setPending(operation);
      setPendingFailed(false);
    }
    if (!operation) return;
    if (!mayManage) { setSaveError(tx("retryPermission", en)); return; }
    setPendingFailed(false);
    setBusy(true);
    try {
      await rawMixingApi.movement(operation.payload);
      clearPending(key); setPending(null); setPendingFailed(false); setSaveError("");
      setSuccess(tx(operation.payload.kind === "receipt" ? "successReceipt" : "successIssue", en));
      if (fingerprintRef.current === operation.fingerprint) { setDraft(blankDraft()); setDialogOpen(false); }
      await load();
    } catch (cause) {
      if (confirmedProductionRejection(cause)) {
        clearPending(key); setPending(null); setPendingFailed(false);
        setSaveError(cause instanceof Error ? cause.message : tx("saveError", en));
      } else {
        try { persistPending(key, { ...operation, draft: { ...draftRef.current, rows: draftRef.current.rows.map(row => ({ ...row })) } }); } catch { /* Original exact request remains persisted. */ }
        setPendingFailed(true); setSaveError(errorText(cause, en));
      }
    } finally { setBusy(false); }
  };
  const materials = state?.materials ?? [];
  const activeMaterials = materials.filter(material => material.is_active);
  const vouchers: RawVoucher[] = state?.raw_vouchers ?? [];
  const hasNegative = materials.some(material => Number(latin(material.quantity_kg)) < 0);
  const issueMayGoNegative = draft.kind === "issue" && draft.rows.some(row => {
    const quantity = quantityValue(row.quantity), material = materials.find(item => item.id === Number(row.materialId));
    return Boolean(quantity && material && Number(latin(material.quantity_kg)) - Number(quantity) < 0);
  });
  const nameFor = (id: number, code: string, english: string | null | undefined) => {
    const material = materials.find(item => item.id === id);
    return englishMaterialName(material?.name ?? english, material?.code ?? code);
  };
  const closeDialog = () => setDialogOpen(false);
  const openMovement = (kind: MovementDraft["kind"], trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setDraft(blankDraft(kind));
    setDialogOpen(true);
  };

  return <main className="raw-ops production">
    <header className="raw-ops-header">
      <div className="raw-ops-heading"><div className="raw-ops-kicker">MPBF / MATERIAL CONTROL</div><h1>{tx("title", en)}</h1><p>{tx("intro", en)}</p></div>
      <div className="raw-ops-actions"><button type="button" className="raw-btn quiet" onClick={() => void load()} disabled={loading}><RefreshCw />{tx("refresh", en)}</button><div className="raw-ops-mark" aria-hidden="true"><i /><span>STOCK<br />TRACE / 03</span></div></div>
    </header>
    <ModuleNav user={user} en={en} />
    {!allowed ? <div className="raw-ops-banner error" role="alert">{tx("permission", en)}</div> : <>
      {loadError && <div className="raw-ops-banner error" role="alert"><span>{loadError || tx("loadFail", en)}</span><button type="button" className="raw-btn quiet" onClick={() => void load()}><RefreshCw />{tx("retry", en)}</button></div>}
      {hasNegative && <div className="raw-ops-banner warning" role="status"><AlertTriangle size={17} />{tx("negative", en)}</div>}
      {(saveError || pending) && <div className="raw-ops-banner error" role="alert"><div>{pending ? <>{tx("failedRetry", en)}<div className="raw-ops-helper">{saveError || tx("recovered", en)}</div>{!mayManage && <div className="raw-ops-helper">{tx("retryPermission", en)}</div>}</> : saveError}</div>{pending && <button type="button" className="raw-btn" onClick={() => void submit(undefined, true)} disabled={busy || !mayManage}><RotateCw />{busy ? tx("loading", en) : tx("retry", en)}</button>}</div>}
      {success && <div className="raw-ops-banner success" role="status">{success}</div>}
      {mayManage ? <section className="raw-ops-card raw-movement-launcher">
        <div className="raw-ops-card-head"><h2>{en ? "Record a stock movement" : "تسجيل حركة مخزون"}</h2><span className="raw-ops-helper">{activeMaterials.length} {tx("count", en)}</span></div>
        <div className="raw-ops-card-body raw-movement-launch-actions">
          <button type="button" className="raw-btn" onClick={event => openMovement("receipt", event.currentTarget)} disabled={Boolean(pending)}><ArrowDownToLine />{tx("receipt", en)}</button>
          <button type="button" className="raw-btn outline" onClick={event => openMovement("issue", event.currentTarget)} disabled={Boolean(pending)}><ArrowUpFromLine />{tx("issue", en)}</button>
        </div>
      </section> : <div className="raw-ops-banner">{tx("readonly", en)}</div>}
      <section className="raw-ops-card">
        <div className="raw-ops-card-head"><h2>{tx("inventory", en)}</h2><span className="raw-ops-helper">{state ? `${formatWholeNumber(materials.length)} ${tx("count", en)}` : ""}</span></div>
        <div className="raw-ops-card-body">
          {loading && !state ? <div className="raw-ops-skeleton" aria-label={tx("loading", en)}><i /><i /><i /></div> : materials.length ? <div className="warehouse-card-grid raw-stock-grid">
            {materials.map(material => {
              const negative = Number(latin(material.quantity_kg)) < 0;
              const title = englishMaterialName(material.name, material.code);
              return <article className="warehouse-stock-card raw-stock-card" key={material.id}>
                <div className="warehouse-stock-card-top"><span className="raw-ops-number">{material.code}</span><span className={`raw-stock-status${material.is_active ? "" : " inactive"}`}>{material.is_active ? tx("active", en) : tx("inactive", en)}</span></div>
                <h3>{title}</h3>
                <div className="raw-stock-balance-row">
                  <div className={`raw-stock-quantity${negative ? " negative" : ""}`}><bdi>{formatNumber(material.quantity_kg)}</bdi><span>kg</span></div>
                  <div className="raw-stock-totals" aria-label={en ? "Material movement totals" : "إجماليات حركة المادة"}>
                    <div><span>{tx("totalReceived", en)}</span><bdi>{formatNumber(material.total_received_kg)} kg</bdi></div>
                    <div><span>{tx("totalIssued", en)}</span><bdi>{formatNumber(material.total_issued_kg)} kg</bdi></div>
                  </div>
                </div>
                {negative && <p className="raw-ops-helper raw-negative-note"><AlertTriangle size={14} />{tx("negativeDetail", en)}</p>}
                <div className="raw-stock-card-foot"><span>{tx("material", en)} ID</span><bdi className="raw-ops-number">{formatWholeNumber(material.id)}</bdi></div>
              </article>;
            })}
          </div> : <div className="raw-ops-empty"><strong>{tx("noMaterials", en)}</strong><span>{tx("readonly", en)}</span></div>}
        </div>
      </section>
      <section className="raw-ops-card raw-voucher-section">
        <div className="raw-ops-card-head"><h2>{tx("vouchers", en)}</h2><span className="raw-ops-helper">{formatWholeNumber(vouchers.length)}</span></div>
        <div className="raw-ops-card-body">{!vouchers.length ? <div className="raw-ops-empty"><strong>{tx("noVouchers", en)}</strong></div> : <div className="raw-voucher-list">
          {vouchers.map(voucher => <article className="raw-voucher-card" key={voucher.id}>
            <header><div><span className={`raw-voucher-kind ${voucher.kind}`}>{tx(voucher.kind === "receipt" ? "receiptKind" : "issueKind", en)}</span><strong>#{formatWholeNumber(voucher.id)}</strong></div><bdi className="raw-voucher-total">{formatNumber(voucher.total_kg)} kg</bdi></header>
            <div className="raw-voucher-meta"><span>{tx("actor", en)}: {localized(voucher.actor_name_ar, voucher.actor_name, en, `#${formatWholeNumber(voucher.created_by)}`)}</span><time>{timeLabel(voucher.created_at, en)}</time></div>
            <ul>{voucher.items.map((item, index) => <li key={`${item.material_id}-${index}`}><span>{nameFor(item.material_id, item.code, item.name)} <small className="raw-ops-number">· {item.code}</small></span><bdi>{formatNumber(item.quantity_kg)} kg</bdi></li>)}</ul>
            {voucher.notes && <p className="raw-voucher-notes">{tx("notesLabel", en)}: {voucher.notes}</p>}
          </article>)}
        </div>}</div>
      </section>
    </>}
    {dialogOpen && mayManage && <div className="raw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section ref={dialogRef} className="raw-movement-dialog" role="dialog" aria-modal="true" aria-labelledby="raw-movement-title">
        <header><div><span className={`raw-voucher-kind ${draft.kind}`}>{tx(draft.kind === "receipt" ? "receiptKind" : "issueKind", en)}</span><h2 id="raw-movement-title">{tx(draft.kind, en)}</h2></div><button type="button" className="raw-icon-button" aria-label={tx("cancel", en)} onClick={closeDialog}><X /></button></header>
        {!activeMaterials.length ? <div className="raw-ops-empty"><strong>{tx("noMaterials", en)}</strong></div> : <form onSubmit={event => void submit(event)}>
          <div className="raw-movement-lines">{draft.rows.map((row, index) => <div className="raw-movement-line" key={index}>
            <div className="raw-ops-field"><label htmlFor={`raw-material-${index}`}>{tx("material", en)}</label><select id={`raw-material-${index}`} value={row.materialId} onChange={event => setLine(index, "materialId", event.target.value)} required disabled={pendingFailed}>
              <option value="">{tx("chooseMaterial", en)}</option>
              {activeMaterials.filter(item => item.id === Number(row.materialId) || !draft.rows.some((other, otherIndex) => otherIndex !== index && Number(other.materialId) === item.id)).map(item => <option key={item.id} value={item.id}>{englishMaterialName(item.name, item.code)} · {item.code}</option>)}
            </select></div>
            <div className="raw-ops-field"><label htmlFor={`raw-quantity-${index}`}>{tx("quantity", en)}</label><input id={`raw-quantity-${index}`} inputMode="decimal" autoComplete="off" maxLength={15} value={row.quantity} onChange={event => setLine(index, "quantity", event.target.value)} placeholder="0.00" required disabled={pendingFailed} /></div>
            <button type="button" className="raw-icon-button raw-remove-line" aria-label={tx("removeLine", en)} onClick={() => setDraft(current => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))} disabled={pendingFailed || draft.rows.length === 1}><Trash2 /></button>
          </div>)}</div>
          <button type="button" className="raw-btn outline raw-add-line" onClick={() => setDraft(current => current.rows.length < 100 ? { ...current, rows: [...current.rows, { materialId: "", quantity: "" }] } : current)} disabled={pendingFailed || draft.rows.length >= 100}><Plus />{tx("addLine", en)}</button>
          {issueMayGoNegative && <div className="raw-ops-banner warning raw-movement-warning" role="status"><AlertTriangle size={16} />{tx("issueMayGoNegative", en)}</div>}
          <div className="raw-ops-field raw-movement-notes"><label htmlFor="raw-movement-notes">{tx("notes", en)}</label><textarea id="raw-movement-notes" maxLength={2000} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} disabled={pendingFailed} /></div>
          {saveError && !pending && <div className="raw-ops-banner error" role="alert">{saveError}</div>}
          <footer><button type="button" className="raw-btn quiet" onClick={closeDialog}>{tx("cancel", en)}</button><button type="submit" className="raw-btn" disabled={busy || Boolean(pending)}>{busy ? tx("loading", en) : tx("save", en)}</button></footer>
        </form>}
      </section>
    </div>}
  </main>;
}
