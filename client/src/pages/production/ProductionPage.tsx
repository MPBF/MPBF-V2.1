import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronRight, Factory, Plus, RefreshCw, Settings2, X } from "lucide-react";
import { Link } from "wouter";
import FilmOperatorOrders from "./FilmOperatorOrders";
import RollOperatorOrders from "./RollOperatorOrders";
import RollLabelControls from "./RollLabelControls";
import "./roll-labels.css";
import {
  canStartFilmProductionOrder, eligibleForCutting, hasProductionPermission, machineStage,
  type FilmInput, type ProductionMachine, type ProductionOrderRecord, type ProductionRollDetail, type ProductionRollRecord,
  type ProductionStage, type ProductionState, type ProductionUser, type ProductionReceipt, type ReceiptInput,
} from "../../../../shared/production";
import { confirmedProductionRejection, productionApi } from "../../lib/production-api";
import { availableProductionViews, canOpenProductionView } from "../../lib/production-navigation";
import { availablePlanningViews, canOpenPlanningView } from "../../lib/planning-navigation";
import { PlanningHeader, PlanningNavigation } from "./PlanningChrome";
import { availableWarehouseViews, canOpenWarehouseView, initialWarehousePath } from "../../lib/warehouse-navigation";
import { productionActorName } from "../../lib/production-actors";
import { formatWholeNumber } from "../../lib/format-number";
import "./production.css";
import "./planning.css";
import "../warehouse/warehouse-cards.css";
import { ProductionHistory } from "./ProductionHistory";
import { FilmDurationSummary } from "./FilmDurationSummary";
import { ReceiptVoucherModal, type ReceiptDraft } from "../warehouse/ReceiptVoucherModal";
import { calculatePacking, type ReceiptPacking } from "../../../../shared/production-packing";

export type ProductionView = "management" | "film" | "printing" | "cutting" | "hall" | "warehouse" | "roll";
export type ProductionPageProps = { user: ProductionUser; view: ProductionView; rollId?: string; moduleContext?: "production" | "warehouse" | "planning" };

const executableOrder = (status: string) => status === "for_production" || status === "in_production";
const unstartableProductionStatuses = new Set(["completed", "archived", "cancelled"]);
const activeMachine = (machine: ProductionMachine) => String(machine.status).toLowerCase() === "active";
const latinDigits = (value: string) => value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, ".").replace(/٬/g, ",");
const number = (value: string | number | null | undefined, language: string, digits = 2) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(latinDigits(String(value)));
  return Number.isFinite(n) ? new Intl.NumberFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { maximumFractionDigits: digits }).format(n) : "—";
};
const date = (value: string | null | undefined, language: string, time = false) => value ? new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Riyadh" }).format(new Date(value)) : "—";
const idempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("secureUnavailable");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};

