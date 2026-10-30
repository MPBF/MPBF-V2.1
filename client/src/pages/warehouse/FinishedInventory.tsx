import { ArrowDown, ArrowUp, ChevronDown, Printer, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { createPortal } from "react-dom";

import {
  hasProductionPermission, kgHundredths, kgString,
  type DeliveryInput, type DeliveryStock, type FinishedDelivery,
  type ProductionState, type ProductionUser,
} from "../../../../shared/production";
import { printDelivery } from "../../lib/delivery-print";
import { confirmedProductionRejection, ProductionRequestError, productionRequest } from "../../lib/production-api";
import "./warehouse-cards.css";
import "./finished-inventory.css";

type Props = { user: ProductionUser; language: string; refresh: ProductionState; reload: () => Promise<void> };
type DraftLine = { inventoryId: string; quantity: string };
type Page<T> = { records: T[]; next: number | null };
type PendingDelivery = DeliveryInput;

const copy = (language: string) => {
  const en = language === "en";
  return {
    title: en ? "Finished products" : "المنتجات التامة",
    intro: en ? "Live balances ready for customer delivery." : "الأرصدة الحية الجاهزة للتسليم إلى العملاء.",
    balances: en ? "Available balances" : "الأرصدة المتاحة",
    stockCount: en ? "balances" : "رصيد",
    received: en ? "Received" : "المستلم",
    delivered: en ? "Delivered" : "المسلّم",
    remaining: en ? "Remaining" : "المتبقي",
    order: en ? "Customer order" : "طلب العميل",
    complete: en ? "Complete" : "مكتمل",
    incomplete: en ? "Incomplete" : "غير مكتمل",
    select: en ? "Select for delivery" : "تحديد للتسليم",
    selected: en ? "selected" : "محدد",
    newVoucher: en ? "Create delivery voucher" : "إنشاء سند تسليم",
    clear: en ? "Clear selection" : "مسح التحديد",
    noStock: en ? "No available finished stock" : "لا يوجد مخزون تام متاح",
    noStockDetail: en ? "Positive balances will appear here when stock is received." : "ستظهر الأرصدة الموجبة هنا بعد استلام المخزون.",
    permission: en ? "You can view inventory, but delivery permission is not enabled." : "يمكنك عرض المخزون، لكن صلاحية التسليم غير متاحة.",
    loadError: en ? "Finished inventory could not be loaded." : "تعذر تحميل مخزون المواد التامة.",
    migration: en ? "Finished-delivery storage is not available yet. The required warehouse migration may be missing." : "تخزين سندات تسليم المواد التامة غير متاح حالياً. قد تكون ترقية قاعدة بيانات المستودع المطلوبة غير مطبقة.",
    retry: en ? "Retry" : "إعادة المحاولة",
    refresh: en ? "Refresh" : "تحديث",
    search: en ? "Search balances" : "البحث في الأرصدة",
    searchHistory: en ? "Search vouchers" : "البحث في السندات",
    history: en ? "Saved delivery vouchers" : "سندات التسليم المحفوظة",
    noHistory: en ? "No delivery vouchers found" : "لا توجد سندات تسليم",
    noHistoryDetail: en ? "Saved customer deliveries will be listed here." : "ستظهر هنا سندات التسليم المحفوظة للعملاء.",
    more: en ? "Load more" : "تحميل المزيد",
    voucher: en ? "Voucher" : "السند",
    customer: en ? "Customer" : "العميل",
    product: en ? "Product" : "المنتج",
    quantity: en ? "Weight to deliver (kg)" : "الوزن المراد تسليمه (كجم)",
    available: en ? "Available" : "المتاح",
    notes: en ? "Voucher notes" : "ملاحظات السند",
    newTitle: en ? "New delivery voucher" : "سند تسليم جديد",
    subtitle: en ? "Items will be issued to the selected customer." : "سيتم صرف الأصناف إلى العميل المحدد.",
    preview: en ? "Preview voucher" : "معاينة السند",
    backToEdit: en ? "Back to edit" : "العودة للتعديل",
    save: en ? "Save delivery voucher" : "حفظ سند التسليم",
    cancel: en ? "Cancel" : "إلغاء",
    close: en ? "Close" : "إغلاق",
    print: en ? "Print A4 voucher" : "طباعة سند A4",
    addLine: en ? "Select inventory line" : "اختيار رصيد",
    choose: en ? "Choose an inventory balance" : "اختر رصيداً من المخزون",
    remove: en ? "Remove line" : "حذف السطر",
    total: en ? "Total to deliver" : "إجمالي التسليم",
    saved: en ? "Delivery voucher saved" : "تم حفظ سند التسليم",
    customerOnly: en ? "One voucher can only contain stock for one customer." : "يمكن أن يحتوي السند الواحد على مخزون عميل واحد فقط.",
    maxLines: en ? "A voucher can contain at most 100 inventory lines." : "يمكن أن يحتوي السند على 100 سطر مخزون كحد أقصى.",
    quantityError: en ? "Enter a positive weight with up to two decimal places." : "أدخل وزناً موجباً بمنزلتين عشريتين كحد أقصى.",
    overBalance: en ? "The delivery weight exceeds the available balance." : "وزن التسليم يتجاوز الرصيد المتاح.",
    selectLine: en ? "Choose at least one inventory line." : "اختر سطراً واحداً على الأقل من المخزون.",
    saveError: en ? "The voucher could not be saved. Retry the same operation." : "تعذر حفظ السند. أعد محاولة العملية نفسها.",
    secureError: en ? "A secure request identifier could not be created." : "تعذر إنشاء معرّف آمن للطلب.",
    selectedClient: en ? "Recipient (from selected stock)" : "المستلم (من المخزون المحدد)",
    migrationShort: en ? "Delivery vouchers are unavailable: required migration missing." : "سندات التسليم غير متاحة: ترقية قاعدة البيانات المطلوبة غير مطبقة.",
  };
};

const englishSafe = (value: string | null | undefined) => {
  const safe = (value ?? "").trim();
  return /[\u0600-\u06ff]/.test(safe) ? "" : safe;
};
const localized = (ar: string | null | undefined, en: string | null | undefined, language: string) =>
  (language === "en" ? englishSafe(en) : (ar ?? "").trim() || englishSafe(en)) || "—";
const asKg = (value: string | number | null | undefined, language: string) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(String(value).replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, "."));
  return Number.isFinite(n) ? new Intl.NumberFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 }).format(n) : "—";
};
const formatDate = (value: string, language: string) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
}).format(new Date(value));
const nameOf = (item: DeliveryStock, language: string) =>
  localized(item.product?.name_ar, item.product?.name, language) === "—"
    ? localized(item.product?.customer_name_ar, item.product?.customer_name, language)
    : localized(item.product?.name_ar, item.product?.name, language);
