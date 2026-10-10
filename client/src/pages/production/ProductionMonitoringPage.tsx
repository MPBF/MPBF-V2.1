import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { ProductionStage, ProductionUser } from "../../../../shared/production";
import {
  canMonitorProduction,
  type MixMonitorDetail,
  type MixMonitorRecord,
  type MonitoringPage,
  type MonitoringSummary,
  type ProductionEvent,
  type RollMixDetail,
} from "../../../../shared/production-monitoring";
import { availableProductionViews } from "../../lib/production-navigation";
import { monitoringApi } from "../../lib/production-monitoring-api";
import { formatNumber } from "../../lib/format-number";
import "./production.css";
import "./raw-operations.css";
import "./production-monitoring.css";

export type ProductionMonitoringPageProps = { user: ProductionUser };

type Section = "log" | "mixes";
type DetailState<T> = { data: T | null; cursor: string | undefined; previous: string[]; loading: boolean; error: string };
type PageState<T> = { data: MonitoringPage<T> | null; cursor: string | undefined; previous: string[]; loading: boolean; error: string };

const PAGE_SIZE = 20;
const stages: ProductionStage[] = ["film", "printing", "cutting"];
type ProductionMachineOption = { machine_id: string; machine_name: string | null; machine_name_ar: string | null };

const copy: Record<string, [string, string]> = {
  title: ["مراقبة الإنتاج", "Production monitoring"],
  intro: ["سجل تشغيلي لللفات والخلطات المسجلة — دون افتراض قياس جرعات اللولب الفعلية.", "Operational records of registered rolls and mixes — without implying physical screw-dose measurement."],
  log: ["سجل الإنتاج", "Production log"],
  mixes: ["مراقبة الخلط", "Mix monitoring"],
  refresh: ["تحديث", "Refresh"],
  loading: ["جارٍ التحميل…", "Loading…"],
  retry: ["إعادة المحاولة", "Retry"],
  permission: ["هذه الصفحة متاحة للمسؤولين فقط.", "This page is available to administrators only."],
  logError: ["تعذر تحميل سجل الإنتاج.", "Production log could not be loaded."],
  summaryError: ["تعذر تحميل ملخص الخلط.", "Mix summary could not be loaded."],
  mixError: ["تعذر تحميل سجل الخلطات.", "Mix history could not be loaded."],
  detailError: ["تعذر تحميل تفاصيل التخصيص.", "Allocation details could not be loaded."],
  noLog: ["لا توجد عمليات إنتاج مطابقة.", "No production events match these filters."],
  noMixes: ["لا توجد خلطات مسجلة لهذه الماكينة.", "No mixes are recorded for this machine."],
  stage: ["المرحلة", "Stage"],
  allStages: ["كل المراحل", "All stages"],
  printing: ["الطباعة", "Printing"],
  cutting: ["القص", "Cutting"],
  machine: ["الماكينة", "Machine"],
  allMachines: ["كل الماكينات", "All machines"],
  from: ["من تاريخ", "From date"],
  to: ["إلى تاريخ", "To date"],
  search: ["بحث برقم اللفة أو الطلب", "Search roll or order"],
  date: ["وقت التسجيل", "Registered"],
  actor: ["المسجل", "Recorded by"],
  roll: ["اللفة", "Roll"],
  order: ["الطلب", "Customer order"],
  productionOrder: ["أمر الإنتاج", "Production order"],
  weights: ["الأوزان", "Weights"],
  gross: ["إجمالي الفيلم", "Film gross"],
  net: ["الصافي بعد القص", "Cutting net"],
  waste: ["هالك القص", "Cutting waste"],
  detail: ["تفاصيل الخلطات المرتبطة", "Linked mix detail"],
  expandRoll: ["عرض مصادر الخلط", "Show mix sources"],
  collapse: ["إخفاء التفاصيل", "Hide details"],
  allocations: ["تخصيصات مسجلة", "Recorded allocations"],
  allocated: ["المخصص", "Allocated"],
  mixTime: ["وقت الخلطة", "Mix time"],
  screw: ["اللولب المسجل", "Recorded screw"],
  screwA: ["A", "A"],
  screwB: ["B", "B"],
  screwUnknown: ["غير محدد", "Unspecified"],
  unavailable: ["غير متاح", "Unavailable"],
  tracked: ["ضمن التتبع", "Tracked"],
  untracked: ["قبل بدء التتبع", "Before tracking"],
  untrackedExplain: ["هذه الخلطة سابقة لتفعيل التتبع؛ الرصيد المتبقي غير متاح ولا يُعامل كمخزون.", "This mix predates tracking activation; remaining balance is unavailable and is not treated as stock."],
  untrackedRoll: ["قبل بدء التتبع: هذا الرول سابق لتفعيل المحاسبة؛ لم تُنشأ له تخصيصات أو كمية غير مغطاة بأثر رجعي.", "Before tracking: this roll predates accounting activation. No historical allocations or uncovered quantity were reconstructed."],
  activation: ["بدء التتبع", "Tracking activated"],
  activationExplain: ["يبدأ التتبع من هذا التاريخ للخلطات الجديدة فقط. التخصيص على مستوى الماكينة FIFO؛ لا تُفترض نسب A/B، والخلطات اللاحقة لا تغطي عجزاً سابقاً.", "Tracking applies to new mixes only from this date. Allocation is machine-wide FIFO; no A/B ratios are assumed, and later mixes do not cover earlier deficits."],
  lifetime: ["أرصدة الماكينات منذ التفعيل", "Machine balances since activation"],
  mixed: ["إجمالي الخلط", "Mixed"],
  consumed: ["مستهلك", "Consumed"],
  remaining: ["متبقٍ", "Remaining"],
  film: ["الفيلم", "Film"],
  uncovered: ["غير مغطى", "Uncovered"],
  history: ["سجل الخلطات", "Mix history"],
  total: ["إجمالي الخلطة", "Mix total"],
  name: ["الماكينة", "Machine"],
  notes: ["ملاحظات", "Notes"],
  linkedRolls: ["اللفات المرتبطة", "Linked rolls"],
  expandMix: ["عرض اللفات المخصصة", "Show allocated rolls"],
  noAllocations: ["لا توجد تخصيصات مسجلة.", "No allocations recorded."],
  previous: ["السابق", "Previous"],
  next: ["التالي", "Next"],
  page: ["صفحة", "Page"],
  portion: ["غير مغطى", "Uncovered portion"],
  screwNote: ["بيانات اللولب توثّق القيمة المسجلة فقط، وليست قياساً لجرعة فعلية.", "Screw metadata reflects the recorded value only, not a measurement of physical dosing."],
};

