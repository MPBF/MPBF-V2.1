import i18n, { intlLocale, localizedName, translate } from "../i18n";
import { AlertCircle, CalendarDays, ChevronDown, ChevronUp, Factory, FileText, Printer, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { displayValue, fetchOrderDetails, fieldLabel, formatOrderDate, numberText, orderStatusLabel, personName, productionStatusLabel, type OrderDetailsError } from "../lib/order-details";
import "./OrderDetailsModal.css";
import OrderProductionReleaseButton from "./OrderProductionReleaseButton";
import MasterBatchSwatch from "./MasterBatchSwatch";

type Props = { id: number; onClose: () => void; onPrint: () => void; canRelease?: boolean; onOrderChanged?: () => void };
type LoadState = { status: "loading" } | { status: "error"; message: string; notFound: boolean } | { status: "ready"; data: Awaited<ReturnType<typeof fetchOrderDetails>> };

const orderFieldLabels: Record<string, string> = {
  id: "معرّف الطلب", order_number: "رقم الطلب", customer_id: "معرّف العميل", delivery_days: "مدة التسليم (يوم)",
  status: "الحالة", previous_status: "الحالة السابقة", notes: "ملاحظات الطلب", created_by: "معرّف المنشئ",
  created_at: "تاريخ الإنشاء", delivery_date: "تاريخ التسليم",
};

const productFieldLabels: Record<string, string> = {
  id: "رقم المنتج", customer_id: "معرّف العميل", category_id: "معرّف الفئة", item_id: "معرّف الصنف",
  size_caption: "وصف المقاس", width: "العرض", left_facing: "واجهة يسار", right_facing: "واجهة يمين",
  thickness: "السماكة الداخلية", universal_thickness: "السماكة العامة (MIC)", density: "الكثافة",
  bag_weight_grams: "وزن الكيس (غرام)", bags_per_kilo: "عدد الأكياس/كجم", printing_cylinder: "السلندر",
  cutting_length_cm: "طول القص (سم)", raw_material: "المادة الخام", master_batch_id: "معرّف اللون",
  is_printed: "مطبوعة", cutting_unit: "وحدة القص", punching: "التخريم", unit_weight_kg: "وزن الوحدة (كجم)",
  unit_quantity: "عدد الوحدات", package_weight_kg: "وزن العبوة (كجم)", cliche_front_design: "تصميم الكليشيه الأمامي",
  cliche_back_design: "تصميم الكليشيه الخلفي", front_print_colors: "ألوان الطباعة الأمامية",
  back_print_colors: "ألوان الطباعة الخلفية", notes: "ملاحظات المنتج", status: "حالة المنتج", created_at: "تاريخ إنشاء المنتج",
};

const productionFieldLabels: Record<string, string> = {
  id: "رقم سجل الإنتاج", production_order_number: "رقم أمر الإنتاج", order_id: "رقم الطلب",
  customer_product_id: "معرّف المنتج", quantity_kg: "الكمية المطلوبة (كجم)", overrun_percentage: "نسبة الزيادة",
  final_quantity_kg: "الكمية المخططة بعد الزيادة (كجم)", status: "حالة الإنتاج", previous_status: "الحالة السابقة",
  batch_number: "رقم التشغيلة", created_at: "تاريخ الإنشاء",
};

function DetailFields({ data, labels, omit = [] }: { data: Record<string, unknown>; labels: Record<string, string>; omit?: string[] }) {
  const numericFields = new Set(["quantity_kg", "final_quantity_kg", "width", "left_facing", "right_facing", "thickness", "universal_thickness", "density", "bag_weight_grams", "bags_per_kilo", "cutting_length_cm", "unit_weight_kg", "unit_quantity", "package_weight_kg", "delivery_days"]);
  const statusLabel = labels.status === "حالة الإنتاج" ? productionStatusLabel : orderStatusLabel;
  return <dl className="odm-fields">{Object.entries(data).filter(([key]) => !omit.includes(key)).map(([key, value]) =>
    <div className="odm-field" key={key}>
      <dt>{translate(labels[key] ?? fieldLabel(key))}</dt>
      <dd dir={typeof value === "string" && /[a-z0-9]/i.test(value) ? "auto" : undefined}>
        {key === "status" || key === "previous_status" ? statusLabel(value) : key === "created_at" ? (
          value ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(String(value))) : "—"
        ) : key === "delivery_date" ? formatOrderDate(value) : numericFields.has(key) ? numberText(value) : displayValue(value)}
      </dd>
    </div>)}</dl>;
}