const messages: Record<string, [string, string]> = {
  monitoring: ["مراقبة الإنتاج", "Production monitoring"],
  planning: ["التخطيط والمراقبة", "Planning and monitoring"],
  mixing: ["خلط مواد الخام", "Raw material mixing"],
  raw: ["صالة الخام", "Raw materials hall"],
  title: ["تشغيل الإنتاج", "Production operations"], intro: ["كل رول يسير في مساره؛ والدفعات تصل للمخزون عند استلامها.", "Each roll moves on its own; batches enter stock when received."],
  management: ["إدارة الإنتاج", "Production management"], film: ["تشغيل الفيلم", "Film operations"], printing: ["تشغيل الطباعة", "Printing operations"], cutting: ["تشغيل القص", "Cutting operations"], hall: ["صالة الإنتاج", "Production hall"], warehouse: ["مخزون المواد التامة", "Finished inventory"], roll: ["سجل الرول", "Roll record"],
  reload: ["تحديث البيانات", "Refresh data"], retry: ["إعادة المحاولة", "Retry"], failedLoad: ["تعذر تحميل بيانات الإنتاج.", "Production data could not be loaded."], loading: ["جارٍ تحميل بيانات الإنتاج", "Loading production data"], noRows: ["لا توجد سجلات لعرضها الآن", "There are no records to show right now"], unrecorded: ["غير مسجل", "Unrecorded"], ready: ["جاهز", "Ready"], running: ["قيد التشغيل", "In progress"], started: ["بدأ الإنتاج", "Production started"], start: ["بدء الإنتاج", "Start production"], noEligible: ["لا توجد أوامر مؤهلة لهذه المرحلة.", "No orders are eligible for this stage."],
  order: ["أمر الإنتاج", "Production order"], customerOrder: ["طلب العميل", "Customer order"], customerStatus: ["حالة طلب العميل", "Customer order status"], productionStatus: ["حالة أمر الإنتاج", "Production-order status"], stage: ["مرحلة الأمر", "Order stage"], rollStage: ["مرحلة الرول", "Roll stage"], product: ["المنتج", "Product"], planned: ["المخطط النهائي", "Final planned"], produced: ["المنتج فعلياً", "Produced actual"], readyKg: ["الجاهز", "Ready"], received: ["المستلم", "Received"], waste: ["الهدر", "Waste"], remaining: ["المتبقي للاستلام", "Receivable"], rolls: ["الرولات", "Rolls"], created: ["تم الحفظ بنجاح.", "Saved successfully."], saving: ["جارٍ الحفظ…", "Saving…"], readonly: ["عرض فقط — لا تتوفر صلاحية التشغيل.", "Read only — operation permission is not granted."],
  incomplete: ["غير مكتمل", "Incomplete"], receiptComplete: ["مكتمل", "Complete"], readyOrders: ["الأوامر الجاهزة للاستلام", "Orders ready for receipt"], orderReadyState: ["حالة الاستلام", "Receipt status"],
  startedAt: ["بدأ في", "Started"], closedAt: ["إغلاق الفيلم", "Film closure"], filmClosed: ["الفيلم مغلق", "Film closed"], historical: ["أمر تاريخي بلا سجلات تنفيذ؛ لا تُعرض أوزان فعلية.", "Historical order without execution records; actual weights are not reported."], filmReadyExplanation: ["الخطة معتمدة وجاهزة. يبدأ التنفيذ عند اختيار «بدء الإنتاج».", "The plan is released and ready. Execution begins when an operator selects Start production."],
  productionIncomplete: ["الإنتاج غير مكتمل", "Production incomplete"], productionComplete: ["الإنتاج مكتمل", "Production complete"],
  addRoll: ["تسجيل رول", "Register roll"], weight: ["وزن الفيلم (كجم)", "Film weight (kg)"], machine: ["ماكينة التشغيل", "Operating machine"], chooseMachine: ["اختر ماكينة", "Choose machine"], changeMachine: ["تغيير الماكينة", "Change machine"], lastRoll: ["آخر رول — إغلاق الفيلم", "This is the final roll — close film"], inline: ["طباعة إنلاين", "Inline printing"], noMachine: ["لا توجد ماكينة نشطة مناسبة.", "No active compatible machine is available."], machineSaved: ["تم حفظ اختيار الماكينة لهذا المشغل.", "Machine choice saved for this operator."],
  printRoll: ["تسجيل الطباعة", "Record printing"], cutRoll: ["إكمال القص", "Complete cutting"], netWeight: ["الوزن الصافي بعد القص (كجم)", "Net weight after cutting (kg)"], completed: ["مكتمل", "Complete"], queue: ["توزيع الطابور", "Queue assignment"], stageSelect: ["المرحلة", "Stage"], position: ["الترتيب", "Position"], assign: ["إضافة للطابور", "Add to queue"], queueList: ["طوابير الماكينات", "Machine queues"], remove: ["إزالة", "Remove"], up: ["أعلى", "Move up"], down: ["أسفل", "Move down"], noQueue: ["لا توجد أوامر موزعة على الطوابير.", "No orders are assigned to queues."],
  eligibleWeight: ["الوزن الجاهز غير المستلم", "Ready, not yet received"], receiveBatch: ["استلام دفعة", "Receive batch"], storage: ["موقع التخزين", "Storage location"], quantity: ["كمية الاستلام (كجم)", "Receipt quantity (kg)"], notes: ["ملاحظات السند", "Voucher notes"], packaging: ["بيانات التعبئة اختيارية", "Optional packaging details"], rollGrams: ["وزن الرول (جرام)", "Roll weight (grams)"], rollsUnit: ["رولات في الوحدة", "Rolls per unit"], units: ["عدد الوحدات", "Units"], addLine: ["إضافة أمر للاستلام", "Add order to receipt"], saveReceipt: ["حفظ سند الاستلام", "Save receipt"], location: ["الموقع", "Location"], saveLocation: ["حفظ الموقع", "Save location"], locationName: ["اسم الموقع", "Location name"], locationAr: ["الاسم بالعربية", "Arabic name"], locationEn: ["الاسم بالإنجليزية", "English name"], active: ["نشط", "Active"], inactive: ["غير نشط", "Inactive"], locations: ["مواقع التخزين", "Storage locations"], balances: ["أرصدة المواد التامة", "Finished-goods balances"], movements: ["حركات المخزون", "Inventory movements"], vouchers: ["سندات الاستلام المحفوظة", "Saved receipt vouchers"], noLocations: ["أضف موقع تخزين قبل حفظ سند.", "Add a storage location before saving a voucher."], unknownRoll: ["الرول غير موجود أو لا تملك صلاحية عرضه.", "The roll does not exist or you do not have permission to view it."],
  qr: ["رمز QR خاص داخل النظام", "Private in-system QR code"], createdAt: ["تاريخ التسجيل", "Registered at"], filmMachine: ["ماكينة الفيلم", "Film machine"], printMachine: ["ماكينة الطباعة", "Printing machine"], cutMachine: ["ماكينة القص", "Cutting machine"], net: ["صافي الوزن", "Net weight"], goManagement: ["إدارة الإنتاج", "Production management"], errorGeneric: ["تعذر تنفيذ العملية. أعد المحاولة دون إدخالها مرة أخرى.", "The operation failed. Retry without entering it again."], enterPositive: ["أدخل قيمة موجبة صحيحة.", "Enter a valid positive value."], locationCreated: ["تم حفظ الموقع.", "Location saved."], receiptCreated: ["تم حفظ سند الاستلام.", "Receipt saved."], startConfirm: ["بدء أمر الإنتاج؟", "Start this production order?"], permission: ["لا تتوفر صلاحية لهذا العرض.", "You do not have permission to view this page."], noRolls: ["لا توجد رولات مؤهلة حالياً.", "No rolls are eligible right now."], chooseOrder: ["اختر أمراً", "Choose an order"], historyStatus: ["حالة السند", "Voucher status"], movementDate: ["وقت الحركة", "Movement time"],
  cancel: ["إلغاء", "Cancel"], edit: ["تعديل", "Edit"], waiting: ["انتظار", "Waiting"], on_hold: ["معلّق", "On hold"], for_production: ["جاهز للإنتاج", "Ready for production"], in_production: ["قيد الإنتاج", "In production"], paused: ["متوقف", "Paused"], cancelled: ["ملغي", "Cancelled"], delivered: ["مسلّم", "Delivered"], archived: ["مؤرشف", "Archived"], pending: ["قيد الانتظار", "Pending"], done: ["مكتمل", "Complete"],
  ordersUnit: ["أوامر", "orders"], rollsUnitCount: ["رولات", "rolls"], queueEntries: ["دخول الطابور", "queue entries"], activeLocations: ["مواقع نشطة", "active locations"], balanceUnits: ["أرصدة", "balances"], movementUnits: ["حركات", "movements"], voucherUnits: ["سندات", "vouchers"], secureUnavailable: ["تعذر إنشاء معرّف آمن للعملية. لا تُعد إرسالها يدوياً.", "A secure operation identifier could not be created. Do not resubmit manually."], actorId: ["معرّف المشغل", "Operator ID"], filmActor: ["سجلها", "Registered by"], printActor: ["طبعها", "Printed by"], cutActor: ["قصها", "Cut by"], printDate: ["وقت الطباعة", "Printed at"], cutDate: ["وقت القص", "Cut at"], allRolls: ["كل الرولات المسجلة", "All registered rolls"], noOrderRolls: ["لا توجد رولات مسجلة لهذا الأمر بعد.", "No rolls have been registered for this order yet."],
};
const text = (key: string, language: string) => messages[key]?.[language === "en" ? 1 : 0] ?? key;
const localized = (ar: string | null | undefined, en: string | null | undefined, language: string, fallback = "—") => {
  const a = (ar ?? "").trim(), e = (en ?? "").trim();
  const safeEnglish = /[\u0600-\u06ff]/.test(e) ? "" : e;
  return (language === "en" ? safeEnglish : a || safeEnglish) || fallback;
};
const orderProduct = (order: ProductionOrderRecord, language: string) =>
  localized(order.product?.name_ar, order.product?.name, language, localized(order.product?.customer_name_ar, order.product?.customer_name, language, text("unrecorded", language)));
const customerName = (order: ProductionOrderRecord, language: string) => localized(order.product?.customer_name_ar, order.product?.customer_name, language);
const machineName = (machine: ProductionMachine | undefined, language: string) => machine ? localized(machine.name_ar, machine.name, language, machine.id) : "—";

function useProductionState(allowed: boolean, view: ProductionView) {
  const [snapshot, setSnapshot] = useState<{ view: ProductionView; state: ProductionState } | null>(null);
  const generation = useRef(0);
  const [loading, setLoading] = useState(allowed);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const state = await productionApi.state(view);
      if (request === generation.current) setSnapshot({ view, state });
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : ""); }
    finally { if (request === generation.current) setLoading(false); }
  }, [allowed, view]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (!allowed || (view !== "hall" && view !== "warehouse")) return;
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refreshIfVisible, 15000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshIfVisible); };
  }, [allowed, load, view]);
  return { state: allowed && snapshot?.view === view ? snapshot.state : null, loading, error, reload: load };
}

