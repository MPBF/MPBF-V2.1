import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/app-api";
import { formatNumber } from "../lib/format-number";
import type { CustomerHistoryOrder, CustomerOrderHistoryPage } from "../../../shared/customer-order-history";
import "./CustomerOrderHistory.css";

const PAGE_SIZE = 20;

function formatOrderDate(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const locale = language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB-u-ca-gregory";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    calendar: "gregory",
  }).format(date);
}

function productionRows(order: CustomerHistoryOrder) {
  return order.production_orders.length ? order.production_orders : [null];
}

export default function CustomerOrderHistory({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "ar";
  const [orders, setOrders] = useState<CustomerHistoryOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [loadedCustomerId, setLoadedCustomerId] = useState("");
  const requestSequence = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    const id = customerId;
    const sequence = ++requestSequence.current;
    loadingMoreRef.current = false;
    setLoadedCustomerId("");
    setOrders([]);
    setHasMore(false);
    setNextOffset(null);
    setInitialError("");
    setMoreError("");
    setInitialLoading(true);
    setLoadingMore(false);
    try {
      const page = await api(`/customers/${encodeURIComponent(id)}/order-history?limit=${PAGE_SIZE}&offset=0`) as CustomerOrderHistoryPage;
      if (sequence !== requestSequence.current) return;
      setOrders(Array.isArray(page.orders) ? page.orders : []);
      setHasMore(Boolean(page.has_more));
      setNextOffset(page.next_offset);
      setLoadedCustomerId(id);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setInitialError(error instanceof Error ? error.message : t("تعذر تحميل سجل الطلبات"));
      setLoadedCustomerId(id);
    } finally {
      if (sequence === requestSequence.current) setInitialLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    void loadFirstPage();
    return () => {
      requestSequence.current += 1;
      loadingMoreRef.current = false;
    };
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (loadingMoreRef.current || nextOffset === null || loadedCustomerId !== customerId) return;
    loadingMoreRef.current = true;
    const sequence = requestSequence.current;
    const offset = nextOffset;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await api(`/customers/${encodeURIComponent(customerId)}/order-history?limit=${PAGE_SIZE}&offset=${offset}`) as CustomerOrderHistoryPage;
      if (sequence !== requestSequence.current) return;
      setOrders((current) => [...current, ...(Array.isArray(page.orders) ? page.orders : [])]);
      setHasMore(Boolean(page.has_more));
      setNextOffset(page.next_offset);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setMoreError(error instanceof Error ? error.message : t("تعذر تحميل المزيد من سجل الطلبات"));
    } finally {
      if (sequence === requestSequence.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  const isCurrentCustomer = loadedCustomerId === customerId;
  const visibleOrders = isCurrentCustomer ? orders : [];
  const showInitialLoading = initialLoading || !isCurrentCustomer;

  return (
    <section className="panel customer-history" dir={language === "ar" ? "rtl" : "ltr"} aria-labelledby="customer-history-title">
      <div className="panel-head customer-history__head">
        <div>
          <h3 id="customer-history-title">{t("سجل طلبات العميل")}</h3>
          <small className="muted-text">{t("الكمية المطلوبة مقابل الإنتاج المنجز فعلياً")}</small>
        </div>
        {isCurrentCustomer && visibleOrders.length > 0 && (
          <span className="customer-history__count">{visibleOrders.length} {t("طلب في سجل العميل")}</span>
        )}
      </div>

      {showInitialLoading ? (
        <div className="customer-history__skeleton" aria-busy="true" aria-label={t("جارٍ تحميل سجل الطلبات")}>
          <span /><span /><span />
        </div>
      ) : initialError ? (
        <div className="customer-history__message customer-history__message--error" role="alert">
          <span>{initialError}</span>
          <button className="btn btn-muted" type="button" onClick={() => void loadFirstPage()}>{t("إعادة المحاولة")}</button>
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="customer-history__empty">
          <strong>{t("لا يوجد سجل طلبات لهذا العميل")}</strong>
          <span>{t("ستظهر الطلبات هنا عند تسجيلها.")}</span>
        </div>
      ) : (
        <>
          <div className="customer-history__table-wrap">
            <table className="customer-history__table">
              <thead>
                <tr>
                  <th scope="col">{t("رقم الطلب")}</th>
                  <th scope="col">{t("تاريخ الطلب")}</th>
                  <th scope="col">{t("رقم أمر الإنتاج")}</th>
                  <th scope="col" className="customer-history__numeric">{t("الكمية المطلوبة")} <span>(KG)</span></th>
                  <th scope="col" className="customer-history__numeric">{t("الكمية المنتجة فعلياً")} <span>(KG)</span></th>
                </tr>
              </thead>
              {visibleOrders.map((order) => {
                const rows = productionRows(order);
                return (
                  <tbody key={order.id}>
                    {rows.map((production, index) => (
                      <tr key={production?.id ?? `${order.id}-no-production`}>
                        {index === 0 && (
                          <>
                            <th scope="rowgroup" className="customer-history__order-number" rowSpan={rows.length}>{order.order_number || "—"}</th>
                            <td className="customer-history__date" rowSpan={rows.length}>{formatOrderDate(order.created_at, language)}</td>
                          </>
                        )}
                        <td className="customer-history__production">{production?.production_order_number || "—"}</td>
                        <td className="customer-history__numeric">{production ? formatNumber(production.requested_kg) : "—"}</td>
                        <td className="customer-history__numeric customer-history__actual">{production ? formatNumber(production.produced_kg) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          <div className="customer-history__mobile">
            {visibleOrders.map((order) => (
              <article className="customer-history__order-card" key={order.id}>
                <div className="customer-history__card-heading">
                  <strong>{order.order_number || "—"}</strong>
                  <time dateTime={order.created_at}>{formatOrderDate(order.created_at, language)}</time>
                </div>
                {productionRows(order).map((production) => (
                  <div className="customer-history__production-card" key={production?.id ?? `${order.id}-no-production`}>
                    <div className="customer-history__production-id">
                      <span>{t("أمر الإنتاج")}</span><strong>{production?.production_order_number || "—"}</strong>
                    </div>
                    <div className="customer-history__quantities">
                      <div><span>{t("المطلوب")} <small>KG</small></span><strong>{production ? formatNumber(production.requested_kg) : "—"}</strong></div>
                      <div><span>{t("المنجز فعلياً")} <small>KG</small></span><strong>{production ? formatNumber(production.produced_kg) : "—"}</strong></div>
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>

          {moreError && (
            <div className="customer-history__message customer-history__message--error" role="alert">
              <span>{moreError}</span>
              <button className="btn btn-muted" type="button" onClick={() => void loadMore()}>{t("إعادة المحاولة")}</button>
            </div>
          )}
          {hasMore && (
            <div className="customer-history__footer">
              <button className="btn btn-muted" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? t("جارٍ تحميل المزيد…") : t("تحميل المزيد")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
