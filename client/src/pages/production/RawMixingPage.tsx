import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown, EyeOff, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import type { MixingInput, MixingRecord, MixingState } from "../../../../shared/raw-mixing";
import { canRecordMixing, canViewMixing, canViewSavedMixingComposition } from "../../../../shared/raw-mixing";
import { hasProductionPermission, type ProductionUser } from "../../../../shared/production";
import { availableProductionViews } from "../../lib/production-navigation";
import { confirmedProductionRejection } from "../../lib/production-api";
import { rawMixingApi } from "../../lib/raw-mixing-api";
import { normalizeRawNumber as latin, rawQuantityValue as quantityValue } from "../../lib/raw-quantity";
import { formatNumber, formatWholeNumber } from "../../lib/format-number";
import { mixingComposition, type CompositionLine } from "../../lib/raw-mixing-composition";
import "./production.css";
import "./raw-operations.css";

export type RawMixingPageProps = { user: ProductionUser };
type MaterialLine = { materialId: string; quantity: string };
type Screw = "A" | "B";
type PendingDraft = { machine: string; screw?: Screw; rows: MaterialLine[]; notes: string; notesVisible?: boolean };
type PendingMix = { id: string; payload: MixingInput; fingerprint: string; draft?: PendingDraft };
type MachineConfig = MixingState["machines"][number];

