import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, CircleAlert, Factory, PackageCheck, Search, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { canViewOrderWorkflow, type OrderWorkflow, type WorkflowContribution, type WorkflowOperation, type WorkflowProductionOrder, type WorkflowRoll } from "../../../shared/order-workflow";
import { api, type Row } from "../lib/app-api";
import { formatNumber } from "../lib/format-number";
import "./OrderWorkflowPage.css";

const PAGE_SIZE = 30;
type StageFilter = "" | "film" | "printing" | "done";
const englishText = (value: string | null | undefined) => value && !/[\u0600-\u06ff]/u.test(value) ? value : "";
const stageName = (stage: string, lang: string) => ({
  film: lang === "ar" ? "الفيلم" : "Film",
  printing: lang === "ar" ? "الطباعة" : "Printing",
  cutting: lang === "ar" ? "القص" : "Cutting",
  completed: lang === "ar" ? "مكتمل" : "Completed",
  done: lang === "ar" ? "مكتمل" : "Finished",
} as Record<string, string>)[stage] || (lang === "ar" ? "لم يبدأ" : "Not started");
const statusName = (status: string, lang: string) => {
  const names: Record<string, [string, string]> = {
    waiting: ["جديد", "New"], on_hold: ["معلّق", "On hold"],
    in_production: ["قيد الإنتاج", "In production"], for_production: ["جاهز للإنتاج", "Ready for production"],
    paused: ["متوقف", "Paused"], cancelled: ["ملغي", "Cancelled"],
    completed: ["مكتمل", "Completed"], delivered: ["مسلّم", "Delivered"], archived: ["مؤرشف", "Archived"],
  };
  return names[status]?.[lang === "ar" ? 0 : 1] || (lang === "ar" ? "غير محدد" : "Unspecified");
};
const personName = (person: WorkflowContribution["actor"], lang: string) => {
  if (!person) return lang === "ar" ? "موظف غير محدد" : "Unrecorded employee";
  if (lang === "ar") return person.display_name_ar || person.display_name || person.full_name || person.username || "موظف غير محدد";
  return englishText(person.display_name) || englishText(person.username) || "Unrecorded employee";
};
const operationPerson = (operation: WorkflowOperation, lang: string) => {
  const actor = operation.actor;
  return actor ? personName(actor, lang) : lang === "ar" ? "غير مسجل" : "Unrecorded";
};
const productName = (production: WorkflowProductionOrder, lang: string) =>
  lang === "ar" ? production.product_name_ar || production.product_name || "منتج غير محدد" : englishText(production.product_name) || "Unspecified product";
const sum = (values: string[]) => values.reduce((total, value) => total + (Number(value) || 0), 0);
const dateLabel = (value: string | null, lang: string, time = false) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB-u-ca-gregory", { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Riyadh" }).format(date);
};

function Metric({ label, value, unit = "kg", emphasis = false }: { label: string; value: string | number; unit?: string; emphasis?: boolean }) {
  return <div className={`workflow-metric${emphasis ? " workflow-metric--emphasis" : ""}`}><span>{label}</span><strong>{formatNumber(value)}<small>{unit}</small></strong></div>;
}