function Header({ view, language, refreshing, onRefresh, machineSlotRef, children, moduleContext }: { view: ProductionView; language: string; refreshing: boolean; onRefresh: () => void; machineSlotRef: (node: HTMLDivElement | null) => void; children?: ReactNode; moduleContext: "production" | "warehouse" | "planning" }) {
  const isOperatorView = view === "film" || view === "printing" || view === "cutting";
  const heading = moduleContext === "warehouse" ? (language === "en" ? "Warehouse" : "المستودع") : moduleContext === "planning" ? text("planning", language) : text(view, language);
  return <header className={`prod-heading${isOperatorView ? " operator-header" : ""}`}>
    <div className="prod-heading-copy"><div className="prod-eyebrow">MPBF / FLOOR CONTROL</div><h2>{heading}</h2><p>{moduleContext === "warehouse" ? (language === "en" ? "Receiving, finished inventory and movement history." : "الاستلام والمخزون التام وحركاتهما.") : view === "management" ? text("intro", language) : text("title", language)}</p></div>
    <div className="prod-heading-controls">
      <button className="prod-btn quiet prod-header-refresh" data-production-header-refresh onClick={onRefresh} disabled={refreshing}><RefreshCw />{text("reload", language)}</button>
      {children}
      <div className="prod-header-machine-slot" data-production-machine-slot ref={machineSlotRef} />
    </div>
    <div className="prod-mark"><i aria-hidden="true" /><span>ROLL<br />TRACE / 01</span></div>
  </header>;
}
function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="prod-card"><div className="prod-card-head"><h3>{title}</h3>{action}</div><div className="prod-card-body">{children}</div></section>;
}
function ErrorBanner({ message, retry, language }: { message: string; retry?: () => void; language: string }) {
  return <div className="prod-error" role="alert"><span>{message || text("errorGeneric", language)}</span>{retry && <button className="prod-btn quiet" onClick={retry}><RefreshCw />{text("retry", language)}</button>}</div>;
}
function Empty({ title, detail }: { title: string; detail?: string }) {
  return <div className="prod-empty"><strong>{title}</strong>{detail}</div>;
}
function Loading({ language }: { language: string }) {
  return <div className="prod-loading" aria-label={text("loading",language)}><div className="prod-skeleton" /><div className="prod-skeleton" /><div className="prod-skeleton" /></div>;
}
function Metric({ label, value, unit = "kg" }: { label: string; value: string; unit?: string }) {
  return <div className="prod-stat"><span>{label}</span><strong>{value}</strong>{unit !== "kg" && <span>{unit}</span>}</div>;
}

function useWrite(reload: () => Promise<void>, language: string) {
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(""), [uncertain, setUncertain] = useState(false);
  const [warning, setWarning] = useState("");
  const savedOperation = useRef<{ fingerprint: string; requestId: string; action: (requestId: string) => Promise<unknown>; feedback: string; onSuccess?: () => void } | null>(null);
  const savingRef = useRef(false);
  const run = useCallback(async (operation: NonNullable<typeof savedOperation.current>) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true); setError(""); setSuccess(""); setWarning(""); setUncertain(false);
    try {
      if (!operation.requestId) {
        try { operation.requestId = idempotencyKey(); }
        catch { throw new Error(text("secureUnavailable", language)); }
      }
      const result = await operation.action(operation.requestId);
      const uncovered = (result as {mix_tracking?: {uncovered_kg?: string}} | null)?.mix_tracking?.uncovered_kg;
      if (uncovered && Number(uncovered)>0) {
        setWarning(language==="en"
          ? `Roll saved. ${number(uncovered,language)} kg is not covered by recorded mixes. Production is allowed; review mixing records.`
          : `تم حفظ الرول. ${number(uncovered,language)} كجم غير مغطاة بخلطات مسجلة. الإنتاج مسموح؛ راجع سجل الخلط.`);
      }
      window.dispatchEvent(new Event("production-data-changed"));
      operation.onSuccess?.();
      setSuccess(text(operation.feedback, language));
      await reload();
      savedOperation.current = null;
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("errorGeneric", language));
      setUncertain(!confirmedProductionRejection(cause));
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  }, [language, reload]);
  const perform = useCallback(async (payload: unknown, action: (requestId: string) => Promise<unknown>, feedback = "created", onSuccess?: () => void) => {
    const fingerprint = JSON.stringify(payload);
    if (savingRef.current) return false;
    const current = savedOperation.current;
    const operation = current?.fingerprint === fingerprint
      ? { ...current, action, feedback, onSuccess }
      : { fingerprint, requestId: "", action, feedback, onSuccess };
    savedOperation.current = operation;
    return run(operation);
  }, [run]);
  const retry = useCallback(async () => {
    const operation = savedOperation.current;
    if (!operation) return false;
    return run(operation);
  }, [run]);
  const fail = (message: string) => { setError(message); setSuccess(""); setUncertain(false); };
  return { saving, error, success, warning, perform, retry, fail, uncertain };
}

function OrderSummary({ order, language, showFilmDuration = true }: { order: ProductionOrderRecord; language: string; showFilmDuration?: boolean }) {
  return <>
    <div className="prod-order-main">
    <h3><span className="prod-number">{order.production_order_number}</span></h3>
    <div className="prod-order-meta">{text("customerOrder", language)} <span className="prod-number">{order.order_number}</span> · {customerName(order, language)} · {orderProduct(order, language)}</div>
    <div className="prod-chips" style={{ marginTop: 8 }}>
      <span className="prod-chip">{text("customerStatus", language)}: {text(order.order_status,language)}</span>
      <span className="prod-chip warm">{text("productionStatus", language)}: {text(order.status,language)}</span>
      {order.stage && <span className="prod-chip muted">{text("stage", language)}: {text(order.stage,language)}</span>}
    </div>
    {showFilmDuration && <FilmDurationSummary durations={order.film_durations} language={language} />}
    </div>
  </>;
}
function OrderActuals({ order, language }: { order: ProductionOrderRecord; language: string }) {
  if (!order.started_at) return <div className="prod-callout" style={{ gridColumn: "1/-1", margin: 0 }}>{text(canStartFilmProductionOrder(order) ? "filmReadyExplanation" : "historical", language)}</div>;
  return <>
    <div className="prod-measure"><span>{text("planned", language)}</span><strong>{number(order.final_quantity_kg, language)} kg</strong></div>
    <div className="prod-measure"><span>{text("produced", language)}</span><strong>{number(order.produced_kg, language)} kg</strong></div>
    <div className="prod-measure"><span>{text("readyKg", language)} / {text("received", language)}</span><strong>{number(order.ready_kg, language)} / {number(order.received_kg, language)} kg</strong></div>
    <div className="prod-measure"><span>{text("waste", language)}</span><strong>{number(order.waste_kg, language)} kg</strong></div>
    <div className="prod-measure"><span>{text("remaining", language)}</span><strong>{number(order.remaining_kg, language)} kg</strong></div>
  </>;
}