const messages: Record<string, [string, string]> = {
  title: ["خلط مواد الخام", "Raw material mixing"],
  intro: ["سجّل الأوزان الفعلية أثناء تشغيل ماكينة الفيلم. لا يُمنع التسجيل عند انخفاض الرصيد.", "Record actual weights while a film machine is running. Low stock never blocks a record."],
  form: ["تسجيل خلطة فعلية", "Record actual mix"], history: ["سجل الخلطات", "Mixing history"],
  machine: ["ماكينة الفيلم", "Film machine"], chooseMachine: ["اختر الماكينة", "Choose machine"],
  material: ["المادة الخام", "Raw material"], chooseMaterial: ["اختر مادة", "Choose material"],
  weight: ["الوزن الفعلي (كجم)", "Actual weight (kg)"], notes: ["ملاحظات (اختياري)", "Notes (optional)"],
  addLine: ["إضافة مادة", "Add material"], remove: ["حذف السطر", "Remove line"], save: ["تسجيل الخلطة", "Record mix"],
  loadFail: ["تعذر تحميل بيانات الخلط.", "Mixing data could not be loaded."],
  retry: ["إعادة المحاولة", "Retry"], refresh: ["تحديث", "Refresh"], loading: ["جارٍ التحميل", "Loading"],
  errorGeneric: ["تعذر حفظ الخلطة. أعد المحاولة بالطلب نفسه.", "The mix could not be saved. Retry this exact request."],
  permission: ["لا تتوفر صلاحية لعرض سجل الخلط.", "You do not have permission to view mixing."],
  readonly: ["عرض فقط — لا تتوفر صلاحية تسجيل الخلط.", "Read only — you cannot record mixes."],
  success: ["تم تسجيل الخلطة.", "Mix recorded."], noHistory: ["لا توجد خلطات مسجلة بعد.", "No mixes have been recorded yet."],
  noMaterials: ["لا توجد مواد خام في الدليل.", "There are no raw materials in the catalog."],
  noMachines: ["لا توجد ماكينات فيلم متاحة.", "No film machines are available."],
  actor: ["المشغل", "Operator"], date: ["وقت التسجيل", "Recorded at"], total: ["إجمالي الوزن", "Total weight"],
  negative: ["تنبيه: سيصبح رصيد مادة واحدة أو أكثر سالباً بعد هذه الخلطة. التسجيل مسموح؛ راجع الرصيد لاحقاً.", "Warning: one or more balances will become negative after this mix. Recording is allowed; review the balance later."],
  failedRetry: ["لم يتأكد الحفظ. الحقول مجمدة لتفادي تغيير الطلب؛ أعد إرسال الطلب نفسه.", "Save was not confirmed. Fields are locked to protect the original request; retry the same request."],
  secure: ["تعذر إنشاء معرّف آمن. لا ترسل الطلب يدوياً.", "Could not create a secure request ID. Do not submit manually."],
  invalidMachine: ["اختر ماكينة فيلم.", "Choose a film machine."], invalidMaterials: ["أضف مادة واحدة على الأقل.", "Add at least one material."],
  invalidNotes: ["يجب ألا تتجاوز الملاحظات ٢٠٠٠ حرف.", "Notes must be 2,000 characters or fewer."],
  duplicate: ["لا يمكن تكرار المادة في الخلطة.", "A material can only appear once in a mix."],
  invalidWeight: ["أدخل وزناً موجباً لا يتجاوز منزلتين عشريتين لكل مادة.", "Enter a positive weight with no more than two decimal places for each material."],
  inactive: ["لا يمكن تسجيل مادة غير نشطة.", "Inactive materials cannot be recorded."], more: ["تحميل سجلات أقدم", "Load older records"],
  noMore: ["لا توجد سجلات أقدم.", "No older records."], comments: ["ملاحظة", "Note"], machines: ["ماكينات", "Machines"],
  machinesTitle: ["خط الفيلم / تسجيل الخلطة", "FILM LINE / MIX RECORD"], notVoucher: ["هذا سجل تشغيل فقط؛ لا يُنشأ سند مخزني.", "This is an operations record only; no inventory voucher is created."],
  recovered: ["يوجد طلب غير محسوم من جلسة سابقة. أعد إرسال الطلب نفسه للتأكد من نتيجته.", "An unresolved request from this session was found. Retry the exact request to confirm its result."],
  storageUnavailable: ["تعذر حفظ طلب الاسترداد في الجلسة؛ لم يتم الإرسال.", "Could not preserve this request in the session; it was not sent."],
  retryPermission: ["لم تعد تملك صلاحية تسجيل الخلط، لذلك لم يُعاد إرسال الطلب.", "You no longer have permission to record mixes, so the request was not retried."],
  unavailable: ["اسم غير متاح", "Name unavailable"], addNote: ["إضافة ملاحظة", "Add note"], hideNote: ["إخفاء الملاحظة", "Hide note"],
  screw: ["اللولب", "Screw"], chooseScrew: ["اختر اللولب", "Choose screw"], screwA: ["اللولب A", "Screw A"], screwB: ["اللولب B", "Screw B"],
  savedComposition: ["التركيبة المحفوظة", "Saved composition"], combined: ["التركيبة المجمعة", "Combined composition"],
  unsavedPreview: ["معاينة غير محفوظة — تستبدل تركيبة اللولب المحدد", "Unsaved preview — substitutes the selected screw mix"],
  noScrewMix: ["لا توجد خلطة محفوظة لهذا اللولب.", "No saved mix for this screw."], noComposition: ["لا توجد تركيبات محفوظة بعد.", "No saved compositions yet."],
  partial: ["إجمالي جزئي", "Partial total"], materialPercent: ["النسبة", "Share"], switchConfirm: ["سيؤدي تغيير الماكينة أو اللولب إلى حذف بيانات الخلطة الحالية. هل تريد المتابعة؟", "Changing machine or screw will discard the current mix draft. Continue?"],
  legacyScrew: ["لولب غير محدد", "Unidentified screw"],
  unavailableComposition: ["تعذر احتساب التركيبة بسبب أوزان غير صالحة.", "Composition unavailable because saved weights are invalid."],
};
const tx = (key: string, en: boolean) => messages[key]?.[en ? 1 : 0] ?? key;
const dateTime = (raw: string, en: boolean) => {
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? "—" : new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(value);
};
const localized = (ar: string | null | undefined, enValue: string | null | undefined, en: boolean, fallback: string) => {
  const arValue = (ar ?? "").trim(), english = (enValue ?? "").trim();
  const safeEnglish = /[\u0600-\u06ff]/.test(english) ? "" : english;
  return (en ? safeEnglish : arValue) || fallback;
};
const requestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("secure");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const errorMessage = (cause: unknown, en: boolean) => cause instanceof Error && cause.message && cause.message !== "secure" ? cause.message : tx(cause instanceof Error && cause.message === "secure" ? "secure" : "errorGeneric", en);
const cleanDraft = (machine: string, screw: Screw | "", rows: MaterialLine[], notes: string) => JSON.stringify({ machine, screw, rows, notes });
// Upgrade the old comparison format, not the newer draft captured in flight.
const recoverFingerprint = (pending: PendingMix) => {
  try {
    const original = JSON.parse(pending.fingerprint);
    if (Array.isArray(original.rows))
      return cleanDraft(original.machine, original.screw ?? pending.payload.screw ?? (original.machine ? "A" : ""), original.rows, original.notes);
  } catch { /* Unknown fingerprints must not match and clear a draft. */ }
  return pending.fingerprint;
};
const mixingStorageKey = (userId: number) => `mpbf:raw-mixing:pending:${userId}`;
const readPendingMix = (key: string): PendingMix | null => {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
    if (!value || typeof value.id !== "string" || typeof value.fingerprint !== "string" || !value.payload ||
      typeof value.payload.machine_id !== "string" || typeof value.payload.request_id !== "string" ||
      !Array.isArray(value.payload.items) || value.payload.items.length < 1 || value.payload.items.length > 100 ||
      !value.payload.items.every((item: unknown) => item && typeof item === "object" &&
        Number.isInteger((item as { material_id?: unknown }).material_id) &&
        typeof (item as { quantity_kg?: unknown }).quantity_kg === "string")) return null;
    return value as PendingMix;
  } catch { return null; }
};
const recoverMixDraft = (pending: PendingMix): PendingDraft => pending.draft && typeof pending.draft.machine === "string" && Array.isArray(pending.draft.rows)
  ? { ...pending.draft, notesVisible: pending.draft.notesVisible ?? Boolean(pending.draft.notes) }
  : { machine: pending.payload.machine_id, screw: pending.payload.screw, rows: pending.payload.items.map(item => ({ materialId: String(item.material_id), quantity: item.quantity_kg })), notes: pending.payload.notes ?? "", notesVisible: Boolean(pending.payload.notes) };