const tr = (key: string, en: boolean) => copy[key]?.[en ? 1 : 0] ?? key;
const localized = (ar: string | null | undefined, english: string | null | undefined, en: boolean, fallback: string) => {
  const a = (ar ?? "").trim();
  const e = (english ?? "").trim();
  const safeEnglish = /[\u0600-\u06ff]/.test(e) ? "" : e;
  return en ? safeEnglish || fallback : a || safeEnglish || fallback;
};
const cleanCursor = (cursor?: string) => cursor || undefined;
const stamp = (value: string | null | undefined, en: boolean) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
    }).format(date);
};
const kg = (value: string | number | null | undefined) => value == null ? "—" : `${formatNumber(Number(value))} kg`;
const getError = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;

function Pager({ next, previous, loading, onNext, onPrevious, page, en }: {
  next: boolean; previous: boolean; loading: boolean; onNext: () => void; onPrevious: () => void; page: number; en: boolean;
}) {
  return <div className="pm-pager">
    <button className="raw-btn quiet" type="button" onClick={onPrevious} disabled={!previous || loading}>
      {en ? <ChevronLeft /> : <ChevronRight />}{tr("previous", en)}
    </button>
    <span>{tr("page", en)} <b className="raw-ops-number">{formatNumber(page)}</b></span>
    <button className="raw-btn quiet" type="button" onClick={onNext} disabled={!next || loading}>
      {tr("next", en)}{en ? <ChevronRight /> : <ChevronLeft />}
    </button>
  </div>;
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="raw-ops-skeleton pm-skeleton" aria-label={label}><i /><i /><i /></div>;
}