function Management({ state, user, language, reload }: { state: ProductionState; user: ProductionUser; language: string; reload: () => Promise<void> }) {
  const canManage = hasProductionPermission(user, "manage_production");
  const write = useWrite(reload, language);
  const [queueOrder, setQueueOrder] = useState(""), [queueStage, setQueueStage] = useState<ProductionStage>("film"), [queueMachine, setQueueMachine] = useState("");
  const queueDraft = useRef("");
  queueDraft.current = JSON.stringify({ queueOrder, queueStage, queueMachine });
  const machineById = useMemo(() => new Map(state.machines.map(machine => [machine.id, machine])), [state.machines]);
  const activeOrders = state.orders.filter(order => order.started_at);
  const unrecorded = state.orders.filter(order => !order.started_at);
  const assignable = state.orders.filter(order => executableOrder(order.order_status) && !unstartableProductionStatuses.has(order.status));
  const machines = useMemo(() => state.machines.filter(machine => activeMachine(machine) && machineStage(machine.type) === queueStage), [state.machines, queueStage]);
  useEffect(() => { if (!machines.some(machine => machine.id === queueMachine)) setQueueMachine(machines[0]?.id ?? ""); }, [queueStage, state.machines, queueMachine]);
  const start = (order: ProductionOrderRecord) => {
    if (!canManage || !canStartFilmProductionOrder(order)) return;
    if (!window.confirm(text("startConfirm", language))) return;
    void write.perform({ op: "start", order: order.id }, requestId => productionApi.start(order.id, requestId), "started");
  };
  const assign = (event: FormEvent) => {
    event.preventDefault();
    if (!queueOrder || !queueMachine) return;
    const selectedOrder = Number(queueOrder);
    const position = state.queues.filter(queue => queue.stage === queueStage && queue.machine_id === queueMachine).length + 1;
    const submittedDraft = queueDraft.current;
    void write.perform({ op: "queue", order: selectedOrder, stage: queueStage, machine: queueMachine, position },
      requestId => productionApi.queue(selectedOrder, queueStage, queueMachine, position, requestId), "created", () => {
        if (queueDraft.current === submittedDraft) setQueueOrder("");
      });
  };
  const updatePosition = (queueId: number, direction: -1 | 1) => {
    const row = state.queues.find(queue => queue.id === queueId);
    if (!row) return;
    const siblings = state.queues.filter(queue => queue.stage === row.stage && queue.machine_id === row.machine_id).sort((a, b) => a.position - b.position);
    const index = siblings.findIndex(item => item.id === queueId), other = siblings[index + direction];
    if (!other) return;
    const firstPosition = row.position, secondPosition = other.position;
    void write.perform(
      { op: "reorder", first: row.id, second: other.id, firstPosition, secondPosition },
      requestId => productionApi.reorderQueue(row.id, other.id, firstPosition, secondPosition, requestId),
    );
  };
  const remove = (queueId: number) => void write.perform({ op: "removeQueue", id: queueId }, requestId => productionApi.removeQueue(queueId, requestId));
  return <>
    {(write.error || write.success) && (write.error ? <ErrorBanner message={write.error} language={language} retry={() => void write.retry()} /> : <div className="prod-success" role="status">{write.success}</div>)}
    <div className="prod-grid">
      <Metric label={text("order", language)} value={number(state.totals?.orders ?? state.orders.length, language, 0)} unit={text("ordersUnit",language)} />
      <Metric label={text("running", language)} value={number(activeOrders.filter(order => !order.completed_at).length, language, 0)} unit={text("ordersUnit",language)} />
      <Metric label={text("rolls", language)} value={number(state.totals?.rolls ?? state.rolls.length, language, 0)} unit={text("rollsUnitCount",language)} />
      <Metric label={text("queue", language)} value={number(state.queues.length, language, 0)} unit={text("queueEntries",language)} />
    </div>
    <div className="prod-section-title"><h3>{text("started", language)} · {text("order", language)}</h3></div>
    <div className="prod-list">
      {activeOrders.length ? activeOrders.map(order => <article className="prod-order" key={order.id}>
        <OrderSummary order={order} language={language} />
        <OrderActuals order={order} language={language} />
        <div className="prod-measure"><span>{text("filmClosed", language)}</span><strong>{order.film_closed_at ? text("completed", language) : text("running", language)}</strong><small className="prod-muted">{date(order.film_closed_at, language, true)}</small></div>
        <ProductionHistory kind="rolls" title={`${text("allRolls",language)} · ${number(order.roll_count??0,language,0)}`} orderId={order.id} language={language} refresh={state}/>
      </article>) : <Empty title={text("noRows", language)} />}
    </div>
    <div className="prod-section-title"><h3>{text("start", language)} · {text("order", language)}</h3></div>
    <div className="prod-list">
      {unrecorded.length ? unrecorded.map(order => <article className="prod-order" key={order.id}>
        <OrderSummary order={order} language={language} />
        <div className="prod-measure"><span>{text("planned", language)}</span><strong>{number(order.final_quantity_kg, language)} kg</strong></div>
        <div className="prod-measure"><span>{text("produced", language)}</span><strong>{text("unrecorded", language)}</strong></div>
        <div className="prod-measure"><span>{text("productionStatus", language)}</span><strong>{text(order.status,language)}</strong></div>
        {canManage && canStartFilmProductionOrder(order) && <button className="prod-btn" disabled={write.saving} onClick={() => start(order)}><Factory />{text("start", language)}</button>}
      </article>) : <Empty title={text("noRows", language)} />}
    </div>
    <ProductionHistory kind="orders" title={language==="en"?"Order history":"تاريخ أوامر الإنتاج"} language={language} refresh={state}/>
    <ProductionHistory kind="rolls" title={text("allRolls",language)} language={language} refresh={state}/>
    <Card title={text("queue", language)}>
      {canManage ? <form onSubmit={assign} className="prod-form-grid">
        <div className="prod-field"><label htmlFor="queue-order">{text("order", language)}</label><select id="queue-order" required value={queueOrder} onChange={event => setQueueOrder(event.target.value)}><option value="">{text("chooseOrder", language)}</option>{assignable.map(order => <option key={order.id} value={order.id}>{order.production_order_number} · {order.order_number}</option>)}</select></div>
        <div className="prod-field"><label htmlFor="queue-stage">{text("stageSelect", language)}</label><select id="queue-stage" value={queueStage} onChange={event => setQueueStage(event.target.value as ProductionStage)}><option value="film">{text("film", language)}</option><option value="printing">{text("printing", language)}</option><option value="cutting">{text("cutting", language)}</option></select></div>
        <div className="prod-field"><label htmlFor="queue-machine">{text("machine", language)}</label><select id="queue-machine" required value={queueMachine} onChange={event => setQueueMachine(event.target.value)}><option value="">{text("chooseMachine", language)}</option>{machines.map(machine => <option key={machine.id} value={machine.id}>{machineName(machine, language)} · {machine.id}</option>)}</select></div>
        <div className="prod-savebar"><button className="prod-btn" type="submit" disabled={write.saving || !queueMachine}><Plus />{text("assign", language)}</button></div>
      </form> : <div className="prod-muted">{text("readonly", language)}</div>}
      <div className="prod-section-title"><h3>{text("queueList", language)}</h3></div>
      {state.queues.length ? <div className="prod-table-wrap"><table className="prod-table"><thead><tr><th>{text("stageSelect", language)}</th><th>{text("machine", language)}</th><th>{text("order", language)}</th><th>{text("position", language)}</th><th /></tr></thead><tbody>{[...state.queues].sort((a,b)=>a.stage.localeCompare(b.stage)||a.machine_id.localeCompare(b.machine_id)||a.position-b.position).map((queue,index) => {
        const siblings = state.queues.filter(item => item.stage === queue.stage && item.machine_id === queue.machine_id).sort((a,b)=>a.position-b.position);
        const order = state.orders.find(item => item.id === queue.production_order_id);
        return <tr key={queue.id}><td>{text(queue.stage,language)}</td><td>{machineName(machineById.get(queue.machine_id),language)}</td><td>{order?.production_order_number ?? queue.production_order_id}</td><td>{queue.position}</td><td><div className="prod-inline">{canManage && <><button className="prod-btn quiet" aria-label={text("up",language)} disabled={write.saving || siblings[0]?.id === queue.id} onClick={() => updatePosition(queue.id,-1)}><ArrowUp /></button><button className="prod-btn quiet" aria-label={text("down",language)} disabled={write.saving || siblings.at(-1)?.id === queue.id} onClick={() => updatePosition(queue.id,1)}><ArrowDown /></button><button className="prod-btn danger" disabled={write.saving} onClick={() => remove(queue.id)}><X />{text("remove",language)}</button></>}</div></td></tr>;
      })}</tbody></table></div> : <Empty title={text("noQueue",language)} />}
    </Card>
  </>;
}

