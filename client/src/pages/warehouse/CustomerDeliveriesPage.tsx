import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";

import { formatNumber, formatWholeNumber } from "../../lib/format-number";
import { productionRequest } from "../../lib/production-api";
import { availableWarehouseViews, canOpenWarehouseView } from "../../lib/warehouse-navigation";

import type { CustomerDeliveryRecord, ProductionUser } from "../../../../shared/production";

import "../production/production.css";
import "../production/raw-operations.css";
import "./warehouse-cards.css";
import "./customer-deliveries.css";

export type CustomerDeliveriesPageProps = { user: ProductionUser };
type DeliveryPage = { records: CustomerDeliveryRecord[]; next: number | null };
const PAGE_SIZE = 30;
const messages: Record<string, [string, string]> = {
  title: ["تسليم العملاء", "Customer deliveries"],
  intro: ["سجل الكميات التي غادرت المستودع إلى العملاء، مرتبطاً بأمر الإنتاج وسندات التسليم.", "A record of finished goods sent to customers, grouped by production order and delivery voucher."],
  permission: ["لا تتوفر صلاحية عرض تسليمات العملاء.", "You do not have permission to view customer deliveries."],
  search: ["بحث برقم الطلب أو العميل أو أمر الإنتاج أو السند", "Search order, customer, production order or voucher"],
  refresh: ["تحديث", "Refresh"], retry: ["إعادة المحاولة", "Retry"],
  loading: ["جارٍ التحميل", "Loading"], loadingMore: ["جارٍ تحميل المزيد", "Loading more"],
  loadFail: ["تعذر تحميل تسليمات العملاء.", "Customer deliveries could not be loaded."],
  empty: ["لا توجد تسليمات مطابقة.", "No matching deliveries found."],
  emptyHint: ["ستظهر هنا أوامر الإنتاج المرتبطة بسندات التسليم.", "Production orders with customer delivery vouchers will appear here."],
  customer: ["العميل", "Customer"], order: ["رقم الطلب الأصلي", "Original order"], productionOrder: ["أمر الإنتاج", "Production order"],
  product: ["المنتج", "Product"], delivered: ["إجمالي المسلم", "Total delivered"], vouchers: ["سندات التسليم", "Delivery vouchers"],
  voucher: ["رقم السند", "Voucher"], date: ["التاريخ", "Date"], quantity: ["الكمية", "Quantity"],
  showVouchers: ["عرض تفاصيل السندات", "View voucher details"], hideVouchers: ["إخفاء تفاصيل السندات", "Hide voucher details"],
  more: ["تحميل المزيد", "Load more"], count: ["أمر إنتاج", "production orders"],
};
const tx = (key: string, en: boolean) => messages[key]?.[en ? 1 : 0] ?? key;
const englishValue = (value: string | null | undefined, fallback = "—") => {
  const safe = (value ?? "").trim();
  return safe && !/[\u0600-\u06ff]/.test(safe) ? safe : fallback;
};
const dateLabel = (value: string, en: boolean) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
    }).format(date);
};

function ModuleNav({ user, en }: { user: ProductionUser; en: boolean }) {
  const labels: Record<string, [string, string]> = {
    hall: ["صالة الإنتاج", "Production hall"],
    warehouse: ["المنتجات التامة", "Finished products"],
    raw: ["صالة الخام", "Raw materials"],
    "raw-materials": ["صالة الخام", "Raw materials"],
    deliveries: ["تسليم العملاء", "Customer deliveries"],
  };
  return <nav className="raw-ops-nav" aria-label={en ? "Warehouse modules" : "أقسام المستودع"}>
    {availableWarehouseViews(user).map(view => <Link key={view.view} href={view.href}
      aria-current={view.href === "/warehouse/customer-deliveries" ? "page" : undefined}>
      {labels[view.view]?.[en ? 1 : 0] ?? view.view}
    </Link>)}
  </nav>;
}