export default function OrderWorkflowPage({ id, user }: { id: string; user: Row }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "ar" ? "ar" : "en";
  const rtl = lang === "ar";
  const isAuthorized = canViewOrderWorkflow(user);
  const [workflow, setWorkflow] = useState<OrderWorkflow | null>(null);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StageFilter>("");
  const [productionOrderId, setProductionOrderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const moreRequest = useRef(false);
  const queryKey = `${id}|${search.trim()}|${stage}|${productionOrderId}`;
  const labels = rtl ? {
    title: "سير العمل", subtitle: "البيانات المسجلة حالياً، وتعكس تعديلات المدير · للعرض فقط",
    order: "الطلب", customer: "العميل", created: "تاريخ الإنشاء", delivery: "موعد التسليم",
    requested: "المطلوب", planned: "المخطط", actual: "الإنتاج الفعلي", remaining: "المتبقي",
    excess: "زيادة", progress: "إنجاز الإنتاج النهائي", waste: "الهدر المسجل", complete: "لفات مكتملة",
    pending: "لفات قيد التنفيذ", productionOrders: "أوامر الإنتاج", contributions: "مساهمات الموظفين",
    rollLog: "سجل اللفات", search: "ابحث برقم اللفة", allOrders: "كل أوامر الإنتاج", allStages: "كل المراحل",
    film: "الفيلم", printing: "الطباعة", done: "مكتمل", roll: "لفة", employee: "الموظف", quantity: "الكمية",
    rolls: "لفات", status: "الحالة", noProduction: "لا توجد أوامر إنتاج لهذا الطلب.",
    noRolls: "لا توجد لفات مطابقة للفلاتر.", loading: "جارٍ تحميل سجل التنفيذ…",
    loadError: "تعذر تحميل سجل التنفيذ.", retry: "إعادة المحاولة", more: "تحميل المزيد",
    loadingMore: "جارٍ تحميل المزيد…", machine: "الماكينة", time: "وقت التسجيل",
    net: "الصافي", gross: "الوزن", rollWaste: "الهدر", filmStage: "الفيلم",
    printingStage: "الطباعة", cuttingStage: "القص", notRecorded: "غير مسجل",
    unauthorized: "هذه الصفحة متاحة لمديري الإنتاج فقط.", back: "العودة للطلبات",
    output: "الكمية النهائية", of: "من", searchEmpty: "لا توجد لفات مسجلة بعد.",
  } : {
    title: "Order workflow", subtitle: "Current recorded data, including manager corrections · read only",
    order: "Order", customer: "Customer", created: "Created", delivery: "Delivery date",
    requested: "Requested", planned: "Planned", actual: "Actual output", remaining: "Remaining",
    excess: "Excess", progress: "Final-output progress", waste: "Recorded waste", complete: "Completed rolls",
    pending: "In-progress rolls", productionOrders: "Production orders", contributions: "Employee contributions",
    rollLog: "Roll record", search: "Search roll number", allOrders: "All production orders", allStages: "All stages",
    film: "Film", printing: "Printing", done: "Finished", roll: "Roll", employee: "Employee", quantity: "Quantity",
    rolls: "rolls", status: "Status", noProduction: "No production orders are attached to this order.",
    noRolls: "No rolls match these filters.", loading: "Loading execution record…",
    loadError: "Could not load the execution record.", retry: "Retry", more: "Load more",
    loadingMore: "Loading more…", machine: "Machine", time: "Recorded at",
    net: "Net", gross: "Weight", rollWaste: "Waste", filmStage: "Film",
    printingStage: "Printing", cuttingStage: "Cutting", notRecorded: "Unrecorded",
    unauthorized: "This page is available to production managers only.", back: "Back to orders",
    output: "Final output", of: "of", searchEmpty: "No rolls have been recorded yet.",
  };
  const requestFirstPage = useCallback(async () => {
    const sequence = ++request.current;
    moreRequest.current = false;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setMoreError("");
    setWorkflow(current => String(current?.order.id) === id ? current : null);
    setLoadedKey("");
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: "0" });
    if (productionOrderId) params.set("production_order_id", productionOrderId);
    if (stage) params.set("stage", stage);
    if (search.trim()) params.set("search", search.trim());
    try {
      const result = await api(`/orders/${encodeURIComponent(id)}/workflow?${params}`) as OrderWorkflow;
      if (sequence !== request.current) return;
      setWorkflow(result);
      setLoadedKey(queryKey);
    } catch (reason) {
      if (sequence !== request.current) return;
      setError(lang === "en" ? labels.loadError : reason instanceof Error ? reason.message : labels.loadError);
      setLoadedKey(queryKey);
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [id, lang, productionOrderId, queryKey, retry, search, stage, labels.loadError]);

  useEffect(() => {
    if (!isAuthorized) return;
    request.current += 1;
    moreRequest.current = false;
    setLoading(true);
    setLoadingMore(false);
    setWorkflow(current => String(current?.order.id) === id ? current : null);
    setLoadedKey("");
    setError("");
    setMoreError("");
    const timer = window.setTimeout(() => { void requestFirstPage(); }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [requestFirstPage, isAuthorized]);
  useEffect(() => () => { request.current += 1; moreRequest.current = false; }, []);

  const loadMore = async () => {
    if (!workflow?.has_more || workflow.next_offset === null || moreRequest.current || loadedKey !== queryKey) return;
    moreRequest.current = true;
    const sequence = request.current;
    setLoadingMore(true);
    setMoreError("");
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(workflow.next_offset) });
    if (productionOrderId) params.set("production_order_id", productionOrderId);
    if (stage) params.set("stage", stage);
    if (search.trim()) params.set("search", search.trim());
    try {
      const page = await api(`/orders/${encodeURIComponent(id)}/workflow?${params}`) as OrderWorkflow;
      if (sequence !== request.current) return;
      setWorkflow(current => current ? { ...current, rolls: [...current.rolls, ...page.rolls], has_more: page.has_more, next_offset: page.next_offset } : page);
    } catch (reason) {
      if (sequence !== request.current) return;
      setMoreError(lang === "en" ? labels.loadError : reason instanceof Error ? reason.message : labels.loadError);
    } finally {
      if (sequence === request.current) { moreRequest.current = false; setLoadingMore(false); }
    }
  };

  const orders = workflow?.production_orders || [];
  const totals = useMemo(() => {
    const requested = sum(orders.map(order => order.requested_kg));
    const planned = sum(orders.map(order => order.planned_kg));
    const actual = sum(orders.map(order => order.produced_kg));
    return { requested, planned, actual, waste: sum(orders.map(order => order.waste_kg)), complete: orders.reduce((n, order) => n + order.completed_rolls, 0), rolls: orders.reduce((n, order) => n + order.roll_count, 0) };
  }, [orders]);
  const contributions = useMemo(() => {
    const grouped = new Map<string, { stage: string; name: string; quantity: number; rolls: number }>();
    for (const contribution of orders.flatMap(order => order.contributions || [])) {
      const name = personName(contribution.actor, lang);
      const key = `${contribution.stage}:${contribution.actor?.id ?? name}`;
      const current = grouped.get(key) || { stage: contribution.stage, name, quantity: 0, rolls: 0 };
      current.quantity += Number(contribution.quantity_kg) || 0;
      current.rolls += contribution.roll_count || 0;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => a.stage.localeCompare(b.stage) || b.quantity - a.quantity);
  }, [orders, lang]);
  const progress = totals.planned > 0 ? Math.min(100, (totals.actual / totals.planned) * 100) : 0;
  if (!isAuthorized) return <main className="workflow-page" dir={rtl ? "rtl" : "ltr"}><div className="workflow-access"><ShieldAlert size={24} /><h1>{labels.unauthorized}</h1><Link href="/orders" className="btn btn-muted">{rtl ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}{labels.back}</Link></div></main>;

  return <main className="workflow-page" dir={rtl ? "rtl" : "ltr"}>
    <header className="workflow-heading">
      <div className="workflow-heading__top">
        <Link href="/orders" className="workflow-back">{rtl ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}{labels.back}</Link>
        <span className="workflow-readonly"><Factory size={14} />{rtl ? "عرض فقط" : "READ ONLY"}</span>
      </div>
      <div className="workflow-title-row">
        <div><div className="workflow-kicker">{labels.order} / {workflow?.order.order_number || id}</div><h1>{labels.title}</h1><p>{labels.subtitle}</p></div>
        {workflow && <div className="workflow-customer"><span>{labels.customer}</span><strong>{rtl ? workflow.order.customer_name_ar || workflow.order.customer_name || "—" : englishText(workflow.order.customer_name) || "—"}</strong></div>}
      </div>
      {workflow && <div className="workflow-meta"><span><small>{labels.created}</small><strong>{dateLabel(workflow.order.created_at, lang)}</strong></span><span><small>{labels.delivery}</small><strong>{dateLabel(workflow.order.delivery_date, lang)}</strong></span><span><small>{labels.status}</small><strong>{statusName(workflow.order.status, lang)}</strong></span></div>}
    </header>

    {loading && !workflow && <div className="workflow-skeleton" aria-busy="true" aria-label={labels.loading}><div /><div /><div /></div>}
    {!loading && error && <section className="workflow-message workflow-message--error" role="alert"><CircleAlert size={20} /><span>{error || labels.loadError}</span><button type="button" className="btn btn-muted" onClick={() => setRetry(n => n + 1)}>{labels.retry}</button></section>}
    {workflow && <>
      <section className="workflow-overview" aria-label={labels.progress}>
        <div className="workflow-overview__main">
          <div className="workflow-overview__label"><span>{labels.progress}</span><strong>{formatNumber(progress)}%</strong></div>
          <div className="workflow-progress"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <div className="workflow-overview__detail"><span>{labels.actual}: <b>{formatNumber(totals.actual)} kg</b></span><span>{labels.of} <b>{formatNumber(totals.planned)} kg</b> {labels.planned.toLowerCase()}</span></div>
        </div>
        <div className="workflow-overview__rolls"><PackageCheck size={20} /><div><strong>{formatNumber(totals.complete)} / {formatNumber(totals.rolls)}</strong><span>{labels.complete}</span></div></div>
      </section>

      <section className="workflow-metrics">
        <Metric label={labels.requested} value={totals.requested} />
        <Metric label={labels.planned} value={totals.planned} />
        <Metric label={labels.actual} value={totals.actual} emphasis />
        <Metric label={totals.actual > totals.planned ? labels.excess : labels.remaining} value={Math.abs(totals.planned - totals.actual)} />
        <Metric label={labels.waste} value={totals.waste} />
        <Metric label={labels.pending} value={Math.max(0, totals.rolls - totals.complete)} unit={labels.rolls} />
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading"><div><span className="workflow-index">01</span><h2>{labels.productionOrders}</h2></div><span>{orders.length}</span></div>
        {orders.length ? <div className="workflow-po-list">{orders.map(order => {
          const difference = Number(order.planned_kg) - Number(order.produced_kg);
          return <article className="workflow-po" key={order.id}>
            <div className="workflow-po__identity"><strong>{order.production_order_number}</strong><span>{productName(order, lang)}</span><small>{statusName(order.status, lang)} · {stageName(order.stage || "", lang)}</small></div>
            <div className="workflow-po__quantities">
              <Metric label={labels.requested} value={order.requested_kg} />
              <Metric label={labels.planned} value={order.planned_kg} />
              <Metric label={labels.actual} value={order.produced_kg} emphasis />
              <Metric label={difference < 0 ? labels.excess : labels.remaining} value={Math.abs(difference)} />
              <Metric label={labels.waste} value={order.waste_kg} />
            </div>
            <div className="workflow-po__footer"><span>{labels.complete} <b>{formatNumber(order.completed_rolls)}</b></span><span>{labels.pending} <b>{formatNumber(Math.max(0, order.roll_count - order.completed_rolls))}</b></span></div>
          </article>;
        })}</div> : <div className="workflow-empty">{labels.noProduction}</div>}
      </section>

      <section className="workflow-section">
        <div className="workflow-section__heading"><div><span className="workflow-index">02</span><h2>{labels.contributions}</h2></div></div>
        {contributions.length ? <div className="workflow-contributions">{contributions.map((entry, index) => <div className="workflow-contribution" key={`${entry.stage}:${entry.name}:${index}`}><span className={`workflow-stage-dot workflow-stage-dot--${entry.stage}`} /><div><strong>{entry.name}</strong><small>{stageName(entry.stage, lang)}</small></div><b>{formatNumber(entry.quantity)} <small>kg</small></b><span>{formatNumber(entry.rolls)} {labels.rolls}</span></div>)}</div> : <div className="workflow-empty">{rtl ? "لا توجد مساهمات موظفين مسجلة." : "No employee contributions recorded."}</div>}
      </section>

      <section className="workflow-section workflow-roll-section">
        <div className="workflow-section__heading"><div><span className="workflow-index">03</span><h2>{labels.rollLog}</h2></div><span>{formatNumber(workflow.rolls.length)}{workflow.has_more ? "+" : ""}</span></div>
        <div className="workflow-filters">
          <label className="workflow-search"><Search size={17} /><input maxLength={100} aria-label={labels.search} placeholder={labels.search} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className="workflow-select"><span>{labels.productionOrders}</span><select aria-label={labels.productionOrders} value={productionOrderId} onChange={event => setProductionOrderId(event.target.value)}><option value="">{labels.allOrders}</option>{orders.map(order => <option key={order.id} value={order.id}>{order.production_order_number}</option>)}</select><ChevronDown size={15} /></label>
          <label className="workflow-select"><span>{labels.status}</span><select aria-label={labels.status} value={stage} onChange={event => setStage(event.target.value as StageFilter)}><option value="">{labels.allStages}</option><option value="film">{labels.film}</option><option value="printing">{labels.printing}</option><option value="done">{labels.done}</option></select><ChevronDown size={15} /></label>
        </div>
        {loading ? <div className="workflow-skeleton" aria-busy="true" aria-label={labels.loading}><div /></div>
          : error ? null : workflow.rolls.length ? <div className="workflow-roll-list">{workflow.rolls.map(roll => <RollRecord key={roll.id} roll={roll} lang={lang} labels={labels} />)}</div> : <div className="workflow-empty workflow-empty--rolls"><span className="workflow-empty__mark">—</span><strong>{search || stage || productionOrderId ? labels.noRolls : labels.searchEmpty}</strong></div>}
        {moreError && <div className="workflow-more-error" role="alert">{moreError}<button type="button" className="btn btn-muted" onClick={() => void loadMore()}>{labels.retry}</button></div>}
        {!loading && !error && workflow.has_more && <div className="workflow-load-more"><button type="button" className="btn btn-muted" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? labels.loadingMore : labels.more}</button></div>}
      </section>
    </>}
  </main>;
}