function MachinePicker({ userId, stage, machines, language, selected, onSelect }: { userId:number;stage:ProductionStage;machines:ProductionMachine[];language:string;selected:string;onSelect:(id:string)=>void }) {
  const [changing,setChanging] = useState(false);
  const storageKey = `mpbf-production-machine:${userId}:${stage}`;
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && machines.some(machine => machine.id === saved)) onSelect(saved);
    else if (machines.length) { window.localStorage.setItem(storageKey, machines[0].id); onSelect(machines[0].id); }
  }, [storageKey, machines, onSelect]);
  const select = (id: string) => {
    window.localStorage.setItem(storageKey,id); onSelect(id); setChanging(false);
  };
  const chosen = machines.find(machine => machine.id === selected);
  if (!machines.length) return <div className="prod-callout">{text("noMachine",language)}</div>;
  if (chosen && !changing) return <div className="prod-inline"><span className="prod-chip">{text("machine",language)}: {machineName(chosen,language)} · {chosen.id}</span><button className="prod-btn quiet" onClick={() => setChanging(true)}><Settings2 />{text("changeMachine",language)}</button></div>;
  return <div className="prod-field"><label htmlFor={`machine-${stage}`}>{text("chooseMachine",language)}</label><select id={`machine-${stage}`} value={selected} onChange={event=>select(event.target.value)}>{machines.map(machine=><option key={machine.id} value={machine.id}>{machineName(machine,language)} · {machine.id}</option>)}</select></div>;
}

function OperatorBoard({ state,user,stage,language,reload,machineSlot }: {state:ProductionState;user:ProductionUser;stage:ProductionStage;language:string;reload:()=>Promise<void>;machineSlot:HTMLDivElement|null}) {
  const permission = stage === "film" ? "operate_film" : stage === "printing" ? "operate_printing" : "operate_cutting";
  const canOperate = hasProductionPermission(user,permission);
  const write=useWrite(reload,language);
  const [selectedMachine,setSelectedMachine]=useState("");
  const [weights,setWeights]=useState<Record<number,string>>({});
  const [last,setLast]=useState<Record<number,boolean>>({});
  const [inline,setInline]=useState<Record<number,boolean>>({});
  const operatorDraft = useRef({ weights, last, inline, selectedMachine });
  operatorDraft.current = { weights, last, inline, selectedMachine };
  const filmDraft = (id:number) => {
    const current = operatorDraft.current;
    return JSON.stringify({ weight:current.weights[id]??"", last:!!current.last[id], inline:!!current.inline[id], machine:current.selectedMachine });
  };
  const machines=useMemo(()=>state.machines.filter(machine=>activeMachine(machine)&&machineStage(machine.type)===stage),[state.machines,stage]);
  const priority = (id:number) => state.queues.find(queue => queue.production_order_id===id&&queue.stage===stage&&queue.machine_id===selectedMachine)?.position ?? Number.MAX_SAFE_INTEGER;
  const orders=stage==="film" ? state.orders.filter(order=>!!order.started_at&&!order.film_closed_at&&executableOrder(order.order_status)).sort((a,b)=>priority(a.id)-priority(b.id)||a.id-b.id) : [];
  const readyFilmOrders=stage==="film" ? state.orders.filter(canStartFilmProductionOrder) : [];
  const printRolls=stage==="printing" ? state.rolls.filter(roll=>roll.is_printed&&!roll.printed_at&&roll.stage!=="done") : [];
  const executableParentIds = useMemo(()=>new Set(state.orders.filter(order => executableOrder(order.order_status)).map(order => order.id)),[state.orders]);
  const printRollsEligible=printRolls.filter(roll=>executableParentIds.has(roll.production_order_id));
  const cutRolls=stage==="cutting" ? state.rolls.filter(roll=>eligibleForCutting(roll)&&executableParentIds.has(roll.production_order_id)) : [];
  const rolls=(stage==="printing"?printRollsEligible:cutRolls).sort((a,b)=>priority(a.production_order_id)-priority(b.production_order_id)||a.id-b.id);
  const inlinePrinter=(machineId:string)=>{
    const linkedId=machines.find(machine=>machine.id===machineId)?.inline_printer_id;
    return linkedId&&state.machines.some(machine=>machine.id===linkedId&&activeMachine(machine)&&machineStage(machine.type)==="printing");
  };
  const recordFilm=(order:ProductionOrderRecord)=>{
    const weight=latinDigits(weights[order.id]??"").trim();
    if(!Number.isFinite(Number(weight))||Number(weight)<=0){write.fail(text("enterPositive",language));return;}
    const input:FilmInput={request_id:"",machine_id:selectedMachine,weight_kg:weight,is_last_roll:!!last[order.id],inline_printed:!!inline[order.id]};
    const submittedDraft = filmDraft(order.id);
    void write.perform({op:"film",order:order.id,weight,machine:selectedMachine,last:!!last[order.id],inline:!!inline[order.id]},requestId=>productionApi.film(order.id,{...input,request_id:requestId}),"created",()=>{
      if(filmDraft(order.id)!==submittedDraft)return;
      setWeights(values=>({...values,[order.id]:""}));setLast(values=>({...values,[order.id]:false}));setInline(values=>({...values,[order.id]:false}));
    });
  };
  const recordRoll=(roll:ProductionRollRecord)=>{
    if(stage==="printing") void write.perform({op:"print",roll:roll.id,machine:selectedMachine},requestId=>productionApi.print(roll.id,selectedMachine,requestId));
    else {
      const net=latinDigits(weights[roll.id]??"").trim();
      if(!Number.isFinite(Number(net))||Number(net)<=0||Number(net)>Number(roll.weight_kg)){write.fail(text("enterPositive",language));return;}
      const submittedWeight=weights[roll.id]??"", submittedMachine=selectedMachine;
      void write.perform({op:"cut",roll:roll.id,machine:selectedMachine,net},requestId=>productionApi.cut(roll.id,selectedMachine,net,requestId),"created",()=>{
        if((operatorDraft.current.weights[roll.id]??"")===submittedWeight&&operatorDraft.current.selectedMachine===submittedMachine)setWeights(values=>({...values,[roll.id]:""}));
      });
    }
  };
  const startFilm=(order:ProductionOrderRecord)=>{
    if(!canOperate||!canStartFilmProductionOrder(order)) return;
    if(!window.confirm(text("startConfirm",language))) return;
    void write.perform({op:"start",order:order.id},requestId=>productionApi.start(order.id,requestId).catch(async error=>{
      await reload();
      throw error;
    }),"started");
  };
  const machinePicker=<MachinePicker userId={user.id} stage={stage} machines={machines} language={language} selected={selectedMachine} onSelect={setSelectedMachine}/>;
  return <>
    {(write.error||write.success)&&(write.error?<ErrorBanner message={write.error} language={language} retry={()=>void write.retry()}/>:<div className="prod-success" role="status">{write.success}</div>)}
    {write.warning && <div className="prod-callout" role="status">{write.warning}</div>}
    {machineSlot&&createPortal(machinePicker,machineSlot)}
    {!canOperate&&<div className="prod-callout" style={{marginTop:14}}>{text("readonly",language)}</div>}
    {stage==="film" ? <FilmOperatorOrders
      orders={[...orders,...readyFilmOrders].sort((a,b)=>priority(a.id)-priority(b.id)||a.id-b.id)}
      rolls={state.rolls}
      readyIds={new Set(readyFilmOrders.map(order=>order.id))}
      language={language} canOperate={canOperate} saving={write.saving} selectedMachine={selectedMachine}
      weights={weights} last={last} inline={inline} inlinePrinterAvailable={!!inlinePrinter(selectedMachine)}
      text={key=>text(key,language)} number={value=>formatWholeNumber(value==null?value:latinDigits(String(value)))}
      productName={order=>orderProduct(order,language)}
      creatorName={roll=>productionActorName(roll.created_actor,roll.created_by,language)} date={value=>date(value,language)}
      onWeight={(id,value)=>setWeights(values=>({...values,[id]:value}))}
      onLast={(id,value)=>setLast(values=>({...values,[id]:value}))}
      onInline={(id,value)=>setInline(values=>({...values,[id]:value}))}
      onRecord={recordFilm} onStart={startFilm}
    />:
    <RollOperatorOrders
      key={stage}
      stage={stage} orders={state.orders} rolls={rolls} language={language}
      canOperate={canOperate} saving={write.saving} selectedMachine={selectedMachine} weights={weights}
      text={key=>text(key,language)}
      number={value=>formatWholeNumber(value==null?value:latinDigits(String(value)))}
      productName={order=>orderProduct(order,language)}
      creatorName={roll=>productionActorName(roll.created_actor,roll.created_by,language)} date={value=>date(value,language)}
      onWeight={(id,value)=>setWeights(values=>({...values,[id]:value}))} onRecord={recordRoll}
    />}
  </>;
}