export default function ProductionMonitoringPage({ user }: ProductionMonitoringPageProps) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const permitted = canMonitorProduction(user);
  const [section, setSection] = useState<Section>("log");
  const [stage, setStage] = useState("");
  const [logMachine, setLogMachine] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [mixMachine, setMixMachine] = useState("");
  const [logPage, setLogPage] = useState<PageState<ProductionEvent>>({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
  const [mixPage, setMixPage] = useState<PageState<MixMonitorRecord>>({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [openRoll, setOpenRoll] = useState<{ eventKey: string; rollId: number } | null>(null);
  const [rollDetails, setRollDetails] = useState<Record<number, DetailState<RollMixDetail>>>({});
  const [openMix, setOpenMix] = useState<number | null>(null);
  const [mixDetails, setMixDetails] = useState<Record<number, DetailState<MixMonitorDetail>>>({});
  const generation = useRef(0);
  const requestSeq = useRef({ log: 0, mixes: 0, summary: 0, roll: {} as Record<number, number>, mix: {} as Record<number, number> });
  const busy = useRef({ log: false, mixes: false, summary: false, roll: {} as Record<number, boolean>, mix: {} as Record<number, boolean> });
  const refreshLatest = useRef<() => void>(() => {});
  const permittedRef = useRef(permitted);
  permittedRef.current = permitted;

  const loadLog = useCallback(async (cursor?: string, previous: string[] = []) => {
    if (!permittedRef.current) return;
    const requestGeneration = generation.current;
    const requestId = ++requestSeq.current.log;
    const normalizedCursor = cleanCursor(cursor);
    busy.current.log = true;
    setLogPage(old => ({ ...old, loading: true, error: "" }));
    try {
      const result = await monitoringApi.log({
        cursor: normalizedCursor, limit: PAGE_SIZE, stage: stage ? stage as ProductionStage : undefined,
        machine_id: logMachine || undefined, from: from || undefined, to: to || undefined, search: search.trim() || undefined,
      });
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.log || !permittedRef.current) return;
      setLogPage({ data: result, cursor: normalizedCursor, previous, loading: false, error: "" });
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.log || !permittedRef.current) return;
      setLogPage(old => ({ ...old, loading: false, error: getError(cause, tr("logError", en)) }));
    } finally {
      if (requestId === requestSeq.current.log) busy.current.log = false;
    }
  }, [stage, logMachine, from, to, search, en]);

  const loadMixes = useCallback(async (cursor?: string, previous: string[] = []) => {
    if (!permittedRef.current) return;
    const requestGeneration = generation.current;
    const requestId = ++requestSeq.current.mixes;
    const normalizedCursor = cleanCursor(cursor);
    busy.current.mixes = true;
    setMixPage(old => ({ ...old, loading: true, error: "" }));
    try {
      const result = await monitoringApi.mixes({ cursor: normalizedCursor, limit: PAGE_SIZE, machine_id: mixMachine || undefined });
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mixes || !permittedRef.current) return;
      setMixPage({ data: result, cursor: normalizedCursor, previous, loading: false, error: "" });
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mixes || !permittedRef.current) return;
      setMixPage(old => ({ ...old, loading: false, error: getError(cause, tr("mixError", en)) }));
    } finally {
      if (requestId === requestSeq.current.mixes) busy.current.mixes = false;
    }
  }, [mixMachine, en]);

  const loadSummary = useCallback(async () => {
    if (!permittedRef.current || busy.current.summary) return;
    const requestGeneration = generation.current;
    const requestId = ++requestSeq.current.summary;
    busy.current.summary = true;
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const result = await monitoringApi.summary();
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.summary || !permittedRef.current) return;
      setSummary(result);
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.summary || !permittedRef.current) return;
      setSummaryError(getError(cause, tr("summaryError", en)));
    } finally {
      if (requestGeneration === generation.current && requestId === requestSeq.current.summary && permittedRef.current) {
        busy.current.summary = false;
        setSummaryLoading(false);
      }
    }
  }, [en]);

  const resetDetails = useCallback(() => {
    setOpenRoll(null); setRollDetails({});
    setOpenMix(null); setMixDetails({});
  }, []);

  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      requestSeq.current.log++;
      requestSeq.current.mixes++;
      requestSeq.current.summary++;
      requestSeq.current.roll = {};
      requestSeq.current.mix = {};
      busy.current = { log: false, mixes: false, summary: false, roll: {}, mix: {} };
    };
    invalidate();
    if (!permitted) {
      setLogPage({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
      setMixPage({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
      setSummary(null); setSummaryLoading(false); setSummaryError("");
      resetDetails();
    } else {
      resetDetails();
      setLogPage({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
      setMixPage({ data: null, cursor: undefined, previous: [], loading: false, error: "" });
      setSummary(null);
      setSummaryError("");
    }
    return invalidate;
  }, [permitted, user.id, resetDetails]);

  useEffect(() => {
    if (permitted) void loadSummary();
  }, [permitted, user.id, loadSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!permitted) return;
    setLogPage(old => ({ ...old, cursor: undefined, previous: [], data: null }));
    void loadLog(undefined, []);
  }, [stage, logMachine, from, to, search, permitted, user.id, loadLog]); // Filter changes start a fresh bounded archive page.

  useEffect(() => {
    if (!permitted) return;
    setMixPage(old => ({ ...old, cursor: undefined, previous: [], data: null }));
    void loadMixes(undefined, []);
  }, [mixMachine, permitted, user.id, loadMixes]);

  const openRollDetail = async (eventKey: string, id: number) => {
    if (!permittedRef.current) return;
    if (openRoll?.eventKey === eventKey) { setOpenRoll(null); return; }
    setOpenRoll({ eventKey, rollId: id });
    const existing = rollDetails[id];
    if (existing?.data || existing?.loading) return;
    const requestGeneration = generation.current;
    const requestId = requestSeq.current.roll[id] = (requestSeq.current.roll[id] ?? 0) + 1;
    busy.current.roll[id] = true;
    setRollDetails(old => ({ ...old, [id]: { data: null, cursor: undefined, previous: [], loading: true, error: "" } }));
    try {
      const result = await monitoringApi.roll(id);
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.roll[id] || !permittedRef.current) return;
      setRollDetails(old => ({ ...old, [id]: { data: result, cursor: undefined, previous: [], loading: false, error: "" } }));
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.roll[id] || !permittedRef.current) return;
      setRollDetails(old => ({ ...old, [id]: { data: null, cursor: undefined, previous: [], loading: false, error: getError(cause, tr("detailError", en)) } }));
    } finally {
      if (requestId === requestSeq.current.roll[id]) busy.current.roll[id] = false;
    }
  };

  const loadRollPage = async (id: number, cursor?: string, previous: string[] = []) => {
    if (!permittedRef.current) return;
    const normalizedCursor = cleanCursor(cursor);
    const requestId = requestSeq.current.roll[id] = (requestSeq.current.roll[id] ?? 0) + 1;
    busy.current.roll[id] = true;
    setRollDetails(old => ({ ...old, [id]: { ...(old[id] ?? { data: null, previous: [] }), cursor: normalizedCursor, previous, loading: true, error: "" } }));
    const requestGeneration = generation.current;
    try {
      const result = await monitoringApi.roll(id, normalizedCursor);
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.roll[id] || !permittedRef.current) return;
      setRollDetails(old => ({ ...old, [id]: { data: result, cursor: normalizedCursor, previous, loading: false, error: "" } }));
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.roll[id] || !permittedRef.current) return;
      setRollDetails(old => ({ ...old, [id]: { ...(old[id] ?? { data: null, previous: [] }), cursor: normalizedCursor, previous, loading: false, error: getError(cause, tr("detailError", en)) } }));
    } finally {
      if (requestId === requestSeq.current.roll[id]) busy.current.roll[id] = false;
    }
  };

  const openMixDetail = async (id: number) => {
    if (!permittedRef.current) return;
    if (openMix === id) { setOpenMix(null); return; }
    setOpenMix(id);
    const existing = mixDetails[id];
    if (existing?.data || existing?.loading) return;
    const requestGeneration = generation.current;
    const requestId = requestSeq.current.mix[id] = (requestSeq.current.mix[id] ?? 0) + 1;
    busy.current.mix[id] = true;
    setMixDetails(old => ({ ...old, [id]: { data: null, cursor: undefined, previous: [], loading: true, error: "" } }));
    try {
      const result = await monitoringApi.mix(id);
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mix[id] || !permittedRef.current) return;
      setMixDetails(old => ({ ...old, [id]: { data: result, cursor: undefined, previous: [], loading: false, error: "" } }));
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mix[id] || !permittedRef.current) return;
      setMixDetails(old => ({ ...old, [id]: { data: null, cursor: undefined, previous: [], loading: false, error: getError(cause, tr("detailError", en)) } }));
    } finally {
      if (requestId === requestSeq.current.mix[id]) busy.current.mix[id] = false;
    }
  };

  const loadMixDetailPage = async (id: number, cursor?: string, previous: string[] = []) => {
    if (!permittedRef.current) return;
    const normalizedCursor = cleanCursor(cursor);
    const requestId = requestSeq.current.mix[id] = (requestSeq.current.mix[id] ?? 0) + 1;
    busy.current.mix[id] = true;
    setMixDetails(old => ({ ...old, [id]: { ...(old[id] ?? { data: null, previous: [] }), cursor: normalizedCursor, previous, loading: true, error: "" } }));
    const requestGeneration = generation.current;
    try {
      const result = await monitoringApi.mix(id, normalizedCursor);
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mix[id] || !permittedRef.current) return;
      setMixDetails(old => ({ ...old, [id]: { data: result, cursor: normalizedCursor, previous, loading: false, error: "" } }));
    } catch (cause) {
      if (requestGeneration !== generation.current || requestId !== requestSeq.current.mix[id] || !permittedRef.current) return;
      setMixDetails(old => ({ ...old, [id]: { ...(old[id] ?? { data: null, previous: [] }), cursor: normalizedCursor, previous, loading: false, error: getError(cause, tr("detailError", en)) } }));
    } finally {
      if (requestId === requestSeq.current.mix[id]) busy.current.mix[id] = false;
    }
  };

  const refreshVisible = () => {
    if (!permittedRef.current) return;
    if (!busy.current.summary) void loadSummary();
    if (section === "log") {
      if (!busy.current.log) void loadLog(logPage.cursor, logPage.previous);
      const id = openRoll?.rollId;
      if (id !== undefined && !busy.current.roll[id]) void loadRollPage(id, rollDetails[id]?.cursor, rollDetails[id]?.previous ?? []);
      setRollDetails(old => openRoll ? { [openRoll.rollId]: old[openRoll.rollId] } : {});
      setMixDetails({});
    } else {
      if (!busy.current.mixes) void loadMixes(mixPage.cursor, mixPage.previous);
      if (openMix !== null && !busy.current.mix[openMix]) void loadMixDetailPage(openMix, mixDetails[openMix]?.cursor, mixDetails[openMix]?.previous ?? []);
      setMixDetails(old => openMix !== null ? { [openMix]: old[openMix] } : {});
      setRollDetails({});
    }
  };
  refreshLatest.current = refreshVisible;

  useEffect(() => {
    if (!permitted) return;
    const tick = () => {
      if (document.visibilityState === "visible") refreshLatest.current();
    };
    const interval = window.setInterval(tick, 30_000);
    window.addEventListener("production-data-changed", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("production-data-changed", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [permitted]);

  const views = availableProductionViews(user);
  const viewLabels: Record<string, [string, string]> = {
    management: ["إدارة الإنتاج", "Production management"], film: ["تشغيل الفيلم", "Film operations"],
    printing: ["الطباعة", "Printing"], cutting: ["القص", "Cutting"], mixing: ["خلط مواد الخام", "Raw material mixing"],
    monitoring: ["مراقبة الإنتاج", "Production monitoring"],
  };
  const logMachineOptions = summary?.production_machines ?? [];
  const mixMachineOptions = summary?.machines ?? [];
  const machineLabel = (machine: ProductionMachineOption) => localized(machine.machine_name_ar, machine.machine_name, en, machine.machine_id);
  const pageIndex = (previous: string[]) => previous.length + 1;

  return <main className="raw-ops production pm-page" dir={en ? "ltr" : "rtl"}>
    <header className="raw-ops-header">
      <div className="raw-ops-heading">
        <div className="raw-ops-kicker">MPBF / OPERATIONS AUDIT</div>
        <h1>{tr("title", en)}</h1>
        <p>{tr("intro", en)}</p>
      </div>
      <div className="raw-ops-actions">
        {permitted && <button className="raw-btn quiet" type="button" onClick={() => refreshLatest.current()}><RefreshCw />{tr("refresh", en)}</button>}
        <div className="raw-ops-mark" aria-hidden="true"><i /><span>TRACE<br />/ 03</span></div>
      </div>
    </header>

    <nav className="raw-ops-nav" aria-label={en ? "Production modules" : "وحدات الإنتاج"}>
      {views.map(view => <Link key={view.view} href={view.href} aria-current={view.view === "monitoring" && permitted ? "page" : undefined}>{viewLabels[view.view]?.[en ? 1 : 0] ?? view.view}</Link>)}
    </nav>
    {!permitted ? <div className="raw-ops-banner error" role="alert">{tr("permission", en)}</div> : <>
      <div className="pm-tabs" aria-label={tr("title", en)}>
        <button type="button" aria-pressed={section === "log"} className={section === "log" ? "active" : ""} onClick={() => setSection("log")}>{tr("log", en)}</button>
        <button type="button" aria-pressed={section === "mixes"} className={section === "mixes" ? "active" : ""} onClick={() => setSection("mixes")}>{tr("mixes", en)}</button>
      </div>

      {section === "log" && <section className="pm-section">
        <div className="raw-ops-card pm-filter-card">
          <div className="raw-ops-card-head"><h2>{tr("log", en)}</h2><span className="pm-eyebrow">ROLL REGISTRATION / LIVE ARCHIVE</span></div>
          <div className="raw-ops-card-body pm-filters">
            <div className="raw-ops-field"><label htmlFor="pm-stage">{tr("stage", en)}</label><select id="pm-stage" value={stage} onChange={event => setStage(event.target.value)}><option value="">{tr("allStages", en)}</option>{stages.map(item => <option key={item} value={item}>{tr(item, en)}</option>)}</select></div>
            <div className="raw-ops-field"><label htmlFor="pm-log-machine">{tr("machine", en)}</label><select id="pm-log-machine" value={logMachine} onChange={event => setLogMachine(event.target.value)}><option value="">{tr("allMachines", en)}</option>{logMachineOptions.map(machine => <option key={machine.machine_id} value={machine.machine_id}>{machineLabel(machine)}</option>)}</select></div>
            <div className="raw-ops-field"><label htmlFor="pm-from">{tr("from", en)}</label><input id="pm-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></div>
            <div className="raw-ops-field"><label htmlFor="pm-to">{tr("to", en)}</label><input id="pm-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></div>
            <div className="raw-ops-field pm-search"><label htmlFor="pm-search">{tr("search", en)}</label><input id="pm-search" type="search" maxLength={120} value={searchInput} onChange={event => setSearchInput(event.target.value.slice(0, 120))} /></div>
          </div>
        </div>
        {summaryError && <div className="raw-ops-banner error" role="alert"><span>{summaryError}</span><button className="raw-btn quiet" type="button" onClick={() => void loadSummary()}><RefreshCw />{tr("retry", en)}</button></div>}
        {logPage.error && <div className="raw-ops-banner error" role="alert"><span>{logPage.error || tr("logError", en)}</span><button className="raw-btn quiet" type="button" onClick={() => void loadLog(logPage.cursor, logPage.previous)}><RefreshCw />{tr("retry", en)}</button></div>}
        {logPage.loading && !logPage.data ? <LoadingBlock label={tr("loading", en)} /> : logPage.data?.records.length ? <div className="pm-events">
          {logPage.data.records.map(event => <article className="pm-event" key={event.id}>
            <div className="pm-event-main">
              <div className="pm-event-title"><span className={`pm-stage stage-${event.stage}`}>{tr(event.stage, en)}</span><strong>{event.roll_number || `#${event.roll_id}`}</strong></div>
              <div className="pm-event-meta">
                <span>{localized(event.machine_name_ar, event.machine_name, en, event.machine_id)}</span>
                <span>{stamp(event.registered_at, en)}</span>
                <span>{localized(event.actor_name_ar, event.actor_name, en, tr("unavailable", en))}</span>
              </div>
              <div className="pm-orders"><span><small>{tr("order", en)}</small><b>{event.order_number || "—"}</b></span><span><small>{tr("productionOrder", en)}</small><b>{event.production_order_number || "—"}</b></span></div>
            </div>
            <div className="pm-event-weight">
              {event.stage === "cutting" ? <>
                <div><small>{tr("net", en)}</small><b className="raw-ops-number">{kg(event.net_weight_kg)}</b></div>
                <div><small>{tr("waste", en)}</small><b className="raw-ops-number">{kg(event.waste_kg)}</b></div>
              </> : <div><small>{tr("gross", en)}</small><b className="raw-ops-number">{kg(event.weight_kg)}</b></div>}
              <button className="pm-expand" type="button" aria-expanded={openRoll?.eventKey === event.id} aria-controls={`roll-detail-${encodeURIComponent(event.id)}`} onClick={() => void openRollDetail(event.id, event.roll_id)}>
                <ChevronDown aria-hidden="true" />{openRoll?.eventKey === event.id ? tr("collapse", en) : tr("expandRoll", en)}
              </button>
            </div>
            {openRoll?.eventKey === event.id && <div className="pm-detail" id={`roll-detail-${encodeURIComponent(event.id)}`}>
              <strong>{tr("detail", en)}</strong>
              {rollDetails[event.roll_id]?.loading && <LoadingBlock label={tr("loading", en)} />}
              {rollDetails[event.roll_id]?.error && <div className="raw-ops-banner error" role="alert">{rollDetails[event.roll_id].error}<button className="raw-btn quiet" type="button" onClick={() => void loadRollPage(event.roll_id)}> {tr("retry", en)}</button></div>}
              {rollDetails[event.roll_id]?.data && <>
                <div className="pm-facts">
                  <span><small>{tr("gross", en)}</small><b className="raw-ops-number">{kg(rollDetails[event.roll_id].data!.weight_kg)}</b></span>
                  <span><small>{tr("portion", en)}</small><b className="raw-ops-number">{kg(rollDetails[event.roll_id].data!.uncovered_kg)}</b></span>
                </div>
                {!rollDetails[event.roll_id].data!.tracked && <p className="pm-explainer">{tr("untrackedRoll", en)}</p>}
                <AllocationRows records={rollDetails[event.roll_id].data!.allocations.records} en={en} emptyLabel={tr("noAllocations", en)} showMixSource />
                <Pager next={Boolean(rollDetails[event.roll_id].data!.allocations.next)} previous={rollDetails[event.roll_id].previous.length > 0} loading={rollDetails[event.roll_id].loading} page={pageIndex(rollDetails[event.roll_id].previous)} en={en}
                  onPrevious={() => { const prev = [...rollDetails[event.roll_id].previous]; const cursor = prev.pop(); void loadRollPage(event.roll_id, cursor, prev); }}
                  onNext={() => { const detail = rollDetails[event.roll_id]; const next = detail.data?.allocations.next; if (next) void loadRollPage(event.roll_id, next, [...detail.previous, detail.cursor ?? ""]); }} />
              </>}
            </div>}
          </article>)}
          <Pager next={Boolean(logPage.data.next)} previous={logPage.previous.length > 0} loading={logPage.loading} page={pageIndex(logPage.previous)} en={en}
            onPrevious={() => { const prev = [...logPage.previous]; const cursor = prev.pop(); void loadLog(cursor, prev); }}
            onNext={() => { const next = logPage.data?.next; if (next) void loadLog(next, [...logPage.previous, logPage.cursor ?? ""]); }} />
        </div> : !logPage.loading && <div className="raw-ops-empty"><strong>{tr("noLog", en)}</strong></div>}
      </section>}

      {section === "mixes" && <section className="pm-section">
        <section className="raw-ops-card pm-summary">
          <div className="raw-ops-card-head"><div><h2>{tr("lifetime", en)}</h2><span className="pm-activation">{tr("activation", en)}: {summary ? stamp(summary.activated_at, en) : "—"}</span></div><span className="pm-eyebrow">LIFETIME / MACHINE-WIDE</span></div>
          <div className="raw-ops-card-body">
            <p className="pm-explainer">{tr("activationExplain", en)}</p>
            {summaryError && <div className="raw-ops-banner error" role="alert"><span>{summaryError || tr("summaryError", en)}</span><button className="raw-btn quiet" type="button" onClick={() => void loadSummary()}>{tr("retry", en)}</button></div>}
            {summaryLoading && !summary ? <LoadingBlock label={tr("loading", en)} /> : summary?.machines.length ? <div className="pm-balances">
              {summary.machines.map(machine => <article className="pm-balance" key={machine.machine_id}>
                <div className="pm-balance-title"><strong>{machineLabel(machine)}</strong><small>{machine.machine_id}</small></div>
                <div className="pm-balance-grid">
                  <Balance label={tr("mixed", en)} value={machine.mixed_kg} />
                  <Balance label={tr("consumed", en)} value={machine.consumed_kg} />
                  <Balance label={tr("remaining", en)} value={machine.remaining_kg} emphasis />
                  <Balance label={tr("film", en)} value={machine.film_kg} />
                  <Balance label={tr("uncovered", en)} value={machine.uncovered_kg} />
                </div>
              </article>)}
            </div> : !summaryLoading && <div className="raw-ops-empty"><strong>{tr("noMixes", en)}</strong></div>}
          </div>
        </section>
        <div className="raw-ops-card pm-history">
          <div className="raw-ops-card-head"><h2>{tr("history", en)}</h2><span className="pm-eyebrow">ARCHIVE / MIX RECORDS</span></div>
          <div className="raw-ops-card-body pm-filters pm-mix-filter">
            <div className="raw-ops-field"><label htmlFor="pm-mix-machine">{tr("machine", en)}</label><select id="pm-mix-machine" value={mixMachine} onChange={event => setMixMachine(event.target.value)}><option value="">{tr("allMachines", en)}</option>{mixMachineOptions.map(machine => <option key={machine.machine_id} value={machine.machine_id}>{machineLabel(machine)}</option>)}</select></div>
            <p className="raw-ops-helper">{tr("screwNote", en)}</p>
          </div>
          {mixPage.error && <div className="raw-ops-banner error" role="alert"><span>{mixPage.error || tr("mixError", en)}</span><button className="raw-btn quiet" type="button" onClick={() => void loadMixes(mixPage.cursor, mixPage.previous)}>{tr("retry", en)}</button></div>}
          {mixPage.loading && !mixPage.data ? <LoadingBlock label={tr("loading", en)} /> : mixPage.data?.records.length ? <div className="pm-mixes">
            {mixPage.data.records.map(mix => <MixCard key={mix.id} mix={mix} open={openMix === mix.id} detail={mixDetails[mix.id]} en={en} onToggle={() => void openMixDetail(mix.id)}
              onRetry={() => void loadMixDetailPage(mix.id)}
              onPrevious={() => { const detail = mixDetails[mix.id]; const prev = [...detail.previous]; const cursor = prev.pop(); void loadMixDetailPage(mix.id, cursor, prev); }}
              onNext={() => { const detail = mixDetails[mix.id]; const next = detail.data?.allocations.next; if (next) void loadMixDetailPage(mix.id, next, [...detail.previous, detail.cursor ?? ""]); }} />)}
            <Pager next={Boolean(mixPage.data.next)} previous={mixPage.previous.length > 0} loading={mixPage.loading} page={pageIndex(mixPage.previous)} en={en}
              onPrevious={() => { const prev = [...mixPage.previous]; const cursor = prev.pop(); void loadMixes(cursor, prev); }}
              onNext={() => { const next = mixPage.data?.next; if (next) void loadMixes(next, [...mixPage.previous, mixPage.cursor ?? ""]); }} />
          </div> : !mixPage.loading && <div className="raw-ops-empty"><strong>{tr("noMixes", en)}</strong></div>}
        </div>
      </section>}
    </>}
  </main>;
}

function Balance({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`pm-balance-cell${emphasis ? " emphasis" : ""}`}><small>{label}</small><b className="raw-ops-number">{kg(value)}</b></div>;
}

function AllocationRows({ records, en, emptyLabel, showMixSource = false }: {
  records: MixMonitorDetail["allocations"]["records"] | RollMixDetail["allocations"]["records"];
  en: boolean; emptyLabel: string; showMixSource?: boolean;
}) {
  return records.length ? <div className="pm-allocation-list">
    {records.map((item, index) => <div className="pm-allocation" key={`${item.mix_id}-${item.roll_id}-${index}`}>
      <span><b>{showMixSource ? `${en?"Mix":"خلطة"} #${formatNumber(item.mix_id)}` : item.roll_number || `#${item.roll_id}`}</b><small>{stamp(item.mix_registered_at, en)}</small></span>
      <span className="pm-allocation-screw">{item.screw ? `${en ? "Screw" : "اللولب"} ${item.screw}` : (en ? "Screw unspecified" : "لولب غير محدد")}</span>
      <strong className="raw-ops-number">{kg(item.allocated_kg)}</strong>
    </div>)}
  </div> : <div className="pm-no-allocation">{emptyLabel}</div>;
}

function MixCard({ mix, open, detail, en, onToggle, onRetry, onPrevious, onNext }: {
  mix: MixMonitorRecord; open: boolean; detail?: DetailState<MixMonitorDetail>; en: boolean;
  onToggle: () => void; onRetry: () => void; onPrevious: () => void; onNext: () => void;
}) {
  const materialLines = mix.items ?? [];
  return <article className="pm-mix-card">
    <div className="pm-mix-head">
      <div className="pm-mix-id"><span className="pm-mix-mark">MIX / {formatNumber(mix.id)}</span><strong>{localized(mix.machine_name_ar, mix.machine_name, en, mix.machine_id)}</strong><small>{stamp(mix.created_at, en)} · {localized(mix.actor_name_ar, mix.actor_name, en, en ? "Unavailable" : "غير متاح")}</small></div>
      <div className="pm-mix-total"><small>{tr("total", en)}</small><b className="raw-ops-number">{kg(mix.total_kg)}</b></div>
      <button className="pm-expand" type="button" aria-expanded={open} aria-controls={`mix-detail-${mix.id}`} onClick={onToggle}><ChevronDown aria-hidden="true" />{open ? tr("collapse", en) : tr("expandMix", en)}</button>
    </div>
    <div className="pm-mix-stats">
      <Balance label={tr("consumed", en)} value={mix.consumed_kg} />
      <div className="pm-balance-cell"><small>{tr("remaining", en)}</small><b className="raw-ops-number">{mix.tracked && mix.remaining_kg !== null ? kg(mix.remaining_kg) : "—"}</b></div>
      <div className={`pm-tracking ${mix.tracked ? "is-tracked" : ""}`}><span>{mix.tracked ? tr("tracked", en) : tr("untracked", en)}</span>{!mix.tracked && <small>{tr("untrackedExplain", en)}</small>}</div>
      <div className="pm-screw-fact"><small>{tr("screw", en)}</small><b>{mix.screw ? `${tr("screw", en)} ${mix.screw}` : tr("screwUnknown", en)}</b></div>
    </div>
    {materialLines.length > 0 && <div className="pm-material-lines" aria-label={en ? "Original material lines" : "سطور المواد الأصلية"}>
      {materialLines.map((item, index) => <span className="pm-material" key={`${item.material_id}-${index}`}><b>{localized(item.name_ar, item.name, en, item.code)}</b><small>{item.code}</small><strong className="raw-ops-number">{kg(item.quantity_kg)}</strong></span>)}
    </div>}
    {mix.notes && <p className="pm-notes"><b>{tr("notes", en)}:</b> {mix.notes}</p>}
    {open && <div className="pm-detail" id={`mix-detail-${mix.id}`}>
      {detail?.loading && <LoadingBlock label={tr("loading", en)} />}
      {detail?.error && <div className="raw-ops-banner error" role="alert"><span>{detail.error}</span><button className="raw-btn quiet" type="button" onClick={onRetry}>{tr("retry", en)}</button></div>}
      {detail?.data && <>
        <div className="pm-detail-heading"><strong>{tr("linkedRolls", en)}</strong><span className="raw-ops-helper">{tr("screwNote", en)}</span></div>
        <div className="pm-facts">
          <span><small>{tr("total", en)}</small><b className="raw-ops-number">{kg(detail.data.mix.total_kg)}</b></span>
          <span><small>{tr("consumed", en)}</small><b className="raw-ops-number">{kg(detail.data.mix.consumed_kg)}</b></span>
          <span><small>{tr("remaining", en)}</small><b className="raw-ops-number">{detail.data.mix.tracked && detail.data.mix.remaining_kg !== null ? kg(detail.data.mix.remaining_kg) : "—"}</b></span>
          <span><small>{tr("screw", en)}</small><b>{detail.data.mix.screw ? `${tr("screw", en)} ${detail.data.mix.screw}` : tr("screwUnknown", en)}</b></span>
        </div>
        {!detail.data.mix.tracked && <p className="pm-explainer">{tr("untrackedExplain", en)}</p>}
        <AllocationRows records={detail.data.allocations.records} en={en} emptyLabel={tr("noAllocations", en)} />
        <Pager next={Boolean(detail.data.allocations.next)} previous={Boolean(detail.previous.length)} loading={detail.loading} page={detail.previous.length + 1} en={en} onPrevious={onPrevious} onNext={onNext} />
      </>}
    </div>}
  </article>;
}
