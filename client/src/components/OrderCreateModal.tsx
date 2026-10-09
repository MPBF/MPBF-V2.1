import { localizedName, translate, translateError } from "../i18n";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle, Boxes, Check, ClipboardList, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import "./OrderCreateModal.css";
import CustomerProductSelect from "./CustomerProductSelect";
import CustomerProductModal from "./CustomerProductModal";
import { deriveCustomerProductFields, type ProductInput } from "../../../shared/customer-product-fields";
import { validateCustomerProductForm } from "./customer-product-form";

type Row = Record<string, any>;
type OrderLine = {
  key: number;
  id?: number;
  productionNumber?: string;
  locked?: boolean;
  mode: "existing" | "new";
  customerProductId: string;
  quantityKg: string;
  newProduct?: ProductInput;
};
type ChoiceState = { values: Row[]; loading: boolean; error: string };

const freshLine = (key: number): OrderLine => ({
  key,
  mode: "existing",
  customerProductId: "",
  quantityKg: "",
});

const getRows = (payload: any): Row[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const readApi = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback: Record<number, string> = {
      400: "البيانات المدخلة غير صالحة.",
      401: "انتهت الجلسة؛ يرجى تسجيل الدخول من جديد.",
      403: "لا تملك صلاحية تسجيل هذا الطلب.",
      404: "تعذر العثور على البيانات المطلوبة.",
      409: "يوجد تعارض في بيانات الطلب.",
      422: "تعذر التحقق من صحة البيانات.",
      500: "حدث خطأ في الخادم. حاول مرة أخرى.",
    };
    throw new Error(translateError(body?.message || fallback[response.status] || "تعذر إكمال الطلب."));
  }
  return body;
};

const readAllChoices = async (path: string): Promise<Row[]> => {
  const results: Row[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = getRows(await readApi(`${path}?limit=200&offset=${offset}`));
    results.push(...page);
    if (page.length < 200) return results;
  }
};

const labelFor = (row: Row) => localizedName(row.name_ar || row.display_name_ar, row.name || row.display_name, String(row.id || ""));
const customerLabel = (row: Row) => localizedName(row.name_ar || row.display_name_ar, row.name_en || row.display_name_en || row.name || row.display_name, String(row.id || ""));
const riyadhDate = (value: Date | string = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const normalizeDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
const isCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const legacyDeliveryDays = (createdAt: unknown, deliveryDate: unknown) => {
  const start = riyadhDate(String(createdAt ?? ""));
  const end = typeof deliveryDate === "string" ? deliveryDate.slice(0, 10) : "";
  if (!isCalendarDate(start) || !isCalendarDate(end)) return null;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const difference = (endTime - startTime) / 86_400_000;
  return Number.isInteger(difference) && difference >= 1 && difference <= 3650 ? difference : null;
};
const validDeliveryDays = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = normalizeDigits(String(value)).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const days = Number(normalized);
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : null;
};
const wholeMeasure = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const number = Number(normalizeDigits(String(value)).replace("٫", "."));
  return Number.isFinite(number) ? String(Math.round(number)) : "";
};
const productLabel = (product: Row) => {
  const width = wholeMeasure(product.width);
  const thickness = wholeMeasure(product.thickness);
  const details = [
    localizedName(product.category_name_ar, product.category_name, ""),
    localizedName(product.item_name_ar, product.item_name, ""),
    product.size_caption,
    width ? `${translate("العرض")} ${width} ${translate("سم")}` : "",
    thickness ? `${translate("السماكة")} ${thickness} µ` : "",
    product.raw_material ? `${translate("الخام:")} ${product.raw_material}` : "",
  ].filter(Boolean);
  return details.join(" · ") || (product.id ? translate("منتج رقم {{number}}", { number: product.id }) : translate("منتج جديد"));
};

function Alert({ children, info = false }: { children: ReactNode; info?: boolean }) {
  return <div className={`order-create-alert${info ? " info" : ""}`} role={info ? "status" : "alert"}><AlertCircle size={17} aria-hidden="true" /><div>{children}</div></div>;
}