const emptyDraft = (orderId=""):ReceiptDraft=>({orderId,quantity:"",unit:"kg",count:"",method:"unit_weight",unitWeight:"1",pieces:"",pieceWeight:""});
const kgHundredths=(value:string|number|null|undefined):bigint=>{
  const raw=latinDigits(String(value??""));
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return 0n;
  const [whole,fraction=""]=raw.split(".");
  return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
};
function Hall({state,user,language,reload}:{state:ProductionState;user:ProductionUser;language:string;reload:()=>Promise<void>}) {
  const canReceive=hasProductionPermission(user,"receive_production"), write=useWrite(reload,language);
  const [drafts,setDrafts]=useState<ReceiptDraft[]>([emptyDraft()]),[notes,setNotes]=useState(""),[selected,setSelected]=useState<number[]>([]);
  const [receiptOpen,setReceiptOpen]=useState(false),[savedReceipt,setSavedReceipt]=useState<ProductionReceipt|null>(null),[formError,setFormError]=useState("");
  const receiptOpener=useRef<HTMLButtonElement|null>(null);
  const closeReceipt=useCallback(()=>setReceiptOpen(false),[]);
  const receiptDraft=useRef("");
  receiptDraft.current=JSON.stringify({drafts,notes});
  const eligible=state.orders.filter(order=>Number(order.remaining_kg)>0);
  const addLine=()=>{setSavedReceipt(null);setDrafts(rows=>rows.length<100?[...rows,emptyDraft()]:rows);};
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    if(drafts.length>100){setFormError(language==="en"?"A voucher can contain at most 100 lines.":"يمكن أن يحتوي السند على 100 سطر كحد أقصى.");return;}
    const normalized=drafts.map(row=>({...row,count:latinDigits(row.count),unitWeight:latinDigits(row.unitWeight),pieces:latinDigits(row.pieces),pieceWeight:latinDigits(row.pieceWeight)}));
    const calculated=normalized.map(row=>{
      try {
        const packing:ReceiptPacking=row.unit==="kg"?{unit:"kg",method:"unit_weight",quantity:row.count}
          :row.method==="unit_weight"?{unit:row.unit,method:row.method,quantity:row.count,unit_weight_kg:row.unitWeight}
          :{unit:row.unit,method:row.method,quantity:row.count,pieces_per_unit:Number(row.pieces),piece_weight_grams:row.pieceWeight};
        return {packing,result:calculatePacking(packing)};
      } catch { return null; }
    });
    const invalidLine=normalized.findIndex((row,index)=>!row.orderId||!calculated[index]);
    if(invalidLine>=0){setFormError(language==="en"?`Complete every field in line ${invalidLine+1} before saving.`:`أكمل جميع حقول السطر ${invalidLine+1} قبل الحفظ.`);return;}
    const totalsByOrder=new Map<string,bigint>();
    normalized.forEach((row,index)=>totalsByOrder.set(row.orderId,(totalsByOrder.get(row.orderId)??0n)+kgHundredths(calculated[index]!.result.quantity_kg)));
    const exceeded=[...totalsByOrder].find(([orderId,total])=>total>kgHundredths(eligible.find(order=>String(order.id)===orderId)?.remaining_kg));
    if(exceeded){const order=eligible.find(item=>String(item.id)===exceeded[0]);setFormError(language==="en"?`Receipt quantity exceeds the available ${order?.production_order_number??"order"} balance.`:`كمية الاستلام تتجاوز المتاح للأمر ${order?.production_order_number??""}.`);return;}
    setFormError("");
    const items=normalized.map((row,index)=>({
      production_order_id:Number(row.orderId),
      quantity_kg:calculated[index]!.result.quantity_kg,packing:calculated[index]!.packing,
    }));
    const input:ReceiptInput={request_id:"",notes:notes.trim()||undefined,items};
    const submittedDraft=receiptDraft.current;
    void write.perform({op:"receive",items,notes:input.notes},async requestId=>{
      const receipt=await productionApi.receive({...input,request_id:requestId}) as ProductionReceipt;
      setSavedReceipt(receipt);
      return receipt;
    },"receiptCreated",()=>{
      if(receiptDraft.current===submittedDraft){setDrafts([emptyDraft()]);setNotes("");setSelected([]);}
    });
  };
  const setRow=(index:number,key:keyof ReceiptDraft,value:string)=>{setSavedReceipt(null);setFormError("");setDrafts(rows=>rows.map((row,i)=>i===index?{...row,[key]:value,...(key==="unit"&&value==="kg"?{method:"unit_weight",unitWeight:"1",pieces:"",pieceWeight:""}:{}),...(key==="unit"&&value!=="kg"&&row.unit==="kg"?{unitWeight:""}:{})}:row));};
  const readyOrders=eligible.filter(order=>Number(order.ready_kg)>0||Number(order.received_kg)>0);
  const lockReceipt=write.uncertain;
  const receiveSelected=()=>{
    const ids=selected.filter(id=>eligible.some(order=>order.id===id));
    if(!ids.length)return;
    const dirty=drafts.some(row=>row.orderId||row.count||row.unit!=="kg"||row.method!=="unit_weight"||row.unitWeight!=="1"||row.pieces||row.pieceWeight)||Boolean(notes);
    const draftIds=new Set(drafts.map(row=>Number(row.orderId)).filter(Boolean));
    if(dirty&&ids.length===draftIds.size&&ids.every(id=>draftIds.has(id))){setReceiptOpen(true);return;}
    if(dirty&&!window.confirm(language==="en"?"Replace the unsaved receipt draft with the selected orders?":"استبدال مسودة سند الاستلام غير المحفوظة بالأوامر المحددة؟"))return;
    setDrafts(ids.map(id=>emptyDraft(String(id))));setNotes("");setSavedReceipt(null);setFormError("");setReceiptOpen(true);
  };
  const setSelectedOrder=(id:number,checked:boolean)=>setSelected(items=>checked?[...new Set([...items,id])]:items.filter(value=>value!==id));
  return <>
    {(write.error||write.success)&&(write.error?<ErrorBanner message={write.error} language={language} retry={()=>void write.retry()}/>:<div className="prod-success" role="status">{write.success}</div>)}
    <div className="prod-grid"><Metric label={text("eligibleWeight",language)} value={`${number(eligible.reduce((total,order)=>total+Number(order.remaining_kg),0),language)} kg`}/><Metric label={text("order",language)} value={number(eligible.length,language,0)} unit={text("ordersUnit",language)}/><Metric label={text("vouchers",language)} value={number(state.totals?.receipts??0,language,0)} unit={text("voucherUnits",language)}/></div>
    <section className="warehouse-hall-section">
      <div className="warehouse-section-heading"><div><span className="warehouse-section-kicker">CUTTING → RECEIVING</span><h3>{text("readyOrders",language)}</h3></div><span>{number(readyOrders.length,language,0)} {text("ordersUnit",language)}</span></div>
      {readyOrders.length ? <div className="warehouse-hall-grid">
        {readyOrders.map(order=>{
          const complete=Boolean(order.completed_at);
          return <article className="warehouse-order-card" key={order.id}>
            <header><div><span className="warehouse-order-number">{order.production_order_number}</span><small>{order.order_number}</small></div><span className={`warehouse-order-state${complete?" complete":""}`} title={`${text("productionStatus",language)}: ${text(complete?"productionComplete":"productionIncomplete",language)}`} aria-label={`${text("productionStatus",language)}: ${text(complete?"productionComplete":"productionIncomplete",language)}`}>{text(complete?"completed":"incomplete",language)}</span></header>
            <div className="warehouse-order-product"><strong>{orderProduct(order,language)}</strong><span>{customerName(order,language)}</span></div>
            {canReceive&&<label className="warehouse-order-select"><input type="checkbox" data-hall-select={order.id} checked={selected.includes(order.id)} disabled={write.saving||lockReceipt} onChange={event=>setSelectedOrder(order.id,event.target.checked)}/><span>{language==="en"?"Select for receipt":"تحديد للاستلام"}</span></label>}
            <div className="warehouse-order-metrics">
              <div><span>{text("readyKg",language)}</span><strong>{number(order.ready_kg,language)} <small>kg</small></strong></div>
              <div><span>{text("received",language)}</span><strong>{number(order.received_kg,language)} <small>kg</small></strong></div>
              <div className="remaining"><span>{text("remaining",language)}</span><strong>{number(order.remaining_kg,language)} <small>kg</small></strong></div>
            </div>
          </article>;
        })}
      </div> : <Empty title={text("noEligible",language)}/>}
    </section>
     <Card title={text("receiveBatch",language)} action={canReceive?<div className="warehouse-receipt-actions"><button data-receipt-launcher className="prod-btn" type="button" disabled={write.saving||lockReceipt} onClick={event=>{receiptOpener.current=event.currentTarget;setFormError("");setReceiptOpen(true);}}>{language==="en"?"New receipt voucher":"سند استلام مواد تامة"}</button><button className="prod-btn secondary" data-hall-receive-selected type="button" disabled={!selected.length||write.saving||lockReceipt} onClick={event=>{receiptOpener.current=event.currentTarget;receiveSelected();}}>{language==="en"?`Receive selected (${selected.length})`:`استلام المحدد (${selected.length})`}</button><button className="prod-btn quiet" type="button" disabled={!selected.length||write.saving||lockReceipt} onClick={()=>setSelected([])}>{language==="en"?"Clear selection":"مسح التحديد"}</button></div>:undefined}>
      {canReceive ? <>{eligible.length===0&&<div className="prod-section-title"><Empty title={text("noEligible",language)}/></div>}</>:<div className="prod-muted">{text("readonly",language)}</div>}
    </Card>
    {canReceive&&receiptOpen&&<ReceiptVoucherModal
      language={language}
      eligible={eligible}
      drafts={drafts}
      notes={notes}
      saving={write.saving}
      locked={lockReceipt}
      error={formError||write.error}
      savedReceipt={savedReceipt}
      openerRef={receiptOpener}
      onDraftChange={setRow}
      onAddLine={addLine}
      onRemoveLine={index=>{setSavedReceipt(null);setFormError("");setDrafts(rows=>rows.filter((_,i)=>i!==index));}}
      onNotesChange={value=>{setSavedReceipt(null);setFormError("");setNotes(value);}}
      onSubmit={submit}
      onRetry={write.error&&!formError?()=>void write.retry():undefined}
      onClose={closeReceipt}
      orderLabel={order=>orderProduct(order,language)}
      customerLabel={order=>customerName(order,language)}
      number={number}
    />}
  </>;
}

