import { localizedName, translate, translateError } from "../i18n";
import { AlertCircle, Check, ChevronDown, CircleHelp, FileImage, LoaderCircle, Package, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent, type KeyboardEvent } from "react";

import { PRINTING_CYLINDERS, customerProductFacingNotice, deriveCustomerProductFields, isManualCuttingProduct, punchingOptions, type ProductInput } from "../../../shared/customer-product-fields";

import { buildCustomerProductDirtyPayload, buildCustomerProductPayload, customerProductSourcesChanged, initializeCustomerProductForm, validateCustomerProductForm } from "./customer-product-form";
import { CustomerPicker, ProductValueSelect, PRODUCT_SELECT_VALUES, unitWeightLabel } from "./customer-product-controls";
import "./CustomerProductModal.css";
import MasterBatchSwatch from "./MasterBatchSwatch";

type Row = Record<string, any>;
type Props = {
  row: Record<string, any>; onClose: () => void; onSaved: () => void;
  fixedCustomerId?: string;
  onDraftSaved?: (payload: ProductInput) => void;
};
type Options = { customers: Row[]; categories: Row[]; items: Row[]; colors: Row[]; cylinders: string[] };
type Named = { key: keyof Options; path: string };
type Side = "front" | "back";
type ImageStatus = { loading: boolean; error: string };
const lists: Named[] = [
  { key: "customers", path: "/customers" }, { key: "categories", path: "/categories" },
  { key: "items", path: "/items" }, { key: "colors", path: "/master-batch-colors" },
];
function normalizeColors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [value]; } catch { return [value]; } }
  return [];
}
const name = (row: Row) => localizedName(row?.name_ar || row?.display_name_ar, row?.name || row?.display_name, "");
const customerName = (row: Row) => localizedName(row.name_ar || row.display_name_ar, row.name || row.display_name, name(row));
const validHex = (v: string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const safeColor = (value: string) => {
  if (validHex(value)) return value;
  const known: Record<string, string> = { red: "#c94a43", blue: "#477da8", green: "#568566", yellow: "#dbb54f", black: "#333333", white: "#f8f8f3", orange: "#dd7849", transparent: "transparent", شفاف: "transparent", أحمر: "#c94a43", أزرق: "#477da8", أخضر: "#568566", أصفر: "#dbb54f", أسود: "#333333", أبيض: "#f8f8f3" };
  return known[value.trim().toLocaleLowerCase()] || known[value.trim()] || "";
};
const batchSwatch = (row: Row | undefined) => {
  if (!row) return "";
  return safeColor(String(row.color_hex ?? row.color ?? row.hex ?? ""));
};
async function getJson(path: string, signal: AbortSignal) {
  const res = await fetch(`/api${path}`, { credentials: "include", signal, headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateError(body.message || `تعذر تحميل البيانات (${res.status})`));
  return body?.data ?? body;
}
async function loadAll(path: string, signal: AbortSignal): Promise<Row[]> {
  const all: Row[] = [];
  for (let offset = 0; ; offset += 200) {
    const data = await getJson(`${path}?limit=200&offset=${offset}`, signal);
    const page = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.items) ? data.items : [];
    all.push(...page);
    if (page.length < 200) return all;
  }
}
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);
const idField = (side: Side) => side === "front" ? "cliche_front_design" : "cliche_back_design";