const customerOfStock = (item: DeliveryStock, language: string) =>
  localized(item.product?.customer_name_ar, item.product?.customer_name, language);
const idempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("secure");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function ErrorNotice({ message, retry, label }: { message: string; retry: () => void; label: string }) {
  return <div className="prod-error" role="alert"><span>{message}</span><button className="prod-btn quiet" onClick={retry} type="button"><RefreshCw />{label}</button></div>;
}

function VoucherDialog({
  language, rows, stock, customerId, customerName, onRows, notes, onNotes, pending, error, saved,
  onSubmit, onRetry, onClose, openerRef,
}: {
  language: string; rows: DraftLine[]; stock: DeliveryStock[]; customerId: string; customerName: string;
  onRows: (rows: DraftLine[]) => void; notes: string; onNotes: (value: string) => void;
  pending: boolean; error: string; saved: FinishedDelivery | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void; onClose: () => void; openerRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const t = copy(language);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState(false);
  const savedRef = useRef(saved);
  const pendingRef = useRef(pending);
  const closeRef = useRef(onClose);
  savedRef.current = saved;
  pendingRef.current = pending;
  closeRef.current = onClose;
  const stockById = useMemo(() => new Map(stock.map(item => [String(item.id), item])), [stock]);
  const canEdit = !pending && !saved;
  const validRows = rows.filter(row => row.inventoryId && row.quantity.trim());
  let total = 0n;
  try {
    for (const row of validRows) total += kgHundredths(row.quantity);
  } catch { total = 0n; }
  const focusable = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.offsetParent !== null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = openerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (focusable(dialog)[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pendingRef.current && !savedRef.current) closeRef.current();
      } else if (event.key === "Tab") {
        const items = focusable(dialog);
        if (!items.length) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
        else if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? items[items.length - 1] : items[0]).focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [openerRef]);

  const updateLine = (index: number, patch: Partial<DraftLine>) => onRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const removeLine = (index: number) => onRows(rows.filter((_, rowIndex) => rowIndex !== index));
  const addLine = () => { if (rows.length < 100) onRows([...rows, { inventoryId: "", quantity: "" }]); };
  const printable = saved ? () => printDelivery(saved, language) : undefined;

  return createPortal(<div className="production finished-delivery-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !pending && !saved) onClose();
  }}>
    <section ref={dialogRef} className="finished-delivery-dialog" role="dialog" aria-modal="true"
      aria-labelledby="finished-delivery-title" dir={language === "ar" ? "rtl" : "ltr"} tabIndex={-1}>
      <header className="finished-delivery-header">
        <div><span className="warehouse-section-kicker">WAREHOUSE / DELIVERY</span><h2 id="finished-delivery-title">{saved ? t.saved : t.newTitle}</h2>
          <p>{saved ? `${t.voucher} ${saved.voucher_number} · ${localized(saved.customer_name_ar, saved.customer_name, language)}` : t.subtitle}</p></div>
        <div className="finished-delivery-header-actions">
          {saved && <button className="prod-btn secondary" type="button" onClick={printable}><Printer />{t.print}</button>}
          {!pending && <button className="finished-delivery-close" type="button" aria-label={t.close} onClick={onClose}><X /></button>}
        </div>
      </header>
      {saved ? <div className="finished-delivery-saved" role="status">
        <span>{t.voucher}</span><strong>{saved.voucher_number}</strong>
        <span>{t.customer}</span><strong>{localized(saved.customer_name_ar, saved.customer_name, language)}</strong>
        <span>{t.total}</span><strong>{asKg(saved.items.reduce((sum, line) => sum + Number(line.quantity_kg), 0), language)} kg</strong>
      </div> : <form onSubmit={onSubmit}>
        <div className="finished-delivery-recipient"><small>{t.selectedClient}</small><strong>{customerName || "—"}</strong></div>
        {preview ? <section className="finished-delivery-preview" aria-label={t.preview}>
          <div className="finished-delivery-preview-head"><strong>{t.newTitle}</strong><span>{customerName}</span></div>
          <div className="finished-delivery-preview-lines">
            {validRows.map((row, index) => {
              const item = stockById.get(row.inventoryId);
              return <div key={`${row.inventoryId}-${index}`}><span>{item ? `${item.production_order_number} · ${nameOf(item, language)}` : "—"}</span><bdi>{row.quantity} kg</bdi></div>;
            })}
          </div>
          <div className="finished-delivery-preview-total"><span>{t.total}</span><strong>{kgString(total)} kg</strong></div>
          {notes.trim() && <p>{notes}</p>}
        </section> : <>
          <div className="finished-delivery-lines">
            {rows.map((row, index) => {
              const chosen = stockById.get(row.inventoryId);
              const options = stock.filter(item => item.customer_id === customerId || !customerId);
              return <div className="finished-delivery-line" key={index}>
                <label className="prod-field">
                  <span>{t.product}</span>
                  <select value={row.inventoryId} disabled={!canEdit} onChange={event => updateLine(index, { inventoryId: event.target.value })} aria-label={`${t.product} ${index + 1}`}>
                    <option value="">{t.choose}</option>
                    {options.map(item => <option key={item.id} value={item.id}>{item.production_order_number} · {nameOf(item, language)} · {asKg(item.quantity_kg, language)} kg</option>)}
                  </select>
                </label>
                <span className="finished-delivery-available"><small>{t.available}</small><bdi>{chosen ? `${asKg(chosen.quantity_kg, language)} kg` : "—"}</bdi></span>
                <label className="prod-field">
                  <span>{t.quantity}</span>
                  <input type="text" inputMode="decimal" value={row.quantity} disabled={!canEdit} maxLength={15}
                    onChange={event => updateLine(index, { quantity: event.target.value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, ".") })}
                    aria-label={`${t.quantity} ${index + 1}`} />
                </label>
                <button type="button" className="finished-delivery-remove" aria-label={`${t.remove} ${index + 1}`} disabled={!canEdit || rows.length <= 1} onClick={() => removeLine(index)}><X /></button>
              </div>;
            })}
          </div>
          <button className="prod-btn secondary finished-delivery-add" type="button" disabled={!canEdit || rows.length >= 100} onClick={addLine}>{t.addLine}</button>
          <label className="prod-field finished-delivery-notes"><span>{t.notes}</span><textarea rows={2} maxLength={2000} value={notes} disabled={!canEdit} onChange={event => onNotes(event.target.value)} /></label>
          <div className="finished-delivery-total"><span>{t.total}</span><strong>{kgString(total)} kg</strong></div>
        </>}
        {error && <div className="prod-error finished-delivery-error" role="alert"><span>{error}</span>{pending && <button className="prod-btn quiet" type="button" onClick={onRetry}>{t.retry}</button>}</div>}
        <footer className="finished-delivery-footer">
          {preview ? <button className="prod-btn secondary" type="button" disabled={!canEdit} onClick={() => setPreview(false)}><ArrowUp />{t.backToEdit}</button>
            : <button className="prod-btn secondary" type="button" disabled={!validRows.length} onClick={() => setPreview(true)}><ArrowDown />{t.preview}</button>}
          {preview && <button className="prod-btn" type="submit" disabled={!canEdit || !validRows.length}>{t.save}</button>}
          {!pending && <button className="prod-btn quiet" type="button" onClick={onClose}>{t.cancel}</button>}
        </footer>
      </form>}
    </section>
  </div>, document.body);
}