function CustomerSearchSelect({ customers, selectedId, onSelect, disabled }: {
  customers: Row[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = customers.find((customer) => String(customer.id) === selectedId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = customers.filter((customer) => [
    customer.name_ar, customer.display_name_ar, customer.name_en, customer.display_name_en,
    customer.name, customer.display_name, customer.id,
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery)));
  const visibleMatches = matches.slice(0, 100);

  useEffect(() => {
    if (selected) setQuery(customerLabel(selected));
  }, [selected?.id]);

  const choose = (customer: Row) => {
    onSelect(String(customer.id));
    setQuery(customerLabel(customer));
    setOpen(false);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => visibleMatches.length ? (index + 1) % visibleMatches.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => visibleMatches.length ? (index - 1 + visibleMatches.length) % visibleMatches.length : 0);
    } else if (event.key === "Enter" && open && visibleMatches[activeIndex]) {
      event.preventDefault();
      choose(visibleMatches[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery(selected ? customerLabel(selected) : "");
    }
  };

  return (
    <div className="order-customer-picker">
      <div className="order-customer-input-wrap">
        <input
          id="order-customer"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="order-customer-options"
          aria-activedescendant={open && visibleMatches[activeIndex] ? `order-customer-option-${visibleMatches[activeIndex].id}` : undefined}
          aria-label={translate("ابحث عن العميل بالاسم أو الرقم")}
          value={query}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (selectedId) onSelect("");
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={translate("ابحث باسم العميل أو رقمه")}
          autoComplete="off"
          disabled={disabled}
          required={!selectedId}
        />
        {selectedId && !disabled && (
          <button className="order-customer-clear" type="button" aria-label={translate("مسح العميل المحدد")} onMouseDown={(event) => event.preventDefault()} onClick={() => {
            onSelect("");
            setQuery("");
            setOpen(true);
          }}><X size={15} /></button>
        )}
      </div>
      {open && !disabled && (
        <div className="order-customer-options" id="order-customer-options" role="listbox" aria-label={translate("نتائج العملاء")}>
          {visibleMatches.length ? visibleMatches.map((customer, index) => (
            <button
              id={`order-customer-option-${customer.id}`}
              className={`order-customer-option${index === activeIndex ? " is-active" : ""}`}
              key={customer.id ?? index}
              type="button"
              role="option"
              aria-selected={String(customer.id) === selectedId}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(customer)}
            >
              <span>{customerLabel(customer)}</span><small>#{customer.id}</small>
            </button>
          )) : <div className="order-customer-empty" role="status">{translate("لا توجد نتائج مطابقة.")}</div>}
        </div>
      )}
    </div>
  );
}

export default function OrderCreateModal({ editId, onClose, onSaved }: { editId?: number; onClose: () => void; onSaved: () => void }) {
  const [customers, setCustomers] = useState<ChoiceState>({ values: [], loading: true, error: "" });
  const [categories, setCategories] = useState<ChoiceState>({ values: [], loading: true, error: "" });
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerProducts, setCustomerProducts] = useState<Row[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [reloadOptions, setReloadOptions] = useState(0);
  const [orderNumber, setOrderNumber] = useState("");
  const [numberLoading, setNumberLoading] = useState(!editId);
  const [numberError, setNumberError] = useState("");
  const [numberRetry, setNumberRetry] = useState(0);
  const [orderCreatedDate, setOrderCreatedDate] = useState(() => riyadhDate());
  const [deliveryDays, setDeliveryDays] = useState("20");
  const [notes, setNotes] = useState("");
  const [originalItems, setOriginalItems] = useState<{ id: number; customer_product_id: number | null; quantity_kg: string }[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(Boolean(editId));
  const [detailsError, setDetailsError] = useState("");
  const [detailsRetry, setDetailsRetry] = useState(0);
  const [lines, setLines] = useState<OrderLine[]>([freshLine(1)]);
  const [nextLineKey, setNextLineKey] = useState(2);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [productEditorKey, setProductEditorKey] = useState<number | null>(null);
  const orderPanelRef = useRef<HTMLElement>(null);
  const productReturnFocus = useRef<HTMLElement | null>(null);
  const activeProductLine = lines.find((line) => line.key === productEditorKey);

  useEffect(() => {
    orderPanelRef.current?.toggleAttribute("inert", productEditorKey !== null);
    if (productEditorKey === null) {
      productReturnFocus.current?.focus();
      productReturnFocus.current = null;
    }
  }, [productEditorKey]);

  useEffect(() => {
    if (editId) return;
    const timer = window.setInterval(() => setOrderCreatedDate(riyadhDate()), 60_000);
    return () => window.clearInterval(timer);
  }, [editId]);

  useEffect(() => {
    if (editId) return;
    let active = true;
    setNumberLoading(true);
    setNumberError("");
    readApi("/api/orders/next-number", { cache: "no-store" }).then((data) => {
      if (typeof data.order_number !== "string" || !/^O\d+$/.test(data.order_number)) {
        throw new Error(translate("تعذر تحميل رقم الطلب."));
      }
      if (active) setOrderNumber(data.order_number);
    }).catch((cause) => {
      if (active) setNumberError((cause as Error).message);
    }).finally(() => {
      if (active) setNumberLoading(false);
    });
    return () => { active = false; };
  }, [editId, numberRetry]);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    setDetailsLoading(true);
    setDetailsError("");
    readApi(`/api/orders/${editId}/with-items`).then((data) => {
      if (!active) return;
      setOrderNumber(data.order.order_number);
      setOrderCreatedDate(riyadhDate(data.order.created_at));
      setSelectedCustomer(data.order.customer_id);
      const savedDays = validDeliveryDays(data.order.delivery_days);
      setDeliveryDays(String(savedDays ?? legacyDeliveryDays(data.order.created_at, data.order.delivery_date) ?? 20));
      setNotes(data.order.notes || "");
      setOriginalItems(data.items.map((line: Row) => ({
        id: line.id, customer_product_id: line.customer_product_id, quantity_kg: line.quantity_kg,
      })));
      setLines(data.items.map((line: Row, index: number) => ({
        ...freshLine(index + 1),
        id: line.id,
        productionNumber: line.production_order_number,
        locked: line.status !== "pending" || Boolean(line.batch_number),
        customerProductId: String(line.customer_product_id ?? ""),
        quantityKg: String(line.quantity_kg),
      })));
      setNextLineKey(data.items.length + 1);
      setDetailsLoading(false);
    }).catch((e) => {
      if (active) { setDetailsError((e as Error).message); setDetailsLoading(false); }
    });
    return () => { active = false; };
  }, [editId, detailsRetry]);

  useEffect(() => {
    let active = true;
    const loadChoices = async (path: string, setter: (value: ChoiceState) => void) => {
      setter({ values: [], loading: true, error: "" });
      try {
        const values = await readAllChoices(path);
        if (active) setter({ values, loading: false, error: "" });
      } catch (e) {
        if (active) setter({ values: [], loading: false, error: (e as Error).message });
      }
    };
    void loadChoices("/api/customers", setCustomers);
    void loadChoices("/api/categories", setCategories);
    return () => { active = false; };
  }, [reloadOptions]);

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerProducts([]);
      setProductsLoading(false);
      setProductsError("");
      return;
    }
    const controller = new AbortController();
    setProductsLoading(true);
    setProductsError("");
    setCustomerProducts([]);
    readApi(`/api/customers/${encodeURIComponent(selectedCustomer)}/detail`, { signal: controller.signal })
      .then((payload) => {
        const products = Array.isArray(payload?.products) ? payload.products : Array.isArray(payload?.data?.products) ? payload.data.products : [];
        setCustomerProducts(products);
        setProductsLoading(false);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") {
          setProductsError((e as Error).message);
          setProductsLoading(false);
        }
      });
    return () => controller.abort();
  }, [selectedCustomer, reloadOptions]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && productEditorKey === null && !savingRef.current) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, productEditorKey]);

  const updateLine = (key: number, patch: Partial<OrderLine>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  };
  const openProductEditor = (key: number) => {
    productReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setProductEditorKey(key);
  };

  const addLine = () => {
    if (lines.length >= 25) return;
    setLines((current) => [...current, freshLine(nextLineKey)]);
    setNextLineKey((key) => key + 1);
  };

  const changeCustomer = (value: string) => {
    if (editId) return;
    setSelectedCustomer(value);
    setLines((current) => current.map((line) => ({ ...line, mode: "existing", customerProductId: "", newProduct: undefined })));
  };

  const retryProducts = () => {
    if (selectedCustomer) setReloadOptions((value) => value + 1);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || productEditorKey !== null) return;
    setError("");
    if (detailsLoading || detailsError) return;
    const normalizedLines = lines.map((line) => ({ ...line, quantityKg: normalizeDigits(line.quantityKg) }));
    if (!selectedCustomer) {
      setError(translate("يرجى اختيار العميل."));
      return;
    }
    const normalizedDeliveryDays = validDeliveryDays(deliveryDays);
    if (normalizedDeliveryDays === null) {
      setError(translate("أدخل مدة تسليم صحيحة من يوم واحد إلى 3650 يوماً."));
      return;
    }
    if (normalizedLines.length < 1) {
      setError(translate("أضف منتجاً واحداً على الأقل إلى الطلب."));
      return;
    }
    for (let index = 0; index < normalizedLines.length; index += 1) {
      const line = normalizedLines[index];
      const quantity = Number(line.quantityKg.trim().replace(",", "."));
      if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(line.quantityKg.trim().replace(",", ".")) || !Number.isFinite(quantity) || quantity <= 0) {
        setError(`أدخل كمية صحيحة أكبر من صفر وبحد أقصى منزلتين عشريتين للبند ${index + 1}.`);
        return;
      }
      if (line.mode === "existing" && !line.customerProductId) {
        setError(`اختر منتج العميل للبند ${index + 1}، أو أضف منتجاً جديداً.`);
        return;
      }
      if (line.mode === "new") {
        if (!line.newProduct) {
          setError(`أكمل نموذج المنتج الجديد للبند ${index + 1}.`);
          return;
        }
        const productError = validateCustomerProductForm({ ...line.newProduct, customer_id: selectedCustomer });
        if (productError) {
          setError(`منتج البند ${index + 1}: ${productError}`);
          return;
        }
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...(editId ? { original_items: originalItems } : { customer_id: selectedCustomer }),
        delivery_days: normalizedDeliveryDays,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: normalizedLines.map((line) => {
          const { customer_id: _customerId, ...draft } = line.newProduct || {};
          return {
          ...(editId && line.id ? { id: line.id } : {}),
          ...(line.mode === "existing"
            ? { customer_product_id: Number(line.customerProductId) }
            : { new_product: draft }),
          quantity_kg: line.quantityKg.trim().replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(",", "."),
          };
        }),
      };
      const body = JSON.stringify(payload);
      if (new Blob([body]).size > 16 * 1024 * 1024) throw new Error("حجم بيانات وتصاميم الطلب مجتمعة يتجاوز 16 ميغابايت. قلّل حجم الصور أو استخدم منتجات مسجلة.");
      await readApi(editId ? `/api/orders/${editId}/with-items` : "/api/orders/with-items", { method: editId ? "PUT" : "POST", body });
      onSaved();
    } catch (e) {
      setError((e as Error).message || "تعذر حفظ الطلب.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const baseOptionErrors = [customers.error, categories.error].filter(Boolean);
  return (
    <div className="order-create-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && productEditorKey === null && onClose()}>
      <section ref={orderPanelRef} className="order-create-modal" role="dialog" aria-modal={productEditorKey === null} aria-hidden={productEditorKey !== null ? true : undefined} aria-labelledby="order-create-title">
        <header className="order-create-head bg-[#183f3a] text-[#fbfcf8]">
          <div className="order-create-heading">
            <span className="order-create-mark" aria-hidden="true"><ClipboardList size={21} /></span>
            <div>
              <h2 id="order-create-title">{editId ? translate("تعديل طلب العميل") : translate("تسجيل طلب عميل")}</h2>
              <p>{editId ? translate("عدّل البنود التي لم يبدأ إنتاجها. البنود قيد العمل محفوظة دون تغيير.") : translate("أدخل بيانات الطلب ثم أضف الأصناف والكميات بالكيلوغرام.")}</p>
            </div>
          </div>
          <button className="order-create-close" type="button" aria-label={translate("إغلاق نافذة الطلب")} title={translate("إغلاق")} disabled={saving} onClick={onClose}><X size={20} /></button>
        </header>

        <form className="order-create-form" noValidate onSubmit={submit}>
          {error && <Alert>{error}</Alert>}
          {detailsLoading && <div className="order-options-state" role="status">{translate("جارٍ تحميل بنود الطلب…")}</div>}
          {detailsError && <Alert>{translate("تعذر تحميل بنود الطلب:")}{" "}{detailsError} <button type="button" onClick={() => setDetailsRetry((value) => value + 1)}>{translate("إعادة المحاولة")}</button></Alert>}
          {baseOptionErrors.length > 0 && (
            <Alert>{translate("تعذر تحميل بعض الخيارات. يمكنك إعادة المحاولة قبل المتابعة.")}<button type="button" className="order-options-state-retry" onClick={() => setReloadOptions((value) => value + 1)}>{translate("إعادة تحميل الخيارات")}</button>
            </Alert>
          )}

          <section className="order-create-section" aria-labelledby="order-main-heading">
            <h3 className="order-create-section-title" id="order-main-heading"><span>01</span>{" "}{translate("بيانات الطلب")}</h3>
            <div className="order-create-grid">
              <div className="order-create-field order-create-number">
                <label htmlFor="order-number">{translate("رقم الطلب")}</label>
                <div className="order-create-field-static order-number-readonly" id="order-number" dir="ltr" aria-busy={numberLoading}>
                  {numberLoading ? <LoaderCircle size={18} aria-label={translate("جارٍ التحميل…")} /> : (numberError ? "—" : orderNumber || "—")}
                </div>
                {numberError && <Alert>{numberError}<button type="button" className="order-options-state-retry" onClick={() => setNumberRetry(value => value + 1)}>{translate("إعادة المحاولة")}</button></Alert>}
              </div>
              <div className="order-create-field order-created-date-field">
                <label htmlFor="order-created-date">{translate("تاريخ الطلب")}</label>
                <div className="order-create-field-static order-date-readonly" id="order-created-date" dir="ltr">
                  {orderCreatedDate || "—"}
                </div>
              </div>
              <div className="order-create-field order-delivery-days-field">
                <label htmlFor="order-delivery-days">{translate("مدة التسليم")}{" "}<span aria-hidden="true">*</span></label>
                <input
                  id="order-delivery-days"
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  aria-label={translate("مدة التسليم بالأيام")}
                  value={deliveryDays}
                  onChange={(event) => setDeliveryDays(normalizeDigits(event.target.value).replace(/[^\d]/g, ""))}
                  minLength={1}
                  maxLength={4}
                  disabled={saving}
                  required
                />
              </div>
              <div className="order-create-field order-customer-field">
                <label htmlFor="order-customer">{translate("العميل")}{" "}<span aria-hidden="true">*</span></label>
                {customers.loading ? <div className="order-create-skeleton" aria-label={translate("جارٍ تحميل العملاء")} aria-busy="true"><i /><i /></div> :
                  editId ? <div className="order-create-field-static">{customerLabel(customers.values.find((customer) => String(customer.id) === String(selectedCustomer)) || {}) || "—"}</div> :
                  <CustomerSearchSelect customers={customers.values} selectedId={String(selectedCustomer)} onSelect={changeCustomer} disabled={saving || Boolean(customers.error)} />}
              </div>
            </div>
          </section>

          <section className="order-create-section" aria-labelledby="order-items-heading">
            <h3 className="order-create-section-title" id="order-items-heading"><span>02</span>{" "}{translate("منتجات الطلب")}</h3>
            {!selectedCustomer ? null : productsLoading ? (
              <div className="order-create-skeleton order-products-loading" aria-label={translate("جارٍ تحميل منتجات العميل")} aria-busy="true"><i /><i /><i /></div>
            ) : productsError ? (
              <div className="order-options-state" role="alert">{translate("تعذر تحميل منتجات هذا العميل:")}{" "}{productsError}<button type="button" onClick={retryProducts}>{translate("إعادة المحاولة")}</button></div>
            ) : null}

            {selectedCustomer && !productsLoading && !productsError && customerProducts.length === 0 && (
              <div className="order-options-state order-create-inline-note">{translate("لا توجد منتجات مسجلة لهذا العميل بعد. يمكنك إضافة تفاصيل منتج جديد مباشرةً في أحد البنود.")}</div>
            )}

            <div className="order-lines">
              {lines.map((line, index) => {
                return (
                  <article className="order-line-card" key={line.key} aria-label={`${translate("بند رقم")} ${index + 1}`}>
                    <div className="order-line-top">
                      <div className="order-line-title"><span className="order-line-index">{String(index + 1).padStart(2, "0")}</span> {line.productionNumber || translate("بند المنتج")} {line.locked && <small>{translate("· بدأ الإنتاج — للعرض فقط")}</small>}</div>
                      {lines.length > 1 && !line.locked && <button className="order-line-remove" type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={saving} aria-label={`${translate("حذف البند")} ${index + 1}`}><Trash2 size={15} />{" "}{translate("حذف البند")}</button>}
                    </div>

                    <div className="order-product-mode" role="group" aria-label={`${translate("مصدر المنتج للبند")} ${index + 1}`}>
                      <button type="button" aria-pressed={line.mode === "existing"} onClick={() => updateLine(line.key, { mode: "existing", newProduct: undefined })} disabled={saving || line.locked}>{translate("منتج مسجل")}</button>
                      <button type="button" aria-pressed={line.mode === "new"} onClick={() => openProductEditor(line.key)} disabled={saving || line.locked || !selectedCustomer}>{translate("منتج جديد")}</button>
                    </div>

                    <div className="order-line-grid" style={{ marginTop: 11 }}>
                      {line.mode === "existing" ? (
                        <div className="order-line-field order-line-product">
                          <label htmlFor={`order-product-${line.key}`}>{translate("منتج العميل")}{" "}<span aria-hidden="true">*</span></label>
                          <CustomerProductSelect
                            id={`order-product-${line.key}`}
                            products={customerProducts}
                            categories={categories.values}
                            selectedId={line.customerProductId}
                            onSelect={(customerProductId) => updateLine(line.key, { customerProductId })}
                            labelFor={productLabel}
                            disabled={saving || Boolean(line.locked) || !selectedCustomer || productsLoading || Boolean(productsError)}
                          />
                        </div>
                      ) : (
                        <div className="order-line-field order-line-product">
                          <label>{translate("منتج جديد · مسودة")}</label>
                          <div className="order-product-draft">
                            <span>{line.newProduct ? productLabel({
                              ...line.newProduct,
                              ...deriveCustomerProductFields(line.newProduct, labelFor(categories.values.find((category) => String(category.id) === String(line.newProduct?.category_id)) || {})),
                              category_name_ar: labelFor(categories.values.find((category) => String(category.id) === String(line.newProduct?.category_id)) || {}),
                            }) : translate("أكمل بيانات المنتج")}</span>
                            <button type="button" onClick={() => openProductEditor(line.key)} disabled={saving || line.locked}>{translate("تعديل المنتج")}</button>
                          </div>
                          <small className="order-create-hint">{translate("يُحفظ المنتج مع الطلب، ويظهر بعدها ضمن منتجات العميل.")}</small>
                        </div>
                      )}
                      <div className="order-line-field order-line-quantity">
                        <label htmlFor={`order-quantity-${line.key}`}>{translate("الكمية")}{" "}<span aria-hidden="true">*</span></label>
                        <div className="order-quantity-wrap">
                          <input id={`order-quantity-${line.key}`} type="text" inputMode="decimal" dir="ltr" value={line.quantityKg} onChange={(event) => updateLine(line.key, { quantityKg: event.target.value })} placeholder="0.00" required disabled={saving || line.locked} aria-describedby={`order-quantity-unit-${line.key}`} />
                          <span className="order-quantity-unit" id={`order-quantity-unit-${line.key}`}>{translate("كغ")}</span>
                        </div>
                      </div>
                    </div>

                  </article>
                );
              })}
            </div>
             <button className="order-create-add" type="button" onClick={addLine} disabled={saving || lines.length >= 25}><Plus size={16} />{" "}{translate("إضافة منتج")}</button>
          </section>

          <section className="order-create-section order-notes-section" aria-labelledby="order-notes-heading">
            <h3 className="order-create-section-title" id="order-notes-heading"><span>03</span>{" "}{translate("ملاحظات")}</h3>
            <div className="order-create-field">
              <label htmlFor="order-notes">{translate("ملاحظات")}{" "}<span className="order-create-hint">{translate("(اختياري)")}</span></label>
              <textarea id="order-notes" maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={translate("أي تفاصيل تساعد فريق التخطيط أو التسليم…")} disabled={saving} />
            </div>
          </section>

          <footer className="order-create-footer">
             <span className="order-create-footer-note"><Boxes size={14} aria-hidden="true" /> {editId ? translate("البنود التي بدأ إنتاجها لا يمكن تعديلها أو حذفها") : translate("الحالة الأولية: بانتظار المعالجة")}</span>
            <div className="order-create-actions">
              <button type="button" className="order-create-cancel" onClick={onClose} disabled={saving}>{translate("إلغاء")}</button>
               <button type="submit" className="order-create-save" disabled={saving || detailsLoading || Boolean(detailsError) || customers.loading || Boolean(customers.error) || productsLoading || Boolean(productsError)}>
                 {saving ? <><LoaderCircle className="order-create-spin" size={16} />{" "}{translate("جارٍ حفظ الطلب…")}</> : <><Check size={16} />{" "}{translate("حفظ الطلب")}</>}
              </button>
            </div>
          </footer>
        </form>
      </section>
      {activeProductLine && selectedCustomer && <CustomerProductModal
        key={activeProductLine.key}
        row={activeProductLine.newProduct || {}}
        fixedCustomerId={selectedCustomer}
        onClose={() => setProductEditorKey(null)}
        onSaved={() => {}}
        onDraftSaved={(product) => {
          updateLine(activeProductLine.key, { mode: "new", customerProductId: "", newProduct: product });
          setProductEditorKey(null);
        }}
      />}
    </div>
  );
}