export default function CustomerDeliveriesPage({ user }: CustomerDeliveriesPageProps) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const allowed = canOpenWarehouseView(user, "deliveries");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<CustomerDeliveryRecord[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(allowed);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const sequence = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadFirstPage = useCallback(async (background = false) => {
    const request = ++sequence.current;
    if (!allowed) { setLoading(false); return; }
    if (!background || !hasLoadedRef.current) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (queryRef.current) params.set("search", queryRef.current);
      const result = await productionRequest<DeliveryPage>(`/customer-deliveries?${params}`);
      if (request !== sequence.current) return;
      setRecords(result.records);
      setNext(result.next);
      setHasLoaded(true);
      hasLoadedRef.current = true;
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : tx("loadFail", en));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [allowed, en]);

  useEffect(() => {
    const currentSequence = sequence;
    void loadFirstPage();
    return () => { currentSequence.current++; };
  }, [loadFirstPage, query]);

  useEffect(() => {
    if (!allowed) return;
    const refresh = () => { if (document.visibilityState === "visible") void loadFirstPage(true); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [allowed, loadFirstPage]);

  const loadMore = async () => {
    if (next === null || loadingMore) return;
    const cursor = next;
    const request = sequence.current;
    setLoadingMore(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), before: String(cursor) });
      if (query) params.set("search", query);
      const result = await productionRequest<DeliveryPage>(`/customer-deliveries?${params}`);
      if (request !== sequence.current) return;
      setRecords(current => {
        const seen = new Set(current.map(record => record.production_order_id));
        return [...current, ...result.records.filter(record => !seen.has(record.production_order_id))];
      });
      setNext(result.next);
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : tx("loadFail", en));
    } finally { setLoadingMore(false); }
  };

  return <main className="raw-ops customer-deliveries production">
    <header className="raw-ops-header">
      <div className="raw-ops-heading">
        <div className="raw-ops-kicker">MPBF / CUSTOMER DISPATCH</div>
        <h1>{tx("title", en)}</h1>
        <p>{tx("intro", en)}</p>
      </div>
      <div className="raw-ops-actions">
        <button type="button" className="raw-btn quiet" onClick={() => void loadFirstPage()} disabled={loading}>
          <RefreshCw aria-hidden="true" />{tx("refresh", en)}
        </button>
        <div className="raw-ops-mark" aria-hidden="true"><i /><span>DISPATCH<br />TRACE / 04</span></div>
      </div>
    </header>
    <ModuleNav user={user} en={en} />
    {!allowed ? <div className="raw-ops-banner error" role="alert">{tx("permission", en)}</div> : <>
      <section className="raw-ops-card customer-deliveries-toolbar" aria-label={tx("search", en)}>
        <label className="customer-deliveries-search">
          <span>{tx("search", en)}</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <div className="customer-deliveries-total" aria-live="polite">
          <strong>{formatWholeNumber(records.length)}</strong><span>{tx("count", en)}</span>
        </div>
      </section>
      {error && <div className="raw-ops-banner error" role="alert">
        <span>{error || tx("loadFail", en)}</span>
        <button type="button" className="raw-btn quiet" onClick={() => void loadFirstPage()}><RefreshCw aria-hidden="true" />{tx("retry", en)}</button>
      </div>}
      <section className="raw-ops-card customer-delivery-section">
        <div className="raw-ops-card-head">
          <h2>{tx("title", en)}</h2>
          <span className="raw-ops-helper">{formatWholeNumber(records.length)} {tx("count", en)}</span>
        </div>
        <div className="raw-ops-card-body">
          {loading && !hasLoaded ? <div className="customer-delivery-skeleton" aria-label={tx("loading", en)}>
            <i /><i /><i />
          </div> : !hasLoaded && error ? <div className="customer-delivery-empty" role="status">
            <strong>{tx("loadFail", en)}</strong>
          </div> : records.length ? <div className="customer-delivery-list">
            {records.map(record => {
              const customer = en ? englishValue(record.customer_name) : (record.customer_name_ar?.trim() || record.customer_name?.trim() || "—");
              const productName = en
                ? englishValue(record.product?.name, englishValue(record.item_id))
                : (record.product?.name_ar?.trim() || record.product?.name?.trim() || record.item_id || "—");
              const detailsId = `delivery-vouchers-${record.production_order_id}`;
              return <article className="customer-delivery-card" key={record.production_order_id}>
                <header className="customer-delivery-card-head">
                  <div className="customer-delivery-identifiers">
                    <span className="customer-delivery-eyebrow">{tx("productionOrder", en)}</span>
                    <strong className="customer-delivery-po">{record.production_order_number}</strong>
                    <small>{tx("order", en)} <bdi>{record.order_number}</bdi></small>
                  </div>
                  <div className="customer-delivery-amount">
                    <span>{tx("delivered", en)}</span>
                    <bdi>{formatNumber(record.delivered_kg)} <small>kg</small></bdi>
                  </div>
                </header>
                <div className="customer-delivery-details">
                  <div><span>{tx("customer", en)}</span><strong>{customer}</strong></div>
                  <div><span>{tx("product", en)}</span><strong>{productName}</strong><small>{record.item_id}</small></div>
                </div>
                <details className="customer-delivery-vouchers">
                  <summary aria-controls={detailsId}>
                    <span>{tx("vouchers", en)}</span>
                    <bdi>{formatWholeNumber(record.deliveries.length)}</bdi>
                  </summary>
                  <div className="customer-delivery-voucher-table" id={detailsId}>
                    <div className="customer-delivery-voucher-row customer-delivery-voucher-labels">
                      <span>{tx("voucher", en)}</span><span>{tx("date", en)}</span><span>{tx("quantity", en)}</span>
                    </div>
                    {record.deliveries.map(delivery => <div className="customer-delivery-voucher-row" key={delivery.id}>
                      <strong><bdi>{delivery.voucher_number}</bdi></strong>
                      <time dateTime={delivery.created_at}>{dateLabel(delivery.created_at, en)}</time>
                      <bdi>{formatNumber(delivery.quantity_kg)} kg</bdi>
                    </div>)}
                  </div>
                </details>
              </article>;
            })}
          </div> : <div className="customer-delivery-empty">
            <span className="customer-delivery-empty-index" aria-hidden="true">04</span>
            <strong>{tx("empty", en)}</strong><p>{tx("emptyHint", en)}</p>
          </div>}
          {next !== null && hasLoaded && <div className="customer-delivery-load-more">
            <button type="button" className="raw-btn outline" onClick={() => void loadMore()} disabled={loadingMore || loading}>
              {loadingMore ? tx("loadingMore", en) : tx("more", en)}
            </button>
          </div>}
        </div>
      </section>
    </>}
  </main>;
}