const storePendingMix = (key: string, pending: PendingMix) => window.sessionStorage.setItem(key, JSON.stringify(pending));
const removePendingMix = (key: string) => { try { window.sessionStorage.removeItem(key); } catch { /* Best-effort cleanup after a confirmed outcome. */ } };
const retryMessage = (cause: unknown, en: boolean) => {
  if (confirmedProductionRejection(cause) && cause instanceof Error && cause.message.trim()) return cause.message;
  return errorMessage(cause, en);
};

function Nav({ user, en }: { user: ProductionUser; en: boolean }) {
  const views = availableProductionViews(user);
  const labels: Record<string, [string, string]> = {
    management: ["إدارة الإنتاج", "Production management"], film: ["تشغيل الفيلم", "Film operations"],
    printing: ["الطباعة", "Printing"], cutting: ["القص", "Cutting"], mixing: ["خلط مواد الخام", "Raw material mixing"],
    monitoring: ["مراقبة الإنتاج", "Production monitoring"],
  };
  return <nav className="raw-ops-nav" aria-label={en ? "Production modules" : "وحدات الإنتاج"}>
    {views.map(view => <Link key={view.view} href={view.href} aria-current={view.href === "/production/mixing" ? "page" : undefined}>{labels[view.view]?.[en ? 1 : 0] ?? view.view}</Link>)}
    {!views.some(view => view.href === "/production/mixing") && (canViewMixing(user) || hasProductionPermission(user, "manage_mixing")) &&
      <Link href="/production/mixing" aria-current="page">{tx("title", en)}</Link>}
  </nav>;
}

function LoadingRows({ label }: { label: string }) {
  return <div className="raw-ops-skeleton" aria-label={label}><i /><i /><i /></div>;
}

