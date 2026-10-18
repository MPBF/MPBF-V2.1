import { AlertCircle, ChevronDown, ChevronUp, Clock3, History, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { canManageMixing, formatMixNumber, type MixRevision, type MixRevisionSnapshot } from "../../../../shared/raw-mixing";
import type { ProductionUser } from "../../../../shared/production";
import { formatNumber } from "../../lib/format-number";
import { rawMixingApi } from "../../lib/raw-mixing-api";

import "./mix-revision-history.css";

type Props = {
  user: ProductionUser;
  en: boolean;
  mixId?: number;
  refreshToken?: number;
};

const labels = {
  title: ["تاريخ التصحيحات", "Correction history"],
  audit: ["MPBF / سجل التدقيق", "MPBF / AUDIT"],
  view: ["عرض التصحيحات", "View corrections"],
  hide: ["إخفاء التصحيحات", "Hide corrections"],
  edit: ["تصحيح", "Edited"],
  delete: ["إلغاء الخلطة", "Mix cancelled"],
  before: ["قبل التصحيح", "Before correction"],
  after: ["بعد التصحيح", "After correction"],
  machine: ["الماكينة", "Machine"],
  screw: ["اللولب", "Screw"],
  notes: ["الملاحظات", "Notes"],
  noNotes: ["لا توجد ملاحظات", "No notes"],
  materials: ["المواد والكميات المحفوظة", "Saved materials & quantities"],
  total: ["الإجمالي", "Total"],
  actor: ["نفّذ التصحيح", "Changed by"],
  time: ["وقت الحفظ", "Saved at"],
  stock: ["تغيّر المخزون", "Stock adjustment"],
  noStockChange: ["لم يتغير رصيد الخام في هذا التصحيح.", "No raw stock changed in this revision."],
  stockIn: ["إضافة إلى رصيد الخام", "Added to raw stock"],
  stockOut: ["خصم من رصيد الخام", "Deducted from raw stock"],
  noMaterialsAfterCancellation: ["لا توجد مواد بعد الإلغاء.", "No materials after cancellation."],
  refresh: ["تحديث السجل", "Refresh history"],
  balance: ["الرصيد بعد الحفظ", "Saved balance"],
  catalogNote: ["الأسماء من دليل المواد الحالي؛ الأوزان من سجل التصحيح المحفوظ.", "Names reflect the current catalog; weights are from the saved revision."],
  loading: ["جارٍ تحميل تاريخ التصحيحات", "Loading correction history"],
  retry: ["إعادة المحاولة", "Retry"],
  more: ["تحميل الأقدم", "Load older"],
  empty: ["لا توجد تصحيحات مسجلة لهذه الخلطة.", "No corrections recorded for this mix."],
  emptyGlobal: ["لا توجد تصحيحات مسجلة حتى الآن.", "No corrections recorded yet."],
  end: ["وصلت إلى أقدم التصحيحات.", "You’re viewing the oldest corrections."],
  unavailable: ["غير متاح", "Unavailable"],
  machineChange: ["تغيير الماكينة", "Machine changed"],
  screwChange: ["تغيير اللولب", "Screw changed"],
  notesChange: ["تغيير الملاحظات", "Notes changed"],
  cancelled: ["أُلغيت الخلطة وأُعيدت المواد إلى المخزون.", "Mix cancelled and materials returned to stock."],
};

const text = (key: keyof typeof labels, en: boolean) => labels[key][en ? 1 : 0];
const safeName = (arabic: string | null | undefined, english: string | null | undefined, en: boolean, fallback: string) => {
  const ar = (arabic ?? "").trim();
  const latin = (english ?? "").trim();
  const validEnglish = /[\u0600-\u06ff]/.test(latin) ? "" : latin;
  return (en ? validEnglish : ar) || fallback;
};
const dateTime = (raw: string, en: boolean) => {
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
    }).format(date);
};
const screwLabel = (value: string | null, en: boolean) => {
  if (!value) return "—";
  const normalized = value.toUpperCase();
  return normalized === "A" ? `${text("screw", en)} A` : normalized === "B" ? `${text("screw", en)} B` : value;
};
const machineLabel = (snapshot: MixRevisionSnapshot, en: boolean) =>
  safeName(snapshot.machine_name_ar, snapshot.machine_name, en, snapshot.machine_id || text("unavailable", en));