export default function CustomerProductModal({ row, onClose, onSaved, fixedCustomerId, onDraftSaved }: Props) {
  const [form, setForm] = useState<ProductInput>(() => initializeCustomerProductForm({
    ...row, ...(fixedCustomerId ? { customer_id: fixedCustomerId } : {}),
  }));
  const [options, setOptions] = useState<Options>({ customers: [], categories: [], items: [], colors: [], cylinders: [] });
  const [loading, setLoading] = useState(true);
  const [optionError, setOptionError] = useState("");
  const [error, setError] = useState("");
  const [facingWarning, setFacingWarning] = useState("");
  const [saving, setSaving] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [imageStatus, setImageStatus] = useState<Record<Side, ImageStatus>>({ front: { loading: false, error: "" }, back: { loading: false, error: "" } });
  const [newFrontColor, setNewFrontColor] = useState("#bd4e41");
  const [newBackColor, setNewBackColor] = useState("#bd4e41");
  const [userCutChanged, setUserCutChanged] = useState(false);
  const [retryIndex, setRetryIndex] = useState(0);
  const initialEditCut = useRef(Boolean(row.id));
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const fileRefs = useRef<Record<Side, HTMLInputElement | null>>({ front: null, back: null });
  const fileTokens = useRef<Record<Side, number>>({ front: 0, back: 0 });
  const live = useRef(true);
  const saveLock = useRef(false);
  const warningRef = useRef<HTMLDivElement>(null);
  const titleId = "customer-product-title";

  useEffect(() => {
    live.current = true;
    const tokens = fileTokens.current;
    return () => { live.current = false; tokens.front++; tokens.back++; };
  }, []);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus(), 0);
    return () => { window.clearTimeout(timer); returnFocus.current?.focus(); };
  }, []);
  useEffect(() => {
    if (facingWarning) warningRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [facingWarning]);
  useEffect(() => {
    setFacingWarning("");
  }, [form.left_facing, form.right_facing, form.width]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setOptionError("");
      try {
        const requests = lists.map(async ({ key, path }) => [key, await loadAll(path, controller.signal)] as const);
        const [loadedLists, formOpts] = await Promise.all([Promise.all(requests), getJson("/customer-products/form-options", controller.signal)]);
        if (controller.signal.aborted) return;
        const partial = Object.fromEntries(loadedLists) as Partial<Options>;
        const normalizedColors = (partial.colors || []).map((c: Row) => ({
          ...c,
          id: String(c.id),
          is_active: c.is_active !== false && c.is_active !== 0 && c.is_active !== "false",
        }));
        if (!Array.isArray(formOpts?.printing_cylinders)) throw new Error(translate("استجابة خيارات الطباعة غير صالحة."));
        const cylinders = [...new Set([...PRINTING_CYLINDERS, ...formOpts.printing_cylinders.map(String)])];
        setOptions({ customers: partial.customers || [], categories: partial.categories || [], items: partial.items || [], colors: normalizedColors, cylinders });
      } catch (e) { if (!controller.signal.aborted) setOptionError((e as Error).message || "تعذر تحميل الخيارات."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [retryIndex]);

  const category = options.categories.find((c) => String(c.id) === String(form.category_id));
  const categoryName = [category?.name_ar, category?.name].filter(Boolean).join(" ");
  const computed = useMemo(() => deriveCustomerProductFields(form, categoryName, initialEditCut.current && !userCutChanged), [form, categoryName, userCutChanged]);
  const manualCut = isManualCuttingProduct(form, categoryName);
  const historicalPreview = Boolean(row.id) && !row.__clone_source_id;
  const preview = useMemo(() => {
    const result = { ...computed };
    if (!historicalPreview) return result;
    const layoutSources = ["category_id", "printing_cylinder", "cutting_length_cm", "width", "left_facing", "right_facing"];
    const weightSources = [...layoutSources, "thickness", "density"];
    const packageSources = ["unit_weight_kg", "unit_quantity"];
    if (result.size_caption == null && row.size_caption && !customerProductSourcesChanged(row, form, layoutSources)) {
      result.size_caption = String(row.size_caption);
    }
    if (!customerProductSourcesChanged(row, form, weightSources)) {
      if (result.bag_weight_grams == null && row.bag_weight_grams != null) result.bag_weight_grams = String(row.bag_weight_grams);
      if (result.bags_per_kilo == null && row.bags_per_kilo != null) result.bags_per_kilo = String(row.bags_per_kilo);
    }
    if (result.package_weight_kg == null && row.package_weight_kg != null && !customerProductSourcesChanged(row, form, packageSources)) {
      result.package_weight_kg = String(row.package_weight_kg);
    }
    return result;
  }, [computed, form, historicalPreview, row]);
  const automaticCutLength = computed.cutting_length_cm;
  const categoryItems = options.items.filter((i) => String(i.category_id) === String(form.category_id));
  const selectedCustomerValid = options.customers.some((c) => String(c.id) === String(form.customer_id));
  const legacyUncategorizedItem = Boolean(form.item_id && !form.category_id && !row.category_id && String(form.item_id) === String(row.item_id));
  const itemValid = !form.item_id || categoryItems.some((i) => String(i.id) === String(form.item_id)) || legacyUncategorizedItem;
  const activeColors = options.colors.filter((c) => c.is_active || String(c.id) === String(form.master_batch_id));
  const selectedBatch = options.colors.find((c) => String(c.id) === String(form.master_batch_id));
  const set = (key: keyof ProductInput, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const close = () => { if (!saving) onClose(); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); if (colorOpen) { setColorOpen(false); return; } if (facingWarning) { setFacingWarning(""); modalRef.current?.querySelector<HTMLButtonElement>(".cp-save")?.focus(); return; } close(); return; }
    if (event.key !== "Tab" || !modalRef.current) return;
    const elements = [...modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (!elements.length) return;
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const changeCategory = (id: string) => {
    setUserCutChanged(true);
    setForm((prev) => ({ ...prev, category_id: id, item_id: "", punching: "بدون" }));
  };
  const changeCylinder = (v: string) => { setUserCutChanged(true); set("printing_cylinder", v); };
  const onFile = (side: Side, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const token = ++fileTokens.current[side];
    setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: "" } }));
    if (!imageTypes.has(file.type)) { setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: translate("نوع الملف غير مدعوم. استخدم PNG أو JPEG أو GIF أو WebP أو BMP أو AVIF.") } })); event.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: translate("حجم الصورة يتجاوز 5 ميغابايت.") } })); event.target.value = ""; return; }
    setImageStatus((prev) => ({ ...prev, [side]: { loading: true, error: "" } }));
    const reader = new FileReader();
    reader.onerror = () => { if (live.current && fileTokens.current[side] === token) setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: translate("تعذر قراءة الملف. أعد المحاولة.") } })); };
    reader.onload = () => {
      if (!live.current || fileTokens.current[side] !== token || typeof reader.result !== "string") return;
      set(idField(side), reader.result);
      setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: "" } }));
    };
    reader.readAsDataURL(file);
  };
  const removeImage = (side: Side) => {
    fileTokens.current[side]++;
    if (fileRefs.current[side]) fileRefs.current[side]!.value = "";
    set(idField(side), "");
    setImageStatus((prev) => ({ ...prev, [side]: { loading: false, error: "" } }));
  };
  const addPrintColor = (side: Side) => {
    const key = side === "front" ? "front_print_colors" : "back_print_colors";
    const color = side === "front" ? newFrontColor : newBackColor;
    set(key, [...normalizeColors(form[key]), color]);
  };
  const removePrintColor = (side: Side, index: number) => {
    const key = side === "front" ? "front_print_colors" : "back_print_colors";
    set(key, normalizeColors(form[key]).filter((_, i) => i !== index));
  };

  const save = async (event: SyntheticEvent, confirmUnequalSides = false) => {
    event.preventDefault();
    if (saveLock.current) return;
    setError("");
    setFacingWarning("");
    if (loading || optionError) { setError(translate("حمّل خيارات النموذج بنجاح قبل الحفظ.")); return; }
    const validation = validateCustomerProductForm(form, {
      customers: options.customers,
      items: options.items,
      categoryId: form.category_id,
      validateCuttingLength: manualCut || (initialEditCut.current && !userCutChanged),
    });
    if (validation) { setError(translateError(validation)); return; }
    if (!selectedCustomerValid) { setError(translate("اختر عميلاً صالحاً من القائمة.")); return; }
    if (!itemValid) { setError(translate("الصنف المحفوظ لا يتبع التصنيف المحدد. اختر صنفاً متوافقاً أو امسح الصنف.")); return; }
    if (imageStatus.front.loading || imageStatus.back.loading) { setError(translate("انتظر اكتمال قراءة الصور قبل الحفظ.")); return; }
      const payload = buildCustomerProductPayload(form, {
      categoryName,
      preserveCuttingLength: initialEditCut.current && !userCutChanged,
    });
    if (payload.cutting_length_cm != null && (!Number.isInteger(payload.cutting_length_cm) || payload.cutting_length_cm <= 0)) {
      setError(translate("طول القطع يجب أن يكون عدداً صحيحاً موجباً.")); return;
    }
    const facingNotice = customerProductFacingNotice(form);
    if (facingNotice?.kind === "warning" && !confirmUnequalSides) {
      setFacingWarning(translateError(facingNotice.message));
      return;
    }
    saveLock.current = true; setSaving(true);
    try {
      if (onDraftSaved) {
        onDraftSaved(payload);
        return;
      }
      const response = await fetch(`/api/customer-products${row.id ? `/${encodeURIComponent(String(row.id))}` : ""}`, {
        method: row.id ? "PUT" : "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(row.id
          ? buildCustomerProductDirtyPayload(row, payload)
          : { ...payload, ...(row.__clone_source_id ? { clone_source_id: row.__clone_source_id } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(translateError(body.message || "تعذر حفظ المنتج. تحقق من البيانات وحاول مجدداً."));
      onSaved();
    } catch (e) { setError((e as Error).message || "تعذر حفظ المنتج."); }
    finally { saveLock.current = false; if (live.current) setSaving(false); }
  };

  const renderPrintColors = (side: Side) => {
    const key = side === "front" ? "front_print_colors" : "back_print_colors";
    const colors = normalizeColors(form[key]);
    return <div className="cp-colors">
      <span className="cp-color-label">{side === "front" ? translate("ألوان طباعة الوجه الأمامي") : translate("ألوان طباعة الوجه الخلفي")}</span>
      <div className="cp-color-add"><input aria-label={`${translate("اختيار لون")} ${translate(side === "front" ? "الوجه الأمامي" : "الوجه الخلفي")}`} type="color" value={side === "front" ? newFrontColor : newBackColor} onChange={(e) => side === "front" ? setNewFrontColor(e.target.value) : setNewBackColor(e.target.value)} /><button type="button" className="btn btn-muted" onClick={() => addPrintColor(side)}><Plus size={14} />{" "}{translate("أضف اللون")}</button></div>
      <div className="cp-color-pills" aria-live="polite">{colors.map((color, index) => {
        const swatch = safeColor(color);
        return <span className="cp-color-pill" key={`${color}-${index}`}><i style={swatch ? { background: swatch } : undefined} aria-hidden="true" /><span>{color}</span><button type="button" aria-label={`${translate("إزالة اللون")} ${color}`} onClick={() => removePrintColor(side, index)}><X size={13} /></button></span>;
      })}{colors.length === 0 && <span className="cp-hint">{translate("لم تُحدد ألوان للطباعة بعد.")}</span>}</div>
    </div>;
  };

  return <div className="cp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
    <div className="cp-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="cp-head"><div className="cp-title"><span className="cp-mark"><Package size={20} /></span><div><h2 id={titleId}>{row.id ? translate("تعديل منتج العميل") : translate("إضافة منتج عميل")}</h2><p>{row.id ? translate("حدّث مواصفات المنتج مع الحفاظ على القيم الحالية.") : translate("عرّف المقاس والطباعة والتعبئة بدقة.")}</p></div></div><button className="cp-close" type="button" aria-label={translate("إغلاق النافذة")} onClick={close} disabled={saving}><X size={19} /></button></div>
      {optionError && <div className="cp-options-state" role="alert"><AlertCircle size={15} />{" "}{translate("تعذر تحميل خيارات النموذج.")}{" "}<button type="button" onClick={() => setRetryIndex((v) => v + 1)}>{translate("إعادة المحاولة")}</button><span className="cp-invalid">{optionError}</span></div>}
      {error && <div className="cp-error" role="alert">{error}</div>}
      {facingWarning && <div className="cp-facing-warning" ref={warningRef} role="alert" aria-label={translate("تنبيه اختلاف الجانبين")}>
        <p><AlertCircle size={16} aria-hidden="true" />{facingWarning}</p>
        <div className="cp-warning-actions">
          <button type="button" onClick={() => { setFacingWarning(""); modalRef.current?.querySelector<HTMLSelectElement>("#cp-right")?.focus(); }}>{translate("العودة للتعديل")}</button>
          <button type="button" onClick={(event) => void save(event, true)}>{translate("الاستمرار في الحفظ")}</button>
        </div>
      </div>}
      <form id="cp-form" className="cp-body" onSubmit={save} noValidate>
        <fieldset className="cp-fields" disabled={saving}>
        {loading ? <div className="cp-loading" aria-label={translate("جار تحميل الخيارات")} aria-busy="true"><i /><i /><i /><i /></div> : <>
          <section className="cp-section"><h3 className="cp-section-title"><span>01</span>{translate("العميل والتصنيف")}</h3>
            <div className="cp-grid cp-three">
               <div className="cp-field"><label htmlFor="cp-customer">{translate("العميل")}{" "}<b aria-hidden="true">*</b></label>{fixedCustomerId ? <input id="cp-customer" value={customerName(options.customers.find((customer) => String(customer.id) === fixedCustomerId) || {}) || fixedCustomerId} readOnly aria-readonly="true" /> : <CustomerPicker customers={options.customers} value={String(form.customer_id || "")} onChange={(id) => set("customer_id", id)} labelFor={customerName} />}{fixedCustomerId && <span className="cp-hint">{translate("عميل الطلب · لا يمكن تغييره من هنا")}</span>}</div>
              <div className="cp-field"><label htmlFor="cp-category">{translate("التصنيف")}</label><select id="cp-category" value={String(form.category_id || "")} onChange={(e) => changeCategory(e.target.value)}><option value="">{translate("غير محدد")}</option>{options.categories.map((c) => <option key={c.id} value={String(c.id)}>{name(c)} ({c.id})</option>)}{form.category_id && !category && <option value={String(form.category_id)}>{translate("التصنيف الحالي (")}{form.category_id}{translate(") — اختر تصنيفاً صالحاً")}</option>}</select></div>
               <div className="cp-field"><label htmlFor="cp-item">{translate("الصنف")}</label><select id="cp-item" disabled={!form.category_id} value={String(form.item_id || "")} onChange={(e) => set("item_id", e.target.value)}><option value="">{form.category_id ? translate("غير محدد") : translate("اختر التصنيف أولاً")}</option>{legacyUncategorizedItem && <option value={String(form.item_id)}>{translate("الصنف الحالي (")}{form.item_id}{translate(") — دون تصنيف")}</option>}{categoryItems.map((i) => <option key={i.id} value={String(i.id)}>{name(i)}{i.code ? ` (${i.code})` : ""}</option>)}{form.item_id && !itemValid && <option value={String(form.item_id)}>{translate("الصنف الحالي (")}{form.item_id}{translate(") — لا يتبع التصنيف")}</option>}</select>{!itemValid && <span className="cp-invalid">{translate("يرجى اختيار صنف ضمن التصنيف الحالي أو مسح الصنف.")}</span>}</div>
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>02</span>{translate("المواصفات والأبعاد")}</h3>
            <div className="cp-grid cp-dimensions">
              <ProductValueSelect label="الجانب الأيمن" id="cp-right" value={form.right_facing} values={PRODUCT_SELECT_VALUES.facing} onChange={(v) => set("right_facing", v)} />
              <ProductValueSelect label="العرض (سم)" id="cp-width" value={form.width} values={PRODUCT_SELECT_VALUES.width} onChange={(v) => set("width", v)} />
              <ProductValueSelect label="الجانب الأيسر" id="cp-left" value={form.left_facing} values={PRODUCT_SELECT_VALUES.facing} onChange={(v) => set("left_facing", v)} />
              <div className="cp-field"><label>{translate("وصف المقاس المحسوب")}</label><div className="cp-readonly">{preview.size_caption || "—"}</div></div>
            </div>
            <div className="cp-grid cp-specifications">
              <ProductValueSelect label="السماكة (ميكرون)" id="cp-thickness" value={form.thickness} values={PRODUCT_SELECT_VALUES.thickness} onChange={(v) => set("thickness", v)} />
              <ProductValueSelect label="الكثافة" id="cp-density" value={form.density} values={PRODUCT_SELECT_VALUES.density} onChange={(v) => set("density", v)} />
              <div className="cp-field"><label htmlFor="cp-punching">{translate("التخريم")}</label><select id="cp-punching" value={String(form.punching || "بدون")} onChange={(e) => set("punching", e.target.value)}>{(punchingOptions(categoryName) || []).map((p) => <option key={p} value={p}>{p}</option>)}{form.punching && !(punchingOptions(categoryName) || []).includes(String(form.punching)) && <option value={String(form.punching)}>{translate("القيمة الحالية:")}{" "}{String(form.punching)}</option>}</select></div>
               <div className="cp-field"><label>{translate("وزن الكيس (جرام)")}</label><div className="cp-readonly ltr">{preview.bag_weight_grams || "—"}</div></div>
               <div className="cp-field"><label>{translate("عدد الأكياس في الكيلو")}</label><div className="cp-readonly ltr">{preview.bags_per_kilo || "—"}</div></div>
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>03</span>{translate("الطباعة والقطع")}</h3>
            <div className="cp-grid cp-three">
              <div className="cp-field"><label htmlFor="cp-cylinder">{translate("سلندر الطباعة")}</label><select id="cp-cylinder" value={String(form.printing_cylinder || "")} onChange={(e) => changeCylinder(e.target.value)}><option value="">{translate("بدون سلندر")}</option>{options.cylinders.map((v) => <option key={v} value={v}>{v}</option>)}{form.printing_cylinder && !options.cylinders.includes(String(form.printing_cylinder)) && <option value={String(form.printing_cylinder)}>{translate("القيمة الحالية:")}{" "}{String(form.printing_cylinder)}</option>}</select></div>
               <ProductValueSelect label="طول القطع (سم)" id="cp-cut-length" value={manualCut ? form.cutting_length_cm : automaticCutLength ?? ""} values={PRODUCT_SELECT_VALUES.cuttingLength} onChange={(v) => { setUserCutChanged(true); set("cutting_length_cm", v); }} zeroMeansUnset disabled={!manualCut} hint={manualCut ? translate("من 0 إلى 300 · 0 = غير محدد") : translate("يُحسب من محيط السلندر")} />
              <div className="cp-field"><label>{translate("حالة الطباعة")}</label><div className="cp-check"><input type="checkbox" checked={Boolean(computed.is_printed)} disabled readOnly aria-label={translate("منتج مطبوع")} /><span>{computed.is_printed ? translate("منتج مطبوع") : translate("بدون طباعة")}</span></div></div>
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>04</span>{translate("المواد والخامات")}</h3>
            <div className="cp-grid cp-three">
              <div className="cp-field"><label htmlFor="cp-material">{translate("المادة الخام")}</label><select id="cp-material" value={String(form.raw_material || "")} onChange={(e) => set("raw_material", e.target.value)}><option value="">{translate("اختر المادة")}</option>{["HDPE", "LDPE", "Regrind"].map((v) => <option key={v} value={v}>{v}</option>)}{form.raw_material && !["HDPE", "LDPE", "Regrind"].includes(String(form.raw_material)) && <option value={String(form.raw_material)}>{translate("القيمة الحالية:")}{" "}{String(form.raw_material)}</option>}</select></div>
              <div className="cp-field">
                <label htmlFor="cp-master-batch">{translate("لون الماستر باتش")}</label>
                <div className="cp-color-select">
                  <button id="cp-master-batch" type="button" className="cp-color-trigger" aria-haspopup="listbox" aria-expanded={colorOpen} onClick={() => setColorOpen((v) => !v)}>
                    <MasterBatchSwatch color={selectedBatch ? { ...selectedBatch, color_hex: batchSwatch(selectedBatch) } : null} size={20} className="cp-color-dot" />
                    {selectedBatch ? name(selectedBatch) : form.master_batch_id ? `القيمة الحالية (${form.master_batch_id})` : translate("بدون لون")}<ChevronDown size={15} />
                  </button>
                  {colorOpen && <div className="cp-color-menu" role="listbox" aria-label={translate("ألوان الماستر باتش")}>
                    <button type="button" className="cp-color-option" role="option" aria-selected={!form.master_batch_id} onClick={() => { set("master_batch_id", ""); setColorOpen(false); }}>
                      <MasterBatchSwatch size={20} className="cp-color-dot" label={translate("بدون لون")} />{translate("بدون لون")}
                    </button>
                    {activeColors.map((c) => <button type="button" className="cp-color-option" role="option" aria-selected={String(c.id) === String(form.master_batch_id)} key={c.id} onClick={() => { set("master_batch_id", String(c.id)); setColorOpen(false); }}>
                      <MasterBatchSwatch color={{ ...c, color_hex: batchSwatch(c) }} size={20} className="cp-color-dot" />
                      {name(c)}<small className="cp-color-id">{c.id}{c.is_active ? "" : translate(" · غير نشط")}</small>
                    </button>)}
                    {form.master_batch_id && !selectedBatch && <button type="button" className="cp-color-option" role="option" aria-selected="true" onClick={() => { setColorOpen(false); }}>{`اللون الحالي (${form.master_batch_id})`}</button>}
                  </div>}
                </div>
              </div>
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>05</span>{translate("الأوزان والتعبئة")}</h3>
            <div className="cp-grid cp-three cp-packaging">
              <ProductValueSelect label="الوحدة" id="cp-cut-unit" value={form.cutting_unit} values={PRODUCT_SELECT_VALUES.cuttingUnit} onChange={(v) => set("cutting_unit", v)} />
              <ProductValueSelect label="وزن الوحدة (جرام)" id="cp-unit-weight" value={form.unit_weight_kg} values={PRODUCT_SELECT_VALUES.unitWeightKg} labelForValue={unitWeightLabel} onChange={(v) => set("unit_weight_kg", v)} />
              <ProductValueSelect label="التعبئة / عبوة" id="cp-unit-quantity" value={form.unit_quantity} values={PRODUCT_SELECT_VALUES.packageQuantity} onChange={(v) => set("unit_quantity", v)} />
               <div className="cp-field"><label>{translate("وزن العبوة المحسوب (كجم)")}</label><div className="cp-readonly ltr">{preview.package_weight_kg || "—"}</div></div>
              <div className="cp-field"><label htmlFor="cp-status">{translate("الحالة")}</label><select id="cp-status" value={String(form.status || "active")} onChange={(e) => set("status", e.target.value)}><option value="active">{translate("نشط")}</option><option value="inactive">{translate("غير نشط")}</option>{form.status && !["active", "inactive"].includes(String(form.status)) && <option value={String(form.status)}>{translate("القيمة الحالية:")}{" "}{String(form.status)}</option>}</select></div>
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>06</span>{translate("التصاميم وألوان الطباعة")}</h3>
            <div className="cp-grid cp-two">
              {(["front", "back"] as Side[]).map((side) => <div className="cp-image-card" key={side}>
                <div className="cp-image-head"><strong>{side === "front" ? translate("كليشة الوجه الأمامي") : translate("كليشة الوجه الخلفي")}</strong><FileImage size={15} /></div>
                <input className="cp-file" ref={(el) => { fileRefs.current[side] = el; }} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif" aria-label={`${translate("رفع تصميم")} ${translate(side === "front" ? "الوجه الأمامي" : "الوجه الخلفي")}`} onChange={(e) => onFile(side, e)} disabled={saving || imageStatus[side].loading} />
                <span className="cp-hint">{translate("PNG · JPEG · GIF · WebP · BMP · AVIF — حتى 5 ميغابايت. اسم الملف محلي ولا يُحفظ.")}</span>
                {imageStatus[side].error && <span className="cp-invalid" role="alert">{imageStatus[side].error}</span>}
                {imageStatus[side].loading && <span className="cp-hint" role="status">{translate("جارٍ قراءة الصورة…")}</span>}
                <div className="cp-preview">{form[idField(side)] ? <><img src={String(form[idField(side)])} alt={`${translate("معاينة تصميم")} ${translate(side === "front" ? "الوجه الأمامي" : "الوجه الخلفي")}`} /><button type="button" className="cp-remove" aria-label={`${translate("إزالة تصميم")} ${translate(side === "front" ? "الوجه الأمامي" : "الوجه الخلفي")}`} onClick={() => removeImage(side)}><Trash2 size={15} /></button></> : <span className="cp-preview-empty">{translate("لا يوجد تصميم محفوظ")}</span>}</div>
                {renderPrintColors(side)}
              </div>)}
            </div>
          </section>
          <section className="cp-section"><h3 className="cp-section-title"><span>07</span>{translate("ملاحظات")}</h3><div className="cp-field"><label htmlFor="cp-notes">{translate("ملاحظات المنتج")}</label><textarea id="cp-notes" rows={3} value={String(form.notes || "")} onChange={(e) => set("notes", e.target.value)} placeholder={translate("مواصفات أو تعليمات إضافية…")} /></div></section>
        </>}
        </fieldset>
      </form>
      <div className="cp-footer"><span className="cp-footer-note"><CircleHelp size={13} /> {onDraftSaved ? translate("مسودة · يُحفظ المنتج عند حفظ الطلب") : translate("الحقول المحسوبة للقراءة فقط · السماكة العامة غير مرسلة")}</span><div className="cp-actions"><button className="cp-cancel" type="button" onClick={close} disabled={saving}>{translate("إلغاء")}</button><button className="cp-save" type="submit" form="cp-form" disabled={saving || loading || Boolean(optionError)}>{saving ? <><LoaderCircle size={16} className="cp-spin" />{" "}{translate("جارٍ الحفظ")}</> : <><Check size={16} />{onDraftSaved ? translate("إضافة إلى الطلب") : row.id ? translate("حفظ التعديلات") : translate("إضافة المنتج")}</>}</button></div></div>
    </div>
  </div>;
}