function Warehouse({state,language}:{state:ProductionState;language:string}) {
  const locations=state.locations;
  return <>
    <div className="prod-grid"><Metric label={text("balances",language)} value={number(state.totals?.inventory??0,language,0)} unit={text("balanceUnits",language)}/><Metric label={text("movements",language)} value={number(state.totals?.movements??0,language,0)} unit={text("movementUnits",language)}/><Metric label={text("vouchers",language)} value={number(state.totals?.receipts??0,language,0)} unit={text("voucherUnits",language)}/></div>
    <Metric label={language==="en"?"Total inventory weight":"إجمالي وزن المخزون"} value={`${number(state.totals?.inventory_kg??0,language)} kg`}/>
     <section className="warehouse-finished-view">
       <ProductionHistory kind="inventory" title={text("balances",language)} language={language} locations={locations} refresh={state} defaultOpen presentation="cards"/>
     </section>
     <ProductionHistory kind="receipts" title={text("vouchers",language)} language={language} locations={locations} refresh={state} presentation="cards"/>
    <ProductionHistory kind="movements" title={text("movements",language)} language={language} locations={locations} refresh={state}/>
  </>;
}

function HallView({state,user,language,reload}:{state:ProductionState;user:ProductionUser;language:string;reload:()=>Promise<void>}) {
  const permission=hasProductionPermission(user,"view_production_hall","receive_production");
  if(!permission)return <Empty title={text("permission",language)}/>;
  return <Hall state={state} user={user} language={language} reload={reload}/>;
}
function RollDetail({rollId,user,language,state,moduleContext}:{rollId:string;user:ProductionUser;language:string;state:ProductionState|null;moduleContext:"production"|"warehouse"}) {
  const [roll,setRoll]=useState<ProductionRollDetail|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[qr,setQr]=useState(""),[qrUrl,setQrUrl]=useState("");
  const [attempt,setAttempt]=useState(0);
  const allowed=moduleContext === "warehouse"
    ? canOpenWarehouseView(user,"hall") || canOpenWarehouseView(user,"warehouse")
    : hasProductionPermission(user,"view_production","manage_production","operate_film","operate_printing","operate_cutting","view_production_hall","receive_production","view_finished_inventory","manage_finished_warehouse");
  useEffect(()=>{let alive=true; if(!allowed){setLoading(false);return;}setLoading(true);productionApi.roll(rollId).then(value=>{if(alive){setRoll(value);setError("");}}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:text("unknownRoll",language));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[allowed,rollId,language,attempt]);
  useEffect(()=>{let alive=true;setQr("");setQrUrl("");if(!roll)return;void productionApi.qr(roll.id).then(value=>{if(alive){setQr(value.image);setQrUrl(value.url);}}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:text("errorGeneric",language));});return()=>{alive=false;};},[roll,language]);
  if(!allowed)return <Empty title={text("permission",language)}/>;
  if(loading)return <Loading language={language}/>;
  if(error)return <ErrorBanner message={error} language={language} retry={()=>setAttempt(value=>value+1)}/>;
  if(!roll)return <Empty title={text("unknownRoll",language)}/>;
  const machineById=new Map((state?.machines??[]).map(machine=>[machine.id,machine]));
  const parent=state?.orders.find(order=>order.id===roll.production_order_id);
  return <div className="prod-roll-detail"><Card title={`${text("roll",language)} · ${roll.roll_number}`}>
    <div className="prod-detail-pairs">
      <div><span>{text("order",language)}</span><strong className="prod-number">{roll.production_order_number}</strong></div>
      <div><span>{text("customerOrder",language)}</span><strong>{roll.order_number??parent?.order_number??"—"}</strong></div>
      <div><span>{text("customerStatus",language)}</span><strong>{text(roll.order_status??parent?.order_status??"—",language)}</strong></div>
      <div><span>{text("productionStatus",language)}</span><strong>{text(roll.production_order_status??parent?.status??"—",language)}</strong></div>
      <div><span>{text("stage",language)}</span><strong>{text(roll.production_stage??parent?.stage??"—",language)}</strong></div>
      <div><span>{text("batch",language)}</span><strong>{roll.batch_number??parent?.batch_number??"—"}</strong></div>
      <div><span>{text("product",language)}</span><strong>{localized(roll.product.name_ar,roll.product.name,language)}</strong></div>
      <div><span>{language==="en"?"Customer":"العميل"}</span><strong>{localized(roll.product.customer_name_ar,roll.product.customer_name,language)}</strong></div>
      <div><span>{text("weight",language)}</span><strong>{number(roll.weight_kg,language)} kg</strong></div>
      <div><span>{text("rollStage",language)}</span><strong>{text(roll.stage,language)}</strong></div>
      <div><span>{text("createdAt",language)}</span><strong>{date(roll.created_at,language,true)}</strong></div>
      <div><span>{text("filmActor",language)}</span><strong>{productionActorName(roll.created_actor,roll.created_by,language)}</strong><small className="prod-muted">{text("actorId",language)}: {roll.created_by===null?text("unrecorded",language):`#${roll.created_by}`}</small></div>
      <div><span>{text("filmMachine",language)}</span><strong>{machineName(machineById.get(roll.film_machine_id),language)}</strong></div>
      <div><span>{text("printActor",language)}</span><strong>{productionActorName(roll.printed_actor,roll.printed_by,language)}</strong><small className="prod-muted">{text("actorId",language)}: {roll.printed_by===null?text("unrecorded",language):`#${roll.printed_by}`}</small></div>
      <div><span>{text("printDate",language)}</span><strong>{date(roll.printed_at,language,true)}</strong></div>
      <div><span>{text("printMachine",language)}</span><strong>{machineName(roll.printing_machine_id?machineById.get(roll.printing_machine_id):undefined,language)}</strong></div>
      <div><span>{text("cutActor",language)}</span><strong>{productionActorName(roll.cut_actor,roll.cut_by,language)}</strong><small className="prod-muted">{text("actorId",language)}: {roll.cut_by===null?text("unrecorded",language):`#${roll.cut_by}`}</small></div>
      <div><span>{text("cutDate",language)}</span><strong>{date(roll.cut_completed_at,language,true)}</strong></div>
      <div><span>{text("cutMachine",language)}</span><strong>{machineName(roll.cutting_machine_id?machineById.get(roll.cutting_machine_id):undefined,language)}</strong></div>
      <div><span>{text("net",language)}</span><strong>{roll.net_weight_kg?`${number(roll.net_weight_kg,language)} kg`:"—"}</strong></div>
      <div><span>{text("waste",language)}</span><strong>{number(roll.waste_kg,language)} kg</strong></div>
    </div>
    <FilmDurationSummary durations={roll.film_duration ? [roll.film_duration] : []} language={language} />
    <div className="prod-savebar"><RollLabelControls rolls={[roll]} language={language} single /></div>
  </Card><aside className="prod-qr"><strong>{text("qr",language)}</strong>{qr?<img src={qr} alt={text("qr",language)}/>:<div className="prod-skeleton" style={{height:190,marginTop:12}}/>}<small>{qrUrl}</small></aside></div>;
}

