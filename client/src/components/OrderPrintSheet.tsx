import i18n, { intlLocale, localizedName, translate } from "../i18n";
import QRCode from "react-qr-code";
import MasterBatchSwatch from "./MasterBatchSwatch";

import type { BrandingSnapshot } from "../lib/branding";
import { displayValue, formatOrderDate, orderStatusLabel, personName, publicOrderPrintUrl } from "../lib/order-details";
import { printDimensionText, printNumberText } from "../lib/order-print-format";
import type { OrderPrintDetails, OrderPrintProduction } from "../../../shared/order-details";

const bilingual = (ar: string, en: string) => <span className="opp-bilingual">{i18n.language === "en" ? en : ar}</span>;
const safeText = (value: unknown) => displayValue(value);
const roundedWithUnit = (value: unknown, unit: string) => {
  const text = printNumberText(value);
  return text === "—" ? text : `${text} ${unit}`;
};

function PunchingIcon({ type }: { type: string }) {
  const normalized = type.toLocaleLowerCase();
  const hook = normalized.includes("hook") || normalized.includes("t-shirt") || normalized.includes("علاقي") || normalized.includes("علاقة");
  const banana = normalized.includes("banana") || normalized.includes("بنانة") || normalized.includes("بنان");
  if (!hook && !banana) return <span className="opp-no-punch">{safeText(type)}</span>;
  return <svg className="opp-punch-icon" viewBox="0 0 52 60" role="img" aria-label={hook ? translate("تخريم علاقي") : translate("تخريم بنانة")}>
    <rect x="4" y="5" width="44" height="50" rx="3" fill="#e2eae6" stroke="#405b53" strokeWidth="2" />
    {hook
      ? <path d="M16 16h20v11c0 6-4 10-10 10s-10-4-10-10z" fill="#fff" stroke="#435d55" strokeWidth="2" />
      : <rect x="12" y="15" width="28" height="12" rx="6" fill="#fff" stroke="#435d55" strokeWidth="2" />}
    <path d="M8 49h36" stroke="#a7b7ae" strokeWidth="1" strokeDasharray="2 2" />
    <text x="26" y="44" textAnchor="middle" fontSize="7" fontWeight="700" fill="#315d52">{hook ? translate("علاقي") : translate("بنانة")}</text>
  </svg>;
}

function sizeText(product: NonNullable<OrderPrintProduction["product"]>) {
  const caption = product.size_caption;
  if (caption) return printDimensionText(caption);
  const faces = [product.width, product.left_facing, product.right_facing].map((value) => {
    const text = value == null ? "" : printDimensionText(value);
    return text === "—" ? "" : text;
  });
  const [width, left, right] = faces;
  const size = width ? `${width}${left || right ? `+${left || "0"}+${right || "0"}` : ""}` : "";
  return size || "—";
}

function productionQuantity(row: OrderPrintProduction) {
  return <div className="opp-qty-value">
    <strong dir="ltr">{roundedWithUnit(row.final_quantity_kg, "kg")}</strong>
  </div>;
}