export default function OrderDetailsModal({ id, onClose, onPrint, canRelease = false, onOrderChanged }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState<number[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = () => {
    controllerRef.current?.abort();
    const thisRequest = ++requestId.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    setExpanded([]);
    fetchOrderDetails(id, controller.signal).then((data) => {
      if (requestId.current === thisRequest) setState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || requestId.current !== thisRequest) return;
      const typed = error as Partial<OrderDetailsError>;
      setState({ status: "error", message: error instanceof Error ? error.message : "تعذر تحميل تفاصيل الطلب.", notFound: typed.status === 404 });
    });
  };

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    load();
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus(), 20);
    return () => {
      controllerRef.current?.abort();
      requestId.current += 1;
      window.clearTimeout(timer);
      returnFocusRef.current?.focus();
    };
    // Fetch is tied to the mounted order record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    if (event.shiftKey && (document.activeElement === focusable[0] || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (document.activeElement === focusable[focusable.length - 1] || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  const toggleProduction = (index: number) => setExpanded((current) =>
    current.includes(index) ? current.filter((value) => value !== index) : [...current, index]);
  const data = state.status === "ready" ? state.data : null;
  const order = data?.order;

  return <div className="odm-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="odm-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="odm-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="odm-header">
        <div className="odm-heading-mark"><FileText size={20} aria-hidden="true" /></div>
        <div className="odm-title-wrap">
          <span className="odm-eyebrow">{translate("ملف الطلب · تفاصيل تشغيلية")}</span>
          <h2 id="odm-title">{order?.order_number ? translate("طلب رقم {{number}}", { number: order.order_number }) : translate("تفاصيل الطلب")}</h2>
          {order && <span className="odm-header-sub">{order.customer_id} <span>·</span> {orderStatusLabel(order.status)}</span>}
        </div>
        <div className="odm-head-actions">
          {order && <OrderProductionReleaseButton id={id} status={order.status} enabled={canRelease} onReleased={() => { load(); onOrderChanged?.(); }} />}
          <button className="odm-print-button" type="button" onClick={onPrint} disabled={!data} aria-label={translate("فتح معاينة الطباعة في تبويب جديد")}>
            <Printer size={17} /> <span>{translate("معاينة الطباعة")}</span>
          </button>
          <button className="odm-icon-button" type="button" onClick={onClose} aria-label={translate("إغلاق التفاصيل")}><X size={19} /></button>
        </div>
      </header>

      <main className="odm-content" aria-live="polite">
        {state.status === "loading" && <div className="odm-loading" role="status">
          <div className="odm-skeleton odm-skeleton-summary" />
          <div className="odm-skeleton-grid">{Array.from({ length: 6 }, (_, index) => <div className="odm-skeleton" key={index} />)}</div>
          <div className="odm-skeleton odm-skeleton-large" />
          <span>{translate("جارٍ جلب بيانات الطلب…")}</span>
        </div>}
        {state.status === "error" && <div className="odm-error-state" role="alert">
          <div className="odm-error-icon"><AlertCircle size={23} /></div>
          <h3>{state.notFound ? translate("الطلب غير موجود") : translate("تعذر تحميل التفاصيل")}</h3>
          <p>{state.message}</p>
          {!state.notFound && <button className="odm-retry" type="button" onClick={load}><RefreshCw size={15} />{" "}{translate("إعادة المحاولة")}</button>}
        </div>}
        {data && order && <>
          <section className="odm-summary-strip" aria-label={translate("ملخص الطلب")}>
            <div className="odm-summary-item"><span>{translate("العميل")}</span><strong>{localizedName(data.customer?.name_ar, data.customer?.name)}</strong></div>
            <div className="odm-summary-item"><span>{translate("الحالة")}</span><strong className="odm-status">{orderStatusLabel(order.status)}</strong></div>
            <div className="odm-summary-item"><span>{translate("تاريخ الطلب")}</span><strong><CalendarDays size={14} /> {formatOrderDate(order.created_at)}</strong></div>
            <div className="odm-summary-item"><span>{translate("موعد التسليم")}</span><strong><CalendarDays size={14} /> {formatOrderDate(order.delivery_date)}</strong></div>
          </section>

          <section className="odm-section">
            <div className="odm-section-head"><div><span className="odm-section-icon"><FileText size={16} /></span><div><h3>{translate("بيانات الطلب")}</h3><p>{translate("الحقول المسجلة في الطلب")}</p></div></div></div>
            <DetailFields data={order as unknown as Record<string, unknown>} labels={orderFieldLabels} omit={["share_token"]} />
          </section>

          <section className="odm-section">
            <div className="odm-section-head"><div><span className="odm-section-icon"><Factory size={16} /></span><div><h3>{translate("العميل والمسؤولون")}</h3><p>{translate("بيانات العميل ومن أنشأ الطلب ويتابعه")}</p></div></div></div>
            <div className="odm-people-grid">
              <article className="odm-person-card"><span>{translate("العميل")}</span><strong>{localizedName(data.customer?.name_ar, data.customer?.name)}</strong><small>{localizedName(data.customer?.name, data.customer?.name_ar)}</small></article>
              <article className="odm-person-card"><span>{translate("منشئ الطلب")}</span><strong>{personName(data.creator)}</strong><small>{data.creator?.username || (data.creator?.id != null ? `#${data.creator.id}` : "—")}</small></article>
              <article className="odm-person-card"><span>{translate("مندوب المبيعات")}</span><strong>{personName(data.sales_representative)}</strong><small>{data.sales_representative?.username || (data.sales_representative?.id != null ? `#${data.sales_representative.id}` : "—")}</small></article>
            </div>
            {data.customer && <DetailFields data={data.customer as unknown as Record<string, unknown>} labels={{
              id: "رقم العميل", name: "الاسم", name_ar: "الاسم بالعربية", code: "رمز العميل", user_id: "رقم المستخدم",
              plate_drawer_code: "رمز درج الاسطوانات", city: "المدينة", address: "العنوان", tax_number: "الرقم الضريبي",
              commercial_name: "الاسم التجاري", unified_number: "الرقم الموحد", unique_customer_number: "الرقم الفريد",
              is_active: "حساب نشط", phone: "الهاتف", sales_rep_id: "رقم المندوب", created_at: "تاريخ التسجيل",
            }} />}
          </section>

          <section className="odm-section odm-production-section">
            <div className="odm-section-head odm-production-heading">
              <div><span className="odm-section-icon"><Factory size={16} /></span><div><h3>{translate("أوامر الإنتاج المرتبطة")}</h3><p>{translate("بيانات التخطيط وحالة كل أمر إنتاج")}</p></div></div>
              <span className="odm-count">{data.production_orders.length}{" "}{translate("أوامر")}</span>
            </div>
            <div className="odm-quantity-summary">
              <div><span>{translate("إجمالي المطلوب")}</span><strong dir="ltr">{numberText(data.totals.requested_kg)} <small>{translate("كجم")}</small></strong></div>
              <div><span>{translate("إجمالي المخطط (مع الزيادة)")}</span><strong dir="ltr">{numberText(data.totals.planned_kg)} <small>{translate("كجم")}</small></strong></div>
              <p>{translate("الكميات المعروضة تخص الطلبات وخطة الإنتاج؛ لا تمثل كمية منفذة فعلياً.")}</p>
            </div>
            {data.actual_production.available === false && <div className="odm-actual-note" role="note">{translate("تفاصيل الطلب تعرض الكميات المطلوبة والمخططة فقط. سجلات التنفيذ الفعلي متاحة في وحدة الإنتاج بحسب الصلاحيات.")}{" "}{translate("لا تُعرض كمية الإنتاج الفعلي كصفر.")}</div>}
            {data.production_orders.length === 0 ? <div className="odm-empty-production">{translate("لا توجد أوامر إنتاج مرتبطة بهذا الطلب.")}</div> :
              <div className="odm-production-list">{data.production_orders.map((production, index) => {
                const product = production.product;
                const isOpen = expanded.includes(index);
                return <article className={`odm-production-card${isOpen ? " is-expanded" : ""}`} key={`${production.id}-${index}`}>
                  <button className="odm-production-toggle" type="button" onClick={() => toggleProduction(index)} aria-expanded={isOpen}>
                    <span className="odm-production-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="odm-production-main"><strong>{displayValue(production.production_order_number)}</strong><small>{i18n.language === "en" ? product?.item?.name || product?.item?.name_ar || product?.category?.name || product?.category?.name_ar || translate("منتج غير محدد") : product?.item?.name_ar || product?.item?.name || product?.category?.name_ar || product?.category?.name || translate("منتج غير محدد")} · {productionStatusLabel(production.status)}</small></span>
                    <span className="odm-quantity-pair"><span><small>{translate("مطلوب")}</small><b dir="ltr">{numberText(production.quantity_kg)}{" "}{translate("كجم")}</b></span><span><small>{translate("مخطط")}</small><b dir="ltr">{numberText(production.final_quantity_kg)}{" "}{translate("كجم")}</b></span></span>
                    {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {isOpen && <div className="odm-production-body">
                    <h4 className="odm-subhead">{translate("بيانات أمر الإنتاج")}</h4>
                    <DetailFields data={production as unknown as Record<string, unknown>} labels={productionFieldLabels} omit={["product"]} />
                    <h4 className="odm-subhead">{translate("مواصفات المنتج")}</h4>
                    {product ? <>
                      <DetailFields data={product as unknown as Record<string, unknown>} labels={productFieldLabels} omit={["category", "item", "color"]} />
                      <div className="odm-linked-details">
                        <div><span>{translate("الفئة")}</span><strong>{localizedName(product.category?.name_ar, product.category?.name)} {product.category?.code ? `· ${product.category.code}` : ""}</strong></div>
                        <div><span>{translate("الصنف")}</span><strong>{localizedName(product.item?.name_ar, product.item?.name)} {product.item?.code ? `· ${product.item.code}` : ""}</strong></div>
                        <div><span>{translate("لون الخلطة")}</span><strong>{localizedName(product.color?.name_ar, product.color?.name)} {product.color?.brand ? `· ${product.color.brand}` : ""}</strong></div>
                        <div><span>{translate("اللون (عينة)")}</span><MasterBatchSwatch color={product.color} size={20} className="odm-color-chip" label={localizedName(product.color?.name_ar, product.color?.name, translate("غير محدد"))} /></div>
                      </div>
                    </> : <p className="odm-no-product">{translate("لم يعد المنتج المرتبط متاحاً.")}</p>}
                  </div>}
                </article>;
              })}</div>}
          </section>
        </>}
      </main>
      <footer className="odm-footer">
        <span>{translate(canRelease ? "تفاصيل الطلب" : "عرض للقراءة فقط")}</span>
        <button type="button" className="odm-close-footer" onClick={onClose}>{translate("إغلاق")}</button>
      </footer>
    </section>
  </div>;
}