export default function ProductionPage({user,view,rollId,moduleContext="production"}:ProductionPageProps) {
  const {i18n}=useTranslation();
  const language=i18n.language==="en"?"en":"ar";
  const [machineSlot,setMachineSlot]=useState<HTMLDivElement|null>(null);
  const allowed = moduleContext === "planning"
    ? view === "management" && canOpenPlanningView(user, "management")
    : moduleContext === "warehouse"
    ? view === "roll"
      ? canOpenWarehouseView(user,"hall") || canOpenWarehouseView(user,"warehouse")
      : (view === "hall" || view === "warehouse") && canOpenWarehouseView(user,view)
    : view !== "management" && canOpenProductionView(user, view);
  const visibleViews = moduleContext === "planning" ? availablePlanningViews(user) : moduleContext === "warehouse" ? availableWarehouseViews(user) : availableProductionViews(user);
  const returnPath = moduleContext === "warehouse" ? initialWarehousePath(user) : null;
  const data=useProductionState(allowed,view);
  const state=data.state;
  return <section className={`production production-app${moduleContext === "planning" ? " planning-page" : ""}`}>
    {moduleContext === "planning" ? <>
      <PlanningHeader title={text("planning", language)} description={text("intro", language)} refreshLabel={text("reload", language)} onRefresh={() => void data.reload()} refreshing={data.loading} />
      <PlanningNavigation label={text("planning", language)} tabs={visibleViews.map(({ view: destination, href }) => ({ href, label: text(destination, language), active: view === destination }))} />
    </> : <>
      <Header view={view} language={language} refreshing={data.loading} onRefresh={()=>void data.reload()} machineSlotRef={setMachineSlot} moduleContext={moduleContext}>
        {moduleContext === "production" && view!=="management"&&canOpenPlanningView(user,"management")&&<Link className="prod-btn secondary" href="/planning"><ChevronRight/>{text("goManagement",language)}</Link>}
        {moduleContext === "warehouse" && view === "roll" && returnPath && <Link className="prod-btn secondary" href={returnPath}><ChevronRight/>{language==="en"?"Back to warehouse":"العودة إلى المستودع"}</Link>}
      </Header>
      <nav className="prod-view-nav" aria-label={moduleContext === "warehouse" ? (language === "en" ? "Warehouse" : "المستودع") : text("title",language)}>
        {visibleViews.map(({view: destination,href})=>
          <Link key={destination} href={href} className={`prod-btn ${view===destination?"":"secondary"}`} aria-current={view===destination?"page":undefined}>{text(destination,language)}</Link>
        )}
      </nav>
    </>}
      {!allowed?<Empty title={text("permission",language)}/>:view==="roll"?<>{data.error&&<ErrorBanner message={data.error} retry={()=>void data.reload()} language={language}/>}<RollDetail rollId={rollId??""} user={user} language={language} state={state} moduleContext={moduleContext === "warehouse" ? "warehouse" : "production"}/></>:data.loading&&!state?<Loading language={language}/>:data.error&&!state?<ErrorBanner message={data.error||text("failedLoad",language)} retry={()=>void data.reload()} language={language}/>:!state?<ErrorBanner message={text("failedLoad",language)} retry={()=>void data.reload()} language={language}/>:
      <>
        {data.error&&<ErrorBanner message={data.error} retry={()=>void data.reload()} language={language}/>}
        {view==="management"&&<Management state={state} user={user} language={language} reload={data.reload}/>}
        {(view==="film"||view==="printing"||view==="cutting")&&<OperatorBoard state={state} user={user} stage={view} language={language} reload={data.reload} machineSlot={machineSlot}/>}
        {view==="hall"&&<HallView state={state} user={user} language={language} reload={data.reload}/>}
        {view==="warehouse"&&<Warehouse state={state} language={language}/>}
        <RollLabelControls refresh={state} language={language} />
      </>}
  </section>;
}