function SpecificationRow({ row, index }: { row: OrderPrintProduction; index: number }) {
  const product = row.product;
  const englishItemName = product?.item?.name;
  const validEnglishItemName = englishItemName && !/[\u0600-\u06ff]/.test(englishItemName) ? englishItemName : null;
  const color = product?.color;
  const cylinder = product?.printing_cylinder ? printDimensionText(product.printing_cylinder.replace(/["″]+$/, "")) : "—";
  const printColors = [...(product?.front_print_colors ?? []), ...(product?.back_print_colors ?? [])].filter(Boolean);
  const notes = [product?.notes, product?.cliche_front_design ? `${translate("تصميم أمامي:")} ${product.cliche_front_design}` : "", product?.cliche_back_design ? `${translate("تصميم خلفي:")} ${product.cliche_back_design}` : ""].filter(Boolean);
  return <tr className="opp-spec-row">
    <td className="opp-row-number">{index + 1}</td>
    <td className="opp-item-cell">
      <strong lang="ar" dir="rtl">{safeText(product?.item?.name_ar)}</strong>
      <small lang="en" dir="ltr">{safeText(validEnglishItemName)}</small>
    </td>
    <td dir="ltr">{product ? sizeText(product) : "—"}</td>
    <td dir="ltr">{roundedWithUnit(product?.cutting_length_cm, "cm")}</td>
    <td dir="ltr">{roundedWithUnit(product?.universal_thickness, "MIC")}</td>
    <td>{safeText(product?.raw_material)}</td>
    <td>
      <div className="opp-color-cell">
        <MasterBatchSwatch color={color} className="opp-color-swatch" label={localizedName(color?.name_ar, color?.name, translate("لون غير محدد"))} />
        <strong>{localizedName(color?.name_ar, color?.name)}</strong>
        {color?.id && <small dir="ltr">#{color.id}</small>}
        {!!printColors.length && <small className="opp-print-colors">{translate("ألوان الطباعة:")}{" "}{printColors.join("، ")}</small>}
      </div>
    </td>
    <td>{product?.is_printed == null ? "—" : product.is_printed ? translate("نعم / Yes") : translate("لا / No")}</td>
    <td dir="ltr">{cylinder === "—" ? cylinder : `${cylinder}″`}</td>
    <td>{product?.punching ? <PunchingIcon type={product.punching} /> : "—"}</td>
    <td>{productionQuantity(row)}</td>
    <td className="opp-notes">{notes.length ? notes.join(" · ") : "—"}</td>
  </tr>;
}

export default function OrderPrintSheet({ data, branding }: { data: OrderPrintDetails; branding: BrandingSnapshot }) {
  const { order, customer, production_orders: productionOrders, totals, creator, sales_representative } = data;
  const qrValue = typeof window === "undefined" ? "" : publicOrderPrintUrl(order.id, data.public_print_path, window.location.origin);
  const rep = personName(sales_representative);
  const customerName = (i18n.language === "en" ? customer?.name || customer?.name_ar : customer?.name_ar || customer?.name) || "—";
  const customerAlternateName = i18n.language === "en" ? customer?.name_ar : customer?.name;
  return <article className="opp-sheet" dir={document.documentElement.dir} lang={document.documentElement.lang}>
    <header className="opp-sheet-header">
      <div className="opp-brand">
        {branding.logoSrc ? <img className="opp-logo" src={branding.logoSrc} alt={`شعار ${branding.companyNameAr}`} /> : <div className="opp-logo-fallback" aria-hidden="true"><span>{branding.companyNameAr.slice(0, 2)}</span></div>}
        <div className="opp-brand-names">
          <h1 lang="ar" dir="rtl">{branding.companyNameAr || "—"}</h1>
          <p lang="en" dir="ltr">{branding.companyNameEn || "—"}</p>
        </div>
      </div>
      <div className="opp-document-title"><h2>{translate("أمر تشغيل إنتاج")}</h2><span>PRODUCTION ORDER</span></div>
      <div className="opp-order-id">
        <div><b>{translate("رقم الطلب:")}</b> <span dir="auto">{safeText(order.order_number)}</span></div>
        <div><b>{translate("التاريخ:", { nsSeparator: false })}</b> <span>{formatOrderDate(order.created_at)}</span></div>
        <div><b>{translate("التسليم:", { nsSeparator: false })}</b> <span>{formatOrderDate(order.delivery_date)}</span></div>
        <div><b>{translate("مدة التسليم:")}</b> <span>{roundedWithUnit(order.delivery_days, translate("يوم"))}</span></div>
      </div>
      {qrValue && <QRCode className="opp-qr" value={qrValue} size={88} level="M" title={translate("نسخة الطباعة العامة للطلب")} />}
    </header>

    <table className="opp-overview" aria-label={translate("ملخص أمر الإنتاج")}><colgroup>
      <col className="opp-overview-customer-label" /><col className="opp-overview-customer" />
      <col className="opp-overview-drawer-label" /><col className="opp-overview-drawer" />
      <col className="opp-overview-rep-label" /><col className="opp-overview-rep" />
      <col className="opp-overview-status-label" /><col className="opp-overview-status" />
      <col className="opp-overview-total-label" /><col className="opp-overview-total" />
    </colgroup><tbody><tr>
      <th>{bilingual("العميل", "Customer")}</th>
      <td className="opp-customer-cell"><strong>{customerName}</strong><span>{customerAlternateName || "—"}</span><small>{customer?.code ? `#${customer.code}` : customer?.phone || "—"}</small></td>
      <th>{bilingual("الدرج", "Drawer")}</th><td>{safeText(customer?.plate_drawer_code)}</td>
      <th>{bilingual("المندوب", "Sales Rep")}</th><td>{rep}</td>
      <th>{bilingual("الحالة", "Status")}</th><td>{orderStatusLabel(order.status)}</td>
      <th className="opp-total-head">{bilingual("الإجمالي", "Total")}</th>
       <td className="opp-total-cell"><strong>{printNumberText(totals.planned_kg)}{" "}{bilingual("كجم", "kg")}</strong></td>
    </tr></tbody></table>

    {order.previous_status && <p className="opp-previous-status">{translate("الحالة السابقة للطلب:")}{" "}<strong>{orderStatusLabel(order.previous_status)}</strong></p>}
    {order.notes && <div className="opp-order-notes"><strong>{translate("ملاحظات الطلب:")}</strong> {order.notes}</div>}
    {data.actual_production.available === false && <div className="opp-production-disclaimer">{data.actual_production.message}{" "}{translate("الكميات أدناه مخططة وليست سجلاً للإنتاج المنفذ.")}</div>}

    <table className="opp-spec-table" aria-label={translate("مواصفات أوامر الإنتاج")}>
      <colgroup><col style={{ width: "2.5%" }} /><col style={{ width: "13.5%" }} /><col style={{ width: "8%" }} /><col style={{ width: "5.5%" }} /><col style={{ width: "5.5%" }} /><col style={{ width: "7%" }} /><col style={{ width: "9%" }} /><col style={{ width: "5%" }} /><col style={{ width: "6%" }} /><col style={{ width: "6%" }} /><col style={{ width: "12%" }} /><col style={{ width: "20%" }} /></colgroup>
      <thead><tr>
        <th>{bilingual("#", "#")}</th><th>{bilingual("الصنف", "Item")}</th><th>{bilingual("المقاس / الواجهات", "Size / Facings")}</th>
        <th>{bilingual("طول القص", "Cut length")}</th><th>{bilingual("السماكة العامة", "Thickness · MIC")}</th>
        <th>{bilingual("المادة", "Material")}</th><th>{bilingual("اللون", "Color")}</th><th>{bilingual("الطباعة", "Printed")}</th>
        <th>{bilingual("السلندر", "Cylinder")}</th><th>{bilingual("التخريم", "Punching")}</th>
        <th>{bilingual("الكمية", "Quantity")}</th><th>{bilingual("ملاحظات", "Notes")}</th>
      </tr></thead>
      <tbody>{productionOrders.map((row, index) => <SpecificationRow key={`${row.id}-${index}`} row={row} index={index} />)}
        {productionOrders.length === 0 && <tr><td className="opp-no-rows" colSpan={12}>{translate("لا توجد أوامر إنتاج مرتبطة بهذا الطلب.")}</td></tr>}
      </tbody>
    </table>

    <div className="opp-closing">
      <section className="opp-signatures" aria-label={translate("التوقيعات")}>
        <div><strong>{bilingual("المدير", "Manager")}</strong><span /></div>
        <div><strong>{bilingual("تم الاعتماد بواسطة", "Approved By")}</strong><span /></div>
        <div><strong>{bilingual("تم الإنشاء بواسطة", "Created By")}</strong><b>{personName(creator)}</b><span /></div>
      </section>
      <footer className="opp-generated">
        <span>{i18n.language === "en" ? "SYSTEM GENERATED" : "مستند مولّد آليًا"}</span>
        <span>·</span>
        <time>{new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date())}</time>
      </footer>
    </div>
  </article>;
}