export default function FinishedInventory({ user, language, refresh, reload }: Props) {
  const t = copy(language);
  const canRead = hasProductionPermission(user, "view_finished_inventory", "manage_finished_warehouse");
  const canWrite = hasProductionPermission(user, "manage_finished_warehouse");
  const [stock, setStock] = useState<DeliveryStock[]>([]);
  const [stockLoading, setStockLoading] = useState(canRead);
  const [stockError, setStockError] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [stockMore, setStockMore] = useState<number | null>(null);
  const [stockMoreLoading, setStockMoreLoading] = useState(false);
  const stockGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const [history, setHistory] = useState<FinishedDelivery[]>([]);
  const [historyLoading, setHistoryLoading] = useState(canRead);
  const [historyError, setHistoryError] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyMore, setHistoryMore] = useState<number | null>(null);
  const [historyMoreLoading, setHistoryMoreLoading] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [rows, setRows] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<PendingDelivery | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FinishedDelivery | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const draftSnapshot = useRef("");
  draftSnapshot.current = JSON.stringify({ rows, notes });
  const savingRef = useRef(false);

  const cancelLoads = useCallback(() => {
    stockGeneration.current++;
    historyGeneration.current++;
  }, []);

  const loadStock = useCallback(async (query = stockQuery, before?: number, append = false) => {
    const generation = before === undefined ? ++stockGeneration.current : stockGeneration.current;
    if (!canRead) { setStockLoading(false); return; }
    if (before === undefined) { setStockLoading(true); setStockError(""); }
    else setStockMoreLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (before !== undefined) params.set("before", String(before));
      if (query.trim()) params.set("search", query.trim());
      const result = await productionRequest<Page<DeliveryStock>>(`/delivery-stock?${params}`);
      if (generation !== stockGeneration.current) return;
      setStock(current => append ? [...current, ...result.records] : result.records);
      setStockMore(result.next);
    } catch (cause) {
      if (generation === stockGeneration.current) {
        setStockError(cause instanceof ProductionRequestError && cause.status === 503 ? t.migration : cause instanceof Error ? cause.message : t.loadError);
      }
    } finally {
      if (generation === stockGeneration.current) {
        if (before === undefined) setStockLoading(false);
        else setStockMoreLoading(false);
      }
    }
  }, [canRead, stockQuery, t.loadError, t.migration]);

  const loadHistory = useCallback(async (query = historyQuery, before?: number, append = false) => {
    const generation = before === undefined ? ++historyGeneration.current : historyGeneration.current;
    if (!canRead) { setHistoryLoading(false); return; }
    if (before === undefined) { setHistoryLoading(true); setHistoryError(""); }
    else setHistoryMoreLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (before !== undefined) params.set("before", String(before));
      if (query.trim()) params.set("search", query.trim());
      const result = await productionRequest<Page<FinishedDelivery>>(`/deliveries?${params}`);
      if (generation !== historyGeneration.current) return;
      setHistory(current => append ? [...current, ...result.records] : result.records);
      setHistoryMore(result.next);
    } catch (cause) {
      if (generation === historyGeneration.current) {
        setHistoryError(cause instanceof ProductionRequestError && cause.status === 503 ? t.migration : cause instanceof Error ? cause.message : t.loadError);
      }
    } finally {
      if (generation === historyGeneration.current) {
        if (before === undefined) setHistoryLoading(false);
        else setHistoryMoreLoading(false);
      }
    }
  }, [canRead, historyQuery, t.loadError, t.migration]);

  useEffect(() => {
    void loadStock(stockQuery);
    void loadHistory(historyQuery);
    return cancelLoads;
  }, [refresh, stockQuery, historyQuery, loadStock, loadHistory, cancelLoads]);

  const visibleStock = useMemo(() => stock.filter(item => {
    try { return kgHundredths(item.quantity_kg) > 0n; } catch { return false; }
  }), [stock]);
  const selectedStock = useMemo(() => selected.map(id => stock.find(item => item.id === id)).filter((item): item is DeliveryStock => Boolean(item)), [selected, stock]);
  const selectedCustomer = selectedStock[0]?.customer_id ?? "";
  const selectedCount = selected.length;
  const selectable = (item: DeliveryStock) => !selectedCustomer || item.customer_id === selectedCustomer;

  const openVoucher = (button?: HTMLButtonElement) => {
    if (!canWrite || !selectedStock.length || selectedStock.length > 100) return;
    if (button) openerRef.current = button;
    const first = selectedStock[0];
    setSelectedCustomerId(first.customer_id);
    setSelectedCustomerName(customerOfStock(first, language));
    setRows(selectedStock.slice(0, 100).map(item => ({ inventoryId: String(item.id), quantity: "" })));
    setNotes(""); setFormError(""); setPending(null); setSaved(null); setModalOpen(true);
  };
  const closeModal = useCallback(() => {
    if (savingRef.current || pending) return;
    setModalOpen(false);
    setSaved(null);
  }, [pending]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || pending || saved) return;
    if (rows.length > 100) { setFormError(t.maxLines); return; }
    if (selectedCustomerId === "") { setFormError(t.selectLine); return; }
    if (!rows.length || rows.some(row => !row.inventoryId)) { setFormError(t.selectLine); return; }
    const totals = new Map<number, bigint>();
    for (const row of rows) {
      let amount: bigint;
      try { amount = kgHundredths(row.quantity); } catch { setFormError(t.quantityError); return; }
      if (amount <= 0n) { setFormError(t.quantityError); return; }
      const stockItem = stock.find(item => String(item.id) === row.inventoryId);
      if (!stockItem || stockItem.customer_id !== selectedCustomerId) { setFormError(t.customerOnly); return; }
      totals.set(stockItem.id, (totals.get(stockItem.id) ?? 0n) + amount);
    }
    for (const [inventoryId, amount] of totals) {
      const balance = stock.find(item => item.id === inventoryId);
      let available = 0n;
      try { available = balance ? kgHundredths(balance.quantity_kg) : 0n; } catch { /* invalid live balance fails closed */ }
      if (amount > available) { setFormError(t.overBalance); return; }
    }
    if (!totals.size) { setFormError(t.selectLine); return; }
    const draftAtSubmit = draftSnapshot.current;
    const items = [...totals].map(([inventory_id, quantity]) => ({ inventory_id, quantity_kg: kgString(quantity) }));
    try {
      const input: DeliveryInput = { request_id: idempotencyKey(), notes: notes.trim() || undefined, items };
      setPending(input);
      setFormError("");
      void performDelivery(input, draftAtSubmit);
    } catch { setFormError(t.secureError); }
  };

  async function performDelivery(input: DeliveryInput, submittedDraft = draftSnapshot.current) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setFormError("");
    try {
      const result = await productionRequest<FinishedDelivery>("/deliveries", input);
      setSaved(result); setPending(null);
      if (draftSnapshot.current === submittedDraft) { setRows([]); setNotes(""); setSelected([]); }
      window.dispatchEvent(new Event("production-data-changed"));
      await Promise.all([reload(), loadStock(stockQuery), loadHistory(historyQuery)]);
    } catch (cause) {
      setFormError(cause instanceof ProductionRequestError && cause.status === 503 ? t.migrationShort : cause instanceof Error ? cause.message : t.saveError);
      if (confirmedProductionRejection(cause)) setPending(null);
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  const retry = () => { if (pending) void performDelivery(pending); };
  const toggle = (item: DeliveryStock, checked: boolean) => setSelected(current => {
    if (checked) {
      if (current.length >= 100 || (current.length > 0 && item.customer_id !== selectedCustomer)) return current;
      return current.includes(item.id) ? current : [...current, item.id];
    }
    return current.filter(id => id !== item.id);
  });

  if (!canRead) return <section className="warehouse-finished-view"><div className="prod-empty"><strong>{language === "en" ? "You do not have permission to view finished inventory." : "لا تملك صلاحية عرض المخزون التام."}</strong></div></section>;
  return <div className="finished-inventory-page">
    <section className="warehouse-finished-view">
      <div className="warehouse-section-heading">
        <div><span className="warehouse-section-kicker">FINISHED STOCK / CUSTOMER DELIVERY</span><h3>{t.balances}</h3></div>
        <div className="finished-inventory-actions">
          <span>{asKg(visibleStock.length, language)} {t.stockCount}</span>
          <button className="prod-btn quiet" type="button" disabled={stockLoading} onClick={() => { void loadStock(stockQuery); void loadHistory(historyQuery); }}><RefreshCw />{t.refresh}</button>
        </div>
      </div>
      <form className="finished-inventory-search" onSubmit={event => { event.preventDefault(); setSelected([]); setStockQuery(stockSearch.trim()); }}>
        <label><Search /><span className="sr-only">{t.search}</span><input value={stockSearch} onChange={event => setStockSearch(event.target.value)} placeholder={t.search} /></label>
        <button className="prod-btn secondary" type="submit">{t.search}</button>
      </form>
      {stockError && <ErrorNotice message={stockError} retry={() => void loadStock(stockQuery)} label={t.retry} />}
      {stockLoading && !stock.length ? <div className="finished-inventory-skeleton" aria-label={language === "en" ? "Loading finished inventory" : "جارٍ تحميل المخزون التام"}><i /><i /><i /><i /><i /><i /></div>
        : visibleStock.length ? <>
          <div className="warehouse-hall-grid">
            {visibleStock.map(item => {
              const complete = Boolean(item.production_complete);
              const checked = selected.includes(item.id);
              const allowed = selectable(item) && (checked || selected.length < 100);
              return <article className="warehouse-order-card" key={item.id}>
                <header><div><span className="warehouse-order-number">{item.production_order_number}</span><small>{t.order}: {item.order_number}</small></div>
                  <span className={`warehouse-order-state${complete ? " complete" : ""}`} aria-label={`${complete ? t.complete : t.incomplete}`}>{complete ? t.complete : t.incomplete}</span></header>
                <div className="warehouse-order-product"><strong>{nameOf(item, language)}</strong><span>{customerOfStock(item, language)}</span></div>
                {canWrite && <label className="warehouse-order-select"><input type="checkbox" checked={checked} disabled={!allowed} onChange={event => toggle(item, event.target.checked)} /><span>{t.select}</span></label>}
                <div className="warehouse-order-metrics">
                  <div><span>{t.received}</span><strong>{asKg(item.received_kg, language)} <small>kg</small></strong></div>
                  <div><span>{t.delivered}</span><strong>{asKg(item.delivered_kg, language)} <small>kg</small></strong></div>
                  <div className="remaining"><span>{t.remaining}</span><strong>{asKg(item.quantity_kg, language)} <small>kg</small></strong></div>
                </div>
              </article>;
            })}
          </div>
          {stockMore !== null && <div className="finished-inventory-more"><button className="prod-btn secondary" type="button" disabled={stockMoreLoading} onClick={() => void loadStock(stockQuery, stockMore, true)}>{stockMoreLoading ? "…" : t.more}</button></div>}
        </> : !stockError ? <div className="prod-empty"><strong>{t.noStock}</strong><span>{t.noStockDetail}</span></div> : null}
      {canWrite && <div className="finished-inventory-selection">
        <span>{selectedCount} {t.selected}{selectedCustomerName ? ` · ${selectedCustomerName}` : ""}</span>
        <div><button className="prod-btn" type="button" disabled={!selectedCount || selectedCount > 100} onClick={event => openVoucher(event.currentTarget)} ref={node => { if (node && modalOpen) openerRef.current = node; }}>{t.newVoucher}</button>
          <button className="prod-btn quiet" type="button" disabled={!selectedCount} onClick={() => setSelected([])}>{t.clear}</button></div>
      </div>}
      {!canWrite && <p className="finished-inventory-readonly">{t.permission}</p>}
    </section>

    <details className="warehouse-receipt-history finished-delivery-history">
      <summary className="warehouse-section-heading finished-delivery-history-toggle">
        <span><span className="warehouse-section-kicker">DELIVERY / AUDIT TRAIL</span><strong>{t.history}</strong></span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <form className="finished-inventory-search" onSubmit={event => { event.preventDefault(); setHistoryQuery(historySearch.trim()); }}>
        <label><Search /><span className="sr-only">{t.searchHistory}</span><input value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder={t.searchHistory} /></label>
        <button className="prod-btn secondary" type="submit">{t.search}</button>
      </form>
      {historyError && <ErrorNotice message={historyError} retry={() => void loadHistory(historyQuery)} label={t.retry} />}
      {historyLoading && !history.length ? <div className="finished-inventory-skeleton history" aria-label={language === "en" ? "Loading delivery history" : "جارٍ تحميل سجل التسليم"}><i /><i /><i /></div>
        : history.length ? <div className="warehouse-receipt-ledger">
          {history.map(delivery => <article className="warehouse-receipt-history-card finished-delivery-history-card" key={delivery.id}>
            <header><div><strong>{delivery.voucher_number}</strong><time dateTime={delivery.created_at}>{formatDate(delivery.created_at, language)}</time></div>
              <button className="prod-btn quiet" type="button" onClick={() => printDelivery(delivery, language)}><Printer />{t.print}</button></header>
            <p><b>{t.customer}:</b> {localized(delivery.customer_name_ar, delivery.customer_name, language)}</p>
            <div className="finished-delivery-history-items">
              {delivery.items.map(line => <div className="warehouse-receipt-history-line" key={line.id}>
                <span>{line.production_order_number}</span>
                <div><strong>{localized(line.product?.name_ar, line.product?.name, language)}</strong></div>
                <bdi>{asKg(line.quantity_kg, language)} kg</bdi>
              </div>)}
            </div>
            <div className="finished-delivery-history-total"><span>{t.total}</span><strong>{asKg(delivery.items.reduce((sum, item) => sum + Number(item.quantity_kg), 0), language)} kg</strong></div>
            {delivery.notes && <p className="finished-delivery-history-notes">{delivery.notes}</p>}
          </article>)}
        </div> : !historyError ? <div className="prod-empty"><strong>{t.noHistory}</strong><span>{t.noHistoryDetail}</span></div> : null}
      {historyMore !== null && <div className="finished-inventory-more"><button className="prod-btn secondary" type="button" disabled={historyMoreLoading} onClick={() => void loadHistory(historyQuery, historyMore, true)}>{historyMoreLoading ? "…" : t.more}</button></div>}
    </details>
    {modalOpen && <VoucherDialog language={language} rows={rows} stock={stock} customerId={selectedCustomerId} customerName={selectedCustomerName}
      onRows={setRows} notes={notes} onNotes={setNotes} pending={saving || Boolean(pending)} error={formError} saved={saved}
      onSubmit={submit} onRetry={retry} onClose={closeModal} openerRef={openerRef} />}
  </div>;
}