const materialLabel = (item: MixRevisionSnapshot["items"][number], en: boolean) =>
  safeName(item.name_ar, item.name, en, `#${item.material_id}`);
const actorLabel = (revision: MixRevision, en: boolean) =>
  safeName(revision.actor_name_ar, revision.actor_name, en, `#${revision.created_by}`);

function Snapshot({ snapshot, en, label, cancelled = false }: { snapshot: MixRevisionSnapshot; en: boolean; label: string; cancelled?: boolean }) {
  return <section className="mix-revision-snapshot" aria-label={label}>
    <h4>{label}</h4>
    <dl className="mix-revision-facts">
      <div><dt>{text("machine", en)}</dt><dd>{machineLabel(snapshot, en)}</dd></div>
      <div><dt>{text("screw", en)}</dt><dd>{screwLabel(snapshot.screw, en)}</dd></div>
      {!cancelled && <div><dt>{text("total", en)}</dt><dd className="mix-revision-number">{formatNumber(snapshot.total_kg)} kg</dd></div>}
    </dl>
    <div className="mix-revision-materials">
      {snapshot.items.map((item, index) => <div className="mix-revision-material" key={`${item.material_id}-${index}`}>
        <span>{materialLabel(item, en)}</span>
        <b className="mix-revision-number">{formatNumber(item.quantity_kg)} kg</b>
      </div>)}
      {!snapshot.items.length && <p className="mix-revision-muted">{cancelled ? text("noMaterialsAfterCancellation", en) : "—"}</p>}
    </div>
    <p className="mix-revision-note"><strong>{text("notes", en)}:</strong> {snapshot.notes?.trim() || text("noNotes", en)}</p>
  </section>;
}

function RevisionCard({ revision, en }: { revision: MixRevision; en: boolean }) {
  const machineChanged = revision.before_data.machine_id !== revision.after_data.machine_id;
  const screwChanged = revision.before_data.screw !== revision.after_data.screw;
  const notesChanged = (revision.before_data.notes ?? "") !== (revision.after_data.notes ?? "");
  return <article className={`mix-revision-entry ${revision.action === "delete" ? "is-cancelled" : ""}`}>
    <header className="mix-revision-entry-head">
      <div className="mix-revision-entry-title">
        <span className={`mix-revision-action ${revision.action === "delete" ? "cancelled" : ""}`}>{revision.action === "delete" ? text("delete", en) : text("edit", en)}</span>
        <bdi className="mix-revision-number">{formatMixNumber(revision.mix_id)}</bdi>
        <span className="mix-revision-revision">r{revision.revision}</span>
      </div>
      <div className="mix-revision-entry-meta">
        <span><strong>{text("actor", en)}:</strong> {actorLabel(revision, en)}</span>
        <time dateTime={revision.created_at}><Clock3 aria-hidden="true" />{dateTime(revision.created_at, en)}</time>
      </div>
    </header>
    {revision.action === "delete" && <p className="mix-revision-cancel-note">{text("cancelled", en)}</p>}
    {(machineChanged || screwChanged || notesChanged) && <div className="mix-revision-diffs" aria-label={en ? "Changed fields" : "الحقول التي تغيرت"}>
      {machineChanged && <span>{text("machineChange", en)}: {machineLabel(revision.before_data, en)} → {machineLabel(revision.after_data, en)}</span>}
      {screwChanged && <span>{text("screwChange", en)}: {screwLabel(revision.before_data.screw, en)} → {screwLabel(revision.after_data.screw, en)}</span>}
      {notesChanged && <span>{text("notesChange", en)}</span>}
    </div>}
    <div className="mix-revision-snapshots">
      <Snapshot snapshot={revision.before_data} en={en} label={text("before", en)} />
      <Snapshot snapshot={revision.after_data} en={en} label={text("after", en)} cancelled={revision.action === "delete"} />
    </div>
    {!!revision.stock_adjustments.length && <section className="mix-revision-stock">
      <h4>{text("stock", en)}</h4>
      <div className="mix-revision-stock-list">
        {revision.stock_adjustments.map((item, index) => {
          const delta = Number(item.quantity_kg);
          const positive = Number.isFinite(delta) && delta > 0;
          const negative = Number.isFinite(delta) && delta < 0;
          const amount = formatNumber(item.quantity_kg);
          return <div className="mix-revision-stock-row" key={`${item.material_id}-${index}`}>
            <span>{safeName(item.name_ar, item.name, en, `#${item.material_id}`)} <small>({item.code || `#${item.material_id}`})</small></span>
            <span><b className={`mix-revision-number ${positive ? "delta-in" : negative ? "delta-out" : ""}`}>
              {positive ? "+" : ""}{amount} kg
            </b><small> {text(positive ? "stockIn" : "stockOut", en)}</small></span>
            <small>{text("balance", en)}: <b className="mix-revision-number">{formatNumber(item.balance_after_kg)} kg</b></small>
          </div>;
        })}
      </div>
    </section>}
    {!revision.stock_adjustments.length && <p className="mix-revision-muted">{text("noStockChange", en)}</p>}
  </article>;
}