export default function RawMixingPage({ user }: RawMixingPageProps) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const allowed = canViewMixing(user), writable = canRecordMixing(user);
  const storageKey = mixingStorageKey(user.id);
  const [initialPending] = useState(() => readPendingMix(storageKey));
  const [recoveredDraft] = useState(() => initialPending ? recoverMixDraft(initialPending) : null);
  const [state, setState] = useState<MixingState | null>(null);
  const [loading, setLoading] = useState(allowed), [loadError, setLoadError] = useState("");
  const [olderLoading, setOlderLoading] = useState(false), [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(initialPending ? tx("recovered", en) : ""), [success, setSuccess] = useState("");
  const [machine, setMachine] = useState(recoveredDraft?.machine ?? "");
  const [screw, setScrew] = useState<Screw | "">(recoveredDraft?.screw ?? (recoveredDraft?.machine ? "A" : ""));
  const [rows, setRows] = useState<MaterialLine[]>(recoveredDraft?.rows ?? [{ materialId: "", quantity: "" }]);
  const [notes, setNotes] = useState(recoveredDraft?.notes ?? "");
  const [notesVisible, setNotesVisible] = useState(Boolean(recoveredDraft?.notesVisible || recoveredDraft?.notes));
  const [pending, setPending] = useState<PendingMix | null>(() => {
    return initialPending ? { ...initialPending, fingerprint: recoverFingerprint(initialPending) } : null;
  });
  const [pendingFailed, setPendingFailed] = useState(Boolean(initialPending));
  const generation = useRef(0);
  const hydratedKey = useRef(storageKey);
  const draftFingerprint = cleanDraft(machine, screw, rows, notes);
  const draftFingerprintRef = useRef(draftFingerprint);
  draftFingerprintRef.current = draftFingerprint;
  const currentDraftRef = useRef({ machine, screw, rows, notes, notesVisible });
  currentDraftRef.current = { machine, screw, rows, notes, notesVisible };
  const locked = Boolean(pending && pendingFailed);

  const load = useCallback(async (before?: number) => {
    const current = ++generation.current;
    if (!allowed) { setLoading(false); return; }
    if (before) setOlderLoading(true); else { setLoading(true); setLoadError(""); }
    try {
      const next = await rawMixingApi.state(before);
      if (current !== generation.current) return;
      setState(previous => before && previous
        ? { ...next, records: [...previous.records, ...next.records.filter(record => !previous.records.some(old => old.id === record.id))] }
        : next);
    } catch (cause) {
      if (current === generation.current) setLoadError(cause instanceof Error ? cause.message : tx("loadFail", en));
    } finally {
      if (current === generation.current) { setLoading(false); setOlderLoading(false); }
    }
  }, [allowed, en]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (hydratedKey.current === storageKey) return;
    hydratedKey.current = storageKey;
    const recovered = readPendingMix(storageKey);
    setPending(recovered ? { ...recovered, fingerprint: recoverFingerprint(recovered) } : null);
    setPendingFailed(Boolean(recovered));
    setSaveError(recovered ? tx("recovered", en) : "");
    if (recovered) {
      const restored = recoverMixDraft(recovered);
      setMachine(restored.machine);
      setScrew(restored.screw ?? (restored.machine ? "A" : ""));
      setRows(restored.rows);
      setNotes(restored.notes);
      setNotesVisible(Boolean(restored.notesVisible || restored.notes));
    } else {
      setMachine("");
      setScrew("");
      setRows([{ materialId: "", quantity: "" }]);
      setNotes("");
      setNotesVisible(false);
    }
  }, [storageKey, en]);
  useEffect(() => {
    if (!pending || !busy || pendingFailed) return;
    try { storePendingMix(storageKey, { ...pending, draft: { machine, screw: screw || undefined, rows: rows.map(row => ({ ...row })), notes, notesVisible } }); }
    catch { /* The original payload was already stored before its first send. */ }
  }, [busy, machine, notes, notesVisible, pending, pendingFailed, rows, screw, storageKey]);

  const selectedRows = rows.map(row => ({ ...row, material: state?.materials.find(item => String(item.id) === row.materialId) }));
  const machines = state?.machines ?? [];
  const negativeBalance = selectedRows.some(row => {
    const quantity = quantityValue(row.quantity);
    if (!row.material) return false;
    const balance = Number(latin(row.material.quantity_kg));
    return balance < 0 || Boolean(quantity && balance - Number(quantity) < 0);
  });
  const addRow = () => setRows(existing => [...existing, { materialId: "", quantity: "" }]);
  const updateRow = (index: number, patch: Partial<MaterialLine>) => setRows(existing => existing.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const removeRow = (index: number) => setRows(existing => existing.filter((_, rowIndex) => rowIndex !== index));
  const selectedMachine = machines.find(item => item.id === machine);
  const isDualScrew = (item?: MachineConfig) => (item?.screw_type ?? "").trim().toUpperCase() === "ABA";
  const hasDraftContent = () => rows.some(row => row.materialId || row.quantity.trim()) || Boolean(notes.trim());
  const discardDraft = () => { setRows([{ materialId: "", quantity: "" }]); setNotes(""); setNotesVisible(false); setSaveError(""); setSuccess(""); };
  const changeMachine = (next: string) => {
    if (next === machine) return;
    if (hasDraftContent() && !window.confirm(tx("switchConfirm", en))) return;
    if (hasDraftContent()) discardDraft();
    setMachine(next);
    setScrew(next ? (isDualScrew(machines.find(item => item.id === next)) ? "" : "A") : "");
  };
  const changeScrew = (next: Screw | "") => {
    if (next === screw) return;
    if (hasDraftContent() && !window.confirm(tx("switchConfirm", en))) return;
    if (hasDraftContent()) discardDraft();
    setScrew(next);
  };
  const validateAndBuild = (): MixingInput | null => {
    if (!selectedMachine || selectedMachine.status !== "active") { setSaveError(tx("invalidMachine", en)); return null; }
    if (!screw || (isDualScrew(selectedMachine) ? screw !== "A" && screw !== "B" : screw !== "A")) { setSaveError(tx("chooseScrew", en)); return null; }
    if (!rows.length || rows.length > 100) { setSaveError(tx("invalidMaterials", en)); return null; }
    if (notes.length > 2000) { setSaveError(tx("invalidNotes", en)); return null; }
    const ids = rows.map(row => row.materialId);
    if (ids.some(id => !id) || ids.some((id, index) => ids.indexOf(id) !== index)) { setSaveError(tx(ids.some(id => id && ids.indexOf(id) !== ids.lastIndexOf(id)) ? "duplicate" : "invalidMaterials", en)); return null; }
    const items: MixingInput["items"] = [];
    for (const row of rows) {
      const material = state?.materials.find(item => String(item.id) === row.materialId);
      if (!material || !material.is_active) { setSaveError(tx("inactive", en)); return null; }
      const quantity = quantityValue(row.quantity);
      if (!quantity) { setSaveError(tx("invalidWeight", en)); return null; }
      items.push({ material_id: material.id, quantity_kg: quantity });
    }
    return { request_id: "", machine_id: machine, screw, notes: notes.trim() || undefined, items };
  };
  const save = async (retrying = false) => {
    if (busy) return;
    setSaveError(""); setSuccess("");
    let operation = pending;
    if (!retrying) {
      if (!writable || pending) return;
      const input = validateAndBuild();
      if (!input) return;
      try { input.request_id = requestId(); }
      catch { setSaveError(tx("secure", en)); return; }
       const freshOperation: PendingMix = { id: input.request_id, payload: input, fingerprint: draftFingerprint, draft: { machine, screw: screw as Screw, rows: rows.map(row => ({ ...row })), notes, notesVisible } };
       operation = freshOperation;
       try { storePendingMix(storageKey, freshOperation); }
      catch { setSaveError(tx("storageUnavailable", en)); return; }
      setPendingFailed(false);
       setPending(freshOperation);
    }
    if (!operation) return;
    if (!writable) { setSaveError(tx("retryPermission", en)); return; }
    setBusy(true);
    try {
      await rawMixingApi.record(operation.payload);
      window.dispatchEvent(new Event("production-data-changed"));
      removePendingMix(storageKey);
      setPending(null); setPendingFailed(false); setSaveError(""); setSuccess(tx("success", en));
       if (draftFingerprintRef.current === operation.fingerprint) { setRows([{ materialId: "", quantity: "" }]); setNotes(""); setNotesVisible(false); }
      await load();
    } catch (cause) {
      if (confirmedProductionRejection(cause)) {
        removePendingMix(storageKey);
        setPending(null); setPendingFailed(false); setSaveError(retryMessage(cause, en));
      } else {
         try { storePendingMix(storageKey, { ...operation, draft: { machine: currentDraftRef.current.machine, screw: currentDraftRef.current.screw || undefined, rows: currentDraftRef.current.rows.map(row => ({ ...row })), notes: currentDraftRef.current.notes, notesVisible: currentDraftRef.current.notesVisible } }); } catch { /* Keep the original persisted request if storage is unavailable. */ }
        setPendingFailed(true); setSaveError(errorMessage(cause, en));
      }
    }
    finally { setBusy(false); }
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void save(); };
  const getActor = (record: MixingRecord) => localized(record.actor_name_ar, record.actor_name, en, `#${formatWholeNumber(record.created_by)}`);
  const getMachine = (record: MixingRecord) => localized(record.machine_name_ar, record.machine_name, en, record.machine_id);
  const bilingualMaterialName = (ar?: string | null, english?: string | null) => {
    const arabic = (ar ?? "").trim() || tx("unavailable", en);
    const latinName = (english ?? "").trim() || tx("unavailable", en);
    return `${arabic} / ${latinName}`;
  };
  const latestFor = (targetScrew: Screw) => (state?.latest_mixes ?? [])
    .filter(record => record.machine_id === machine && record.screw === targetScrew)
    .sort((left, right) => right.id - left.id)[0];
  const latestA = latestFor("A"), latestB = isDualScrew(selectedMachine) ? latestFor("B") : undefined;
  const composition = (lines: CompositionLine[]) => mixingComposition(lines, bilingualMaterialName);
  const savedCombinedLines = [...(latestA?.items ?? []), ...(latestB?.items ?? [])] as CompositionLine[];
  const draftValid = Boolean(selectedMachine?.status === "active" && screw && (isDualScrew(selectedMachine) ? screw === "A" || screw === "B" : screw === "A") && selectedRows.length && selectedRows.length <= 100 &&
    selectedRows.every(row => row.material && row.material.is_active && quantityValue(row.quantity)) &&
    new Set(rows.map(row => row.materialId)).size === rows.length);
  const draftComposition = draftValid ? composition(selectedRows.map(row => ({
    material_id: row.material!.id, name: row.material!.name, name_ar: row.material!.name_ar, quantity_kg: quantityValue(row.quantity)!,
  }))) : null;
  const previewLines = draftComposition ? [
    ...(screw === "A" ? [] : (latestA?.items ?? [])),
    ...(screw === "B" ? [] : (latestB?.items ?? [])),
    ...selectedRows.map(row => ({ material_id: row.material!.id, name: row.material!.name, name_ar: row.material!.name_ar, quantity_kg: quantityValue(row.quantity)! })),
  ] as CompositionLine[] : [];
  const renderComposition = (label: string, lines: CompositionLine[], partial = false) => {
    const result = composition(lines);
    return <div className="raw-mix-composition">
      <div className="raw-mix-composition-head"><strong>{label}{partial && <span className="raw-mix-partial">{tx("partial", en)}</span>}</strong><b className="raw-ops-number">{formatNumber(result.total)} kg</b></div>
      {result.rows.length ? <div className="raw-mix-composition-lines">{result.rows.map(row => <div className="raw-mix-composition-line" key={row.key}>
        <span>{row.name}</span><b className="raw-ops-number">{formatNumber(row.kg)} kg</b><small className="raw-ops-number">{formatNumber(row.percent)}%</small>
      </div>)}</div> : <p className="raw-ops-helper">{lines.length ? tx("unavailableComposition", en) : tx("noComposition", en)}</p>}
    </div>;
  };

  return <main className="raw-ops production">
    <header className="raw-ops-header">
      <div className="raw-ops-heading"><div className="raw-ops-kicker">MPBF / {tx("machinesTitle", en)}</div><h1>{tx("title", en)}</h1><p>{tx("intro", en)}</p></div>
      <div className="raw-ops-actions">
        <button className="raw-btn quiet" type="button" onClick={() => void load()} disabled={loading}><RefreshCw />{tx("refresh", en)}</button>
        <div className="raw-ops-mark" aria-hidden="true"><i /><span>RAW<br />TRACE / 02</span></div>
      </div>
    </header>
    <Nav user={user} en={en} />
    {!allowed ? <div className="raw-ops-banner error" role="alert">{tx("permission", en)}</div> : <>
      {loadError && <div className="raw-ops-banner error" role="alert"><span>{loadError || tx("loadFail", en)}</span><button className="raw-btn quiet" onClick={() => void load()}><RefreshCw />{tx("retry", en)}</button></div>}
      {!writable && <div className="raw-ops-banner">{tx("readonly", en)}</div>}
      {negativeBalance && <div className="raw-ops-banner warning" role="status"><AlertTriangle size={17} />{tx("negative", en)}</div>}
      {(saveError || pending) && <div className="raw-ops-banner error" role="alert"><div>{pending ? <>{tx("failedRetry", en)}<div className="raw-ops-helper">{saveError || tx("recovered", en)}</div>{!writable && <div className="raw-ops-helper">{tx("retryPermission", en)}</div>}</> : saveError}</div>{pending && <button className="raw-btn" onClick={() => void save(true)} disabled={busy || !writable}><RotateCw />{busy ? tx("loading", en) : tx("retry", en)}</button>}</div>}
      {success && <div className="raw-ops-banner success" role="status">{success}</div>}
      <section className="raw-ops-card">
        <div className="raw-ops-card-head"><h2>{tx("form", en)}</h2></div>
        <div className="raw-ops-card-body">
          {writable ? <form onSubmit={onSubmit}>
            <div className="raw-ops-form-grid">
              <div className="raw-ops-field raw-ops-wide">
                <label htmlFor="mix-machine">{tx("machine", en)}</label>
                <select id="mix-machine" required value={machine} disabled={locked} onChange={event => changeMachine(event.target.value)}>
                  <option value="">{tx("chooseMachine", en)}</option>
                {machines.map(item => <option key={item.id} value={item.id}>{localized(item.name_ar, item.name, en, tx("unavailable", en))}</option>)}
                </select>
                {!machines.length && <span className="raw-ops-helper">{tx("noMachines", en)}</span>}
              </div>
              {machine && <div className="raw-ops-field raw-ops-wide">
                <label htmlFor="mix-screw">{tx("screw", en)}</label>
                {isDualScrew(selectedMachine) ? <select id="mix-screw" required value={screw} disabled={locked} onChange={event => changeScrew(event.target.value as Screw | "")}>
                  <option value="">{tx("chooseScrew", en)}</option><option value="A">{tx("screwA", en)}</option><option value="B">{tx("screwB", en)}</option>
                </select> : <div className="raw-mix-single-screw" aria-label={tx("screwA", en)}>{tx("screwA", en)}</div>}
              </div>}
              <div className="raw-ops-wide raw-ops-items">
                {rows.map((row, index) => <div className="raw-ops-item" key={index}>
                  <div className="raw-ops-field">
                    <label htmlFor={`mix-material-${index}`}>{tx("material", en)}</label>
                    <select id={`mix-material-${index}`} required value={row.materialId} disabled={locked} onChange={event => updateRow(index, { materialId: event.target.value })}>
                      <option value="">{tx("chooseMaterial", en)}</option>
                      {(state?.materials ?? []).filter(material => material.is_active && (!rows.some((other, otherIndex) => otherIndex !== index && other.materialId === String(material.id)) || row.materialId === String(material.id))).map(material => <option key={material.id} value={material.id}>{bilingualMaterialName(material.name_ar, material.name)}</option>)}
                    </select>
                  </div>
                  <div className="raw-ops-field">
                    <label htmlFor={`mix-quantity-${index}`}>{tx("weight", en)}</label>
                    <input id={`mix-quantity-${index}`} required inputMode="decimal" autoComplete="off" maxLength={15} value={row.quantity} disabled={locked} onChange={event => updateRow(index, { quantity: event.target.value })} placeholder="0.00" />
                  </div>
                  <button className="raw-btn quiet raw-ops-remove" type="button" aria-label={tx("remove", en)} onClick={() => removeRow(index)} disabled={locked || rows.length < 2}><Trash2 />{tx("remove", en)}</button>
                </div>)}
                {state && !state.materials.some(material => material.is_active) && <div className="raw-ops-empty"><strong>{tx("noMaterials", en)}</strong></div>}
              </div>
              <div className="raw-ops-wide raw-mix-note-area" id="mix-notes-region">
                {notesVisible && <>
                  <div className="raw-mix-note-head"><label htmlFor="mix-notes">{tx("notes", en)}</label><button className="raw-btn quiet" type="button" aria-expanded="true" aria-controls="mix-notes-region" onClick={() => setNotesVisible(false)} disabled={locked}><EyeOff />{tx("hideNote", en)}</button></div>
                  <textarea id="mix-notes" maxLength={2000} value={notes} disabled={locked} onChange={event => setNotes(event.target.value)} />
                </>}
              </div>
            </div>
            {draftComposition && <div className="raw-mix-live-preview">
              <div className="raw-mix-preview-label">{tx("unsavedPreview", en)}</div>
              {renderComposition(`${tx("screw", en)} ${screw}`, selectedRows.map(row => ({ material_id: row.material!.id, name: row.material!.name, name_ar: row.material!.name_ar, quantity_kg: quantityValue(row.quantity)! })))}
              {renderComposition(tx("combined", en), previewLines, Boolean(isDualScrew(selectedMachine) && !(screw === "A" ? latestB : latestA)))}
            </div>}
            <div className="raw-ops-form-actions raw-mix-primary-actions">
              <button className="raw-btn outline" type="button" onClick={addRow} disabled={locked || rows.length >= 100}><Plus />{tx("addLine", en)}</button>
              <button className="raw-btn outline" type="button" aria-expanded={notesVisible} aria-controls="mix-notes-region" onClick={() => setNotesVisible(value => !value)} disabled={locked}><Plus />{tx(notesVisible ? "hideNote" : "addNote", en)}</button>
              <button className="raw-btn" type="submit" disabled={busy || locked || !machines.length || !state?.materials.some(material => material.is_active)}><Plus />{busy ? tx("loading", en) : tx("save", en)}</button>
              <span className="raw-ops-helper">{tx("notVoucher", en)}</span>
            </div>
          </form> : <div className="raw-ops-helper">{tx("readonly", en)}</div>}
        </div>
      </section>
      {canViewSavedMixingComposition(user) && <section className="raw-ops-card raw-mix-summary-card">
        <div className="raw-ops-card-head"><h2>{tx("savedComposition", en)}</h2></div>
        <div className="raw-ops-card-body">
          {!writable && <div className="raw-ops-field raw-mix-reader-machine">
            <label htmlFor="mix-read-machine">{tx("machine", en)}</label>
            <select id="mix-read-machine" value={machine} onChange={event => changeMachine(event.target.value)}>
              <option value="">{tx("chooseMachine", en)}</option>
              {machines.map(item => <option key={item.id} value={item.id}>{localized(item.name_ar, item.name, en, tx("unavailable", en))}</option>)}
            </select>
          </div>}
          {!machine ? <div className="raw-ops-empty"><strong>{tx("chooseMachine", en)}</strong></div> :
            !latestA && !latestB ? <div className="raw-ops-empty"><strong>{tx("noComposition", en)}</strong></div> : <>
              <div className="raw-mix-saved-grid">
                {latestA ? renderComposition(tx("screwA", en), latestA.items) : <div className="raw-mix-missing"><strong>{tx("screwA", en)}</strong><span>{tx("noScrewMix", en)}</span></div>}
                {isDualScrew(selectedMachine) && (latestB ? renderComposition(tx("screwB", en), latestB.items) : <div className="raw-mix-missing"><strong>{tx("screwB", en)}</strong><span>{tx("noScrewMix", en)}</span></div>)}
              </div>
              {renderComposition(tx("combined", en), savedCombinedLines, Boolean(isDualScrew(selectedMachine) && (!latestA || !latestB)))}
            </>}
        </div>
      </section>}
      <section className="raw-ops-card">
        <div className="raw-ops-card-head"><h2>{tx("history", en)}</h2><span className="raw-ops-helper">{state ? `${formatWholeNumber(state.records.length)} ${en ? "records" : "سجل"}` : ""}</span></div>
        <div className="raw-ops-card-body">
          {loading && !state ? <LoadingRows label={tx("loading", en)} /> : state?.records.length ? <>
            {state.records.map(record => <article className="raw-ops-record" key={record.id}>
              <div className="raw-ops-record-head">
                <div><div className="raw-ops-record-machine">{getMachine(record)} · {((record as MixingRecord & { screw?: Screw | null }).screw === "A" ? tx("screwA", en) : (record as MixingRecord & { screw?: Screw | null }).screw === "B" ? tx("screwB", en) : tx("legacyScrew", en))}</div><div className="raw-ops-record-meta"><span>{tx("actor", en)}: {getActor(record)}</span><time dateTime={record.created_at}>{tx("date", en)}: {dateTime(record.created_at, en)}</time><span className="raw-ops-number">#{record.id}</span></div></div>
                <div className="raw-ops-record-total">{tx("total", en)}: {formatNumber(record.total_kg)} kg</div>
              </div>
              <div className="raw-ops-record-lines">{record.items.map((item, index) => <div className="raw-ops-material-chip" key={`${item.material_id}-${index}`}><span>{bilingualMaterialName(item.name_ar, item.name)}</span><b className="raw-ops-number">{formatNumber(item.quantity_kg)} kg</b></div>)}</div>
              {record.notes && <p className="raw-ops-record-notes">{tx("comments", en)}: {record.notes}</p>}
            </article>)}
            {state.next_before ? <div className="raw-ops-form-actions"><button className="raw-btn outline" onClick={() => void load(state.next_before ?? undefined)} disabled={olderLoading}><ChevronDown />{olderLoading ? tx("loading", en) : tx("more", en)}</button></div> : <p className="raw-ops-helper">{tx("noMore", en)}</p>}
          </> : <div className="raw-ops-empty"><strong>{tx("noHistory", en)}</strong><span>{tx("notVoucher", en)}</span></div>}
        </div>
      </section>
    </>}
  </main>;
}
