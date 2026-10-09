import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import type { ProductionHistoryKind, ProductionHistoryFilter, ProductionHistoryRecords, StorageLocation } from "../../../../shared/production";
import { productionApi } from "../../lib/production-api";
import { FilmDurationSummary } from "./FilmDurationSummary";

type Record = ProductionHistoryRecords[ProductionHistoryKind];
type Props = {
  kind: ProductionHistoryKind; language: string; title: string; orderId?: number;
  locations?: StorageLocation[]; refresh?: unknown;
};
export function ProductionHistory({ kind, language, title, orderId, locations = [], refresh }: Props) {
  const en = language === "en", label = (ar: string, english: string) => en ? english : ar;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ search: "", status: "", from: "", to: "", location: "" });
  const [filter, setFilter] = useState<ProductionHistoryFilter>({});
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const before = cursors[cursors.length - 1];
  const [page, setPage] = useState<{ records: Record[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError(""); setPage(null);
    productionApi.history(kind, { ...filter, before, order_id: orderId, limit: 50 })
      .then(value => { if (alive) setPage(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : label("تعذر تحميل التاريخ", "History could not be loaded.")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, kind, filter, before, orderId, retry, refresh, language]);
  const search = (event: FormEvent) => {
    event.preventDefault();
    setCursors([undefined]);
    setFilter({ search: draft.search.trim() || undefined, status: draft.status || undefined,
      from: draft.from || undefined, to: draft.to || undefined, location_id: draft.location ? Number(draft.location) : undefined });
  };
  const statuses = kind === "rolls" ? ["film", "printing", "done"] : ["pending", "active", "in_production", "completed", "cancelled", "archived"];
  const statusName = (status: string) => en ? status.replaceAll("_", " ") : ({
    film: "فيلم", printing: "طباعة", done: "جاهز", pending: "انتظار", in_production: "قيد الإنتاج",
    active: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغي", archived: "مؤرشف",
  }[status] ?? status);
  const n = (value: unknown, digits = 2) => new Intl.NumberFormat(en ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits: digits }).format(Number(value ?? 0));
  const local = (ar?: string | null, english?: string | null) => (en ? (english && !/[\u0600-\u06ff]/.test(english) ? english : "") : ar || english) || "—";
  const date = (value?: string | null) => value ? new Date(value).toLocaleString(en ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh" }) : "—";
  const render = (record: Record) => {
    if (kind === "orders") {
      const order = record as ProductionHistoryRecords["orders"];
      return <article className="prod-record" key={order.id}>
        <strong className="prod-number">{order.production_order_number} · {order.order_number}</strong>
        <p>{local(order.product?.customer_name_ar, order.product?.customer_name)} · {local(order.product?.name_ar, order.product?.name)} · {statusName(order.status)}</p>
        <p>{label("وقت بدء التنفيذ", "Execution started")}: {date(order.started_at)}</p>
        {order.started_at ? <div className="prod-detail-pairs">
          {[[label("المخطط", "Planned"), order.final_quantity_kg], [label("المنتج", "Produced"), order.produced_kg],
            [label("الجاهز", "Ready"), order.ready_kg], [label("المستلم", "Received"), order.received_kg],
            [label("المتبقي للاستلام", "Remaining to receive"), order.remaining_kg], [label("الهدر", "Waste"), order.waste_kg]]
            .map(([title, value]) => <div key={title}><span>{title}</span><strong>{n(value)} kg</strong></div>)}
        </div> : <p className="prod-muted">{label("أمر قديم بلا تنفيذ مسجل؛ لا تُستنتج كمياته الفعلية من الكمية المخططة.", "Historical order without recorded execution; actual quantities are not inferred from the plan.")}</p>}
        <FilmDurationSummary durations={order.film_durations} language={language} />
        <ProductionHistory kind="rolls" title={`${label("كل الرولات", "All rolls")} · ${n(order.roll_count)}`} orderId={order.id} language={language} refresh={refresh}/>
      </article>;
    }
    if (kind === "rolls") {
      const roll = record as ProductionHistoryRecords["rolls"];
      return <div className="prod-record" key={roll.id}><Link className="prod-number" href={`/production/rolls/${roll.id}`}>{roll.roll_number}</Link>
        <p>{roll.production_order_number} · {local(roll.product.name_ar, roll.product.name)} · {statusName(roll.stage)}</p>
        <p>{n(roll.weight_kg)} kg · {date(roll.created_at)}</p></div>;
    }
    if (kind === "receipts") {
      const receipt = record as ProductionHistoryRecords["receipts"];
      return <details className="prod-voucher" key={receipt.id}><summary><strong className="prod-number">{receipt.voucher_number}</strong> · {date(receipt.created_at)} · {n(receipt.items.length)} {label("بنود", "lines")}</summary>
        {receipt.notes && <p>{receipt.notes}</p>}
        {receipt.items.map(item => <div className="prod-measure" key={item.id}>
          <span>{item.production_order_number} · #{item.customer_product_id} · {item.item_id} · {local(item.location_name_ar, item.location_name)}</span>
          <strong>{n(item.quantity_kg)} kg</strong>
          {item.packaging && <small>{n(item.packaging.roll_weight_grams, 4)} g × {n(item.packaging.rolls_per_unit)} × {n(item.packaging.units)}</small>}
        </div>)}</details>;
    }
    if (kind === "inventory") {
      const balance = record as ProductionHistoryRecords["inventory"];
      return <div className="prod-record" key={balance.id}><strong>{local(balance.product.name_ar, balance.product.name)}</strong>
        <p>{local(balance.product.customer_name_ar, balance.product.customer_name)} · {balance.production_order_number} · {balance.batch_number ?? "—"}</p>
        <p>{local(balance.location_name_ar, balance.location_name)} · {n(balance.quantity_kg)} kg · {statusName(balance.production_order_status ?? "")}</p></div>;
    }
    const movement = record as ProductionHistoryRecords["movements"];
    const location = locations.find(value => value.id === movement.location_id);
    return <div className="prod-record" key={movement.id}><strong>{movement.voucher_number} · {movement.production_order_number}</strong>
      <p>#{movement.receipt_item_id} · {local(location?.name_ar, location?.name)} · {n(movement.quantity_kg)} kg · {date(movement.created_at)}</p></div>;
  };
  return <details className="prod-card prod-history" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="prod-card-head"><h3>{title}</h3></summary>
    {open && <div className="prod-card-body">
      <form className="prod-form-grid" onSubmit={search}>
        <label className="prod-field">{label("بحث برقم الأمر أو المنتج أو العميل أو السند", "Search order, product, customer or voucher")}<input value={draft.search} maxLength={120} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))}/></label>
        {["orders", "rolls"].includes(kind) && <label className="prod-field">{label("الحالة", "Status")}<select value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}><option value="">{label("كل الحالات", "All statuses")}</option>{statuses.map(status => <option key={status} value={status}>{statusName(status)}</option>)}</select></label>}
        <label className="prod-field">{label(kind === "orders" || kind === "inventory" ? "بدء التنفيذ من" : "من تاريخ", kind === "orders" || kind === "inventory" ? "Execution started from" : "From date")}<input type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))}/></label>
        <label className="prod-field">{label("إلى تاريخ", "To date")}<input type="date" min={draft.from || undefined} value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))}/></label>
        {locations.length > 0 && <label className="prod-field">{label("الموقع", "Location")}<select value={draft.location} onChange={event => setDraft(value => ({ ...value, location: event.target.value }))}><option value="">{label("كل المواقع", "All locations")}</option>{locations.map(location => <option key={location.id} value={location.id}>{local(location.name_ar, location.name)}</option>)}</select></label>}
        <button className="prod-btn" type="submit">{label("بحث", "Search")}</button>
      </form>
      {loading && <p role="status">{label("جارٍ التحميل…", "Loading…")}</p>}
      {error && <div className="prod-error" role="alert">{error}<button className="prod-btn secondary" onClick={() => setRetry(value => value + 1)}>{label("إعادة المحاولة", "Retry")}</button></div>}
      {page && <><div className="prod-list" style={{ marginTop: 14 }}>{page.records.map(render)}{!page.records.length && <p>{label("لا توجد نتائج", "No results")}</p>}</div>
        <div className="prod-inline" style={{ marginTop: 14 }}>
          <button className="prod-btn secondary" disabled={cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>{label("السابق", "Previous")}</button>
          <span>{label("صفحة", "Page")} {n(cursors.length)}</span>
          <button className="prod-btn secondary" disabled={page.next === null} onClick={() => { if (page.next !== null) setCursors(value => [...value, page.next!]); }}>{label("التالي", "Next")}</button>
        </div></>}
    </div>}
  </details>;
}