export default function MixRevisionHistory({ user, en, mixId, refreshToken = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<MixRevision[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const seenRefresh = useRef(refreshToken);
  const allowed = canManageMixing(user);

  const load = useCallback(async (before?: string, reset = false) => {
    if (!allowed) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const page = await rawMixingApi.revisions(mixId, before);
      if (version !== requestVersion.current) return;
      setRecords(current => reset ? page.records : [...current, ...page.records.filter(item => !current.some(old => old.mix_id === item.mix_id && old.revision === item.revision))]);
      setNextBefore(page.next_before);
    } catch (cause) {
      if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : text("unavailable", en));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [allowed, en, mixId]);

  const toggle = () => {
    if (!allowed) return;
    const next = !open;
    setOpen(next);
    if (next) void load(undefined, true);
    else requestVersion.current++;
  };

  useEffect(() => {
    if (seenRefresh.current === refreshToken) return;
    seenRefresh.current = refreshToken;
    if (open) void load(undefined, true);
  }, [refreshToken, open, load]);

  if (!allowed) return null;
  return <div className={`mix-revisions ${mixId === undefined ? "mix-revisions-global" : ""} ${open ? "is-open" : ""}`} dir={en ? "ltr" : "rtl"}>
    <button className={`mix-revisions-trigger ${mixId === undefined ? "global" : ""}`} type="button" onClick={toggle} aria-expanded={open}>
      <History aria-hidden="true" />
      <span>{text(open ? "hide" : "view", en)}{mixId === undefined && !open ? ` · ${text("title", en)}` : ""}</span>
      {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </button>
    {open && <section className="mix-revisions-panel" aria-label={text("title", en)} aria-live="polite">
      <div className="mix-revisions-panel-head">
        <div><span className="mix-revisions-overline">{text("audit", en)}</span><h3>{text("title", en)}{mixId !== undefined && <bdi className="mix-revision-number"> · {formatMixNumber(mixId)}</bdi>}</h3></div>
        <button className="mix-revisions-icon-button" type="button" onClick={() => void load(undefined, true)} disabled={loading} aria-label={text("refresh", en)} title={text("refresh", en)}><RefreshCw aria-hidden="true" /></button>
      </div>
      <p className="mix-revisions-catalog-note">{text("catalogNote", en)}</p>
      {error && <div className="mix-revisions-error" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load(undefined, true)} disabled={loading}>{text("retry", en)}</button></div>}
      {loading && records.length === 0 && <div className="mix-revisions-skeleton" role="status" aria-label={text("loading", en)}><i /><i /></div>}
      {!loading && !error && records.length === 0 && <div className="mix-revisions-empty"><History aria-hidden="true" /><strong>{text(mixId === undefined ? "emptyGlobal" : "empty", en)}</strong></div>}
      {records.map(revision => <RevisionCard key={`${revision.mix_id}-${revision.revision}`} revision={revision} en={en} />)}
      {records.length > 0 && <div className="mix-revisions-pagination">
        {nextBefore ? <button className="mix-revisions-more" type="button" onClick={() => void load(nextBefore)} disabled={loading}>{loading ? text("loading", en) : text("more", en)}</button> : <span>{text("end", en)}</span>}
      </div>}
    </section>}
  </div>;
}