function RollRecord({ roll, lang, labels }: { roll: WorkflowRoll; lang: string; labels: Record<string, string> }) {
  const stages: { key: "film" | "printing" | "cutting"; operation: WorkflowOperation; name: string }[] = [
    { key: "film", operation: roll.film, name: labels.filmStage },
    { key: "printing", operation: roll.printing, name: labels.printingStage },
    { key: "cutting", operation: roll.cutting, name: labels.cuttingStage },
  ];
  const weight = roll.is_roll_product ? roll.weight_kg : roll.net_weight_kg;
  return <article className="workflow-roll">
    <header className="workflow-roll__head"><div><span>{labels.roll}</span><strong>{roll.roll_number}</strong></div><div className={`workflow-roll__state workflow-roll__state--${roll.stage}`}>{stageName(roll.stage, lang)}</div><small>{roll.production_order_number}</small></header>
    <div className="workflow-roll__weights"><span><small>{roll.is_roll_product ? labels.gross : labels.net}</small><strong>{weight === null ? labels.notRecorded : <>{formatNumber(weight)} <i>kg</i></>}</strong></span>{!roll.is_roll_product && <span><small>{labels.gross}</small><strong>{formatNumber(roll.weight_kg)} <i>kg</i></strong></span>}<span><small>{labels.rollWaste}</small><strong>{formatNumber(roll.waste_kg)} <i>kg</i></strong></span></div>
    <div className="workflow-roll__stages">{stages.map(({ key, operation, name }) => <div className={`workflow-operation${operation.actor || operation.machine_name || operation.at ? " workflow-operation--recorded" : ""}`} key={key}>
      <span className={`workflow-stage-dot workflow-stage-dot--${key}`} /><strong>{name}</strong>
      <span>{operationPerson(operation, lang)}</span>
      <span>{lang === "ar" ? operation.machine_name_ar || operation.machine_name || labels.notRecorded : englishText(operation.machine_name) || labels.notRecorded}</span>
      <time dateTime={operation.at || undefined}>{operation.at ? dateLabel(operation.at, lang, true) : labels.notRecorded}</time>
    </div>)}</div>
  </article>;
}
