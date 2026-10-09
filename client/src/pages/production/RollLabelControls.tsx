import { useState } from "react";
import { AlertTriangle, Check, Printer, RefreshCw, Search, X } from "lucide-react";
import type { ProductionRollRecord } from "../../../../shared/production";
import { productionApi, type ProductionRollLabel } from "../../lib/production-api";
import { formatNumber } from "../../lib/format-number";
import { buildRollLabelDocument, rollLabelPreviewCopy, type RollLabelLanguage } from "./roll-label-document";
import { useRollLabelHistory } from "./useRollLabelHistory";

type Props = { rolls?: ProductionRollRecord[]; language: string; single?: boolean; refresh?: unknown };

const messages = {
  ar: {
    title: "ملصقات تعريف الرولات", hint: "اختر رولات مسجلة؛ تُجلب بياناتها ورموزها المحدثة معاً قبل المعاينة.",
    printOne: "طباعة ملصق الرول", search: "ابحث برقم الرول أو أمر الإنتاج", selectAll: "تحديد النتائج", clear: "مسح التحديد", retry: "إعادة المحاولة",
    selected: "محدد", print: "تجهيز المعاينة", limit: "يمكن تحديد 100 رول لكل دفعة، بما فيها المكتملة. يُعرض 50 رولًا في الصفحة ويُحفظ التحديد بين الصفحات ونتائج البحث.",
    searchAction: "بحث", previous: "السابق", next: "التالي", page: "صفحة", loading: "جارٍ تحميل الرولات…",
    noRolls: "لا توجد رولات مسجلة متاحة.", noMatches: "لا توجد نتائج مطابقة.", fetchError: "تعذر جلب الملصقات. لم تُعرض أي ملصقات؛ أعد المحاولة.",
    popupBlocked: "حُظر فتح نافذة المعاينة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.",
    invalidResponse: "استجابة الملصقات غير مكتملة أو غير متطابقة؛ لم تُعرض أي ملصقات.",
  },
  en: {
    title: "Roll identification labels", hint: "Select registered rolls. Current roll data and QR images are fetched together before preview.",
    printOne: "Print this roll label", search: "Search roll or production order", selectAll: "Select results", clear: "Clear selection", retry: "Retry",
    selected: "selected", print: "Prepare preview", limit: "Select up to 100 rolls per batch, including completed rolls. Each page shows 50 rolls; selections are kept across pages and searches.",
    searchAction: "Search", previous: "Previous", next: "Next", page: "Page", loading: "Loading rolls…",
    noRolls: "No registered rolls are available.", noMatches: "No matching rolls.", fetchError: "Labels could not be fetched. No labels were shown; retry.",
    popupBlocked: "The preview window was blocked. Allow pop-ups for this site, then retry.",
    invalidResponse: "The label response was incomplete or mismatched. No labels were shown.",
  },
} as const;

function validQrImage(image: string): boolean {
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(image) || /^\/(?!\/)[^<>"']*$/.test(image);
}

function verifyResponse(requested: number[], response: { labels: ProductionRollLabel[] }): boolean {
  if (!response || !Array.isArray(response.labels) || response.labels.length !== requested.length) return false;
  const expected = new Set(requested);
  const seen = new Set<number>();
  for (const item of response.labels) {
    if (!item?.roll || !item.qr || !Number.isSafeInteger(item.roll.id) || !expected.has(item.roll.id) ||
      seen.has(item.roll.id) || !item.qr.url || !validQrImage(item.qr.image)) return false;
    seen.add(item.roll.id);
  }
  return seen.size === expected.size;
}

function setPopupMessage(popup: Window, message: string, language: RollLabelLanguage) {
  const document = popup.document;
  document.body.replaceChildren();
  const main = document.createElement("main");
  main.style.cssText = "font:16px system-ui,sans-serif;padding:28px;color:#183c39;max-width:620px;margin:8vh auto";
  const heading = document.createElement("h1");
  heading.textContent = message;
  main.append(heading);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = language === "ar" ? "إغلاق" : "Close";
  close.addEventListener("click", () => popup.close());
  main.append(close);
  document.body.append(main);
}

function showLoadingPopup(popup: Window, language: RollLabelLanguage) {
  const document = popup.document;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.title = language === "ar" ? "جارٍ تجهيز الملصقات" : "Preparing roll labels";
  document.body.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.textContent = language === "ar" ? "جارٍ جلب بيانات الرولات ورموز QR…" : "Fetching current roll records and QR codes…";
  paragraph.style.cssText = "font:16px system-ui,sans-serif;padding:28px;color:#183c39";
  document.body.append(paragraph);
}

async function preparePreview(ids: number[], language: RollLabelLanguage, popup: Window) {
  const t = rollLabelPreviewCopy(language);
  try {
    const response = await productionApi.labels(ids);
    if (!verifyResponse(ids, response)) throw new Error("invalidResponse");
    const html = buildRollLabelDocument(response.labels, language);
    popup.document.open();
    popup.document.write(html);
    popup.document.close();

    const printButton = popup.document.getElementById("print-labels") as HTMLButtonElement | null;
    const status = popup.document.getElementById("preview-status");
    const closeButton = popup.document.getElementById("close-preview");
    closeButton?.addEventListener("click", () => popup.close());
    if (!printButton || !status) throw new Error("previewControlsMissing");

    let failedImage = false;
    await Promise.all(Array.from(popup.document.images, async image => {
      try {
        if (!image.complete) await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("image")), { once: true });
        });
        if (image.naturalWidth === 0) throw new Error("image");
        if (typeof image.decode === "function") await image.decode();
      } catch { failedImage = true; }
    }));
    if (popup.document.fonts?.ready) await popup.document.fonts.ready;
    if (popup.closed) return;
    if (failedImage) {
      status.textContent = t.imageError;
      throw new Error("image");
    }
    if (Array.from(popup.document.querySelectorAll<HTMLElement>(".label-sheet")).some(sheet =>
      sheet.scrollHeight > sheet.clientHeight || sheet.scrollWidth > sheet.clientWidth
    )) throw new Error("labelOverflow");
    status.textContent = "";
    printButton.disabled = false;
    printButton.addEventListener("click", () => popup.print());
  } catch (error) {
    if (!popup.closed) setPopupMessage(popup, error instanceof Error && error.message === "invalidResponse"
      ? (language === "ar" ? messages.ar.invalidResponse : messages.en.invalidResponse)
      : error instanceof Error && error.message === "image"
        ? t.imageError
        : error instanceof Error && error.message === "labelOverflow"
          ? t.overflow
        : (language === "ar" ? messages.ar.fetchError : messages.en.fetchError), language);
    throw error;
  }
}

export default function RollLabelControls({ rolls = [], language, single = false, refresh }: Props) {
  const lang: RollLabelLanguage = language === "en" ? "en" : "ar";
  const text = messages[lang];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryIds, setRetryIds] = useState<number[]>([]);
  const history = useRollLabelHistory(!single, refresh, lang);
  const visibleRolls = history.page?.records ?? [];

  const launch = async (ids: number[]) => {
    if (busy || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) return;
    setError("");
    setRetryIds(ids);
    const popup = window.open("", "_blank", "popup,width=900,height=1000");
    if (!popup) {
      setError(text.popupBlocked);
      return;
    }
    showLoadingPopup(popup, lang);
    setBusy(true);
    try {
      await preparePreview(ids, lang, popup);
    } catch {
      setError(text.fetchError);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else if (next.size < 100) next.add(id);
    return next;
  });

  if (single) return <div className="roll-label-single">
    <button type="button" className="prod-btn secondary" onClick={() => void launch(rolls.slice(0, 1).map(roll => roll.id))} disabled={!rolls.length || busy}>
      {busy ? <RefreshCw aria-hidden="true" /> : <Printer aria-hidden="true" />}{busy ? (lang === "ar" ? "جارٍ تجهيز المعاينة…" : "Preparing preview…") : text.printOne}
    </button>
    {error && <div className="roll-label-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void launch(retryIds)}><RefreshCw />{text.retry}</button><button type="button" aria-label={lang === "ar" ? "إغلاق التنبيه" : "Dismiss alert"} onClick={() => setError("")}><X /></button></div>}
  </div>;

  const allVisibleSelected = visibleRolls.length > 0 && visibleRolls.every(roll => selected.has(roll.id));
  const toggleFiltered = () => setSelected(previous => {
    const next = new Set(previous);
    if (allVisibleSelected) visibleRolls.forEach(roll => next.delete(roll.id));
    else visibleRolls.forEach(roll => { if (next.size < 100) next.add(roll.id); });
    return next;
  });

  return <details className="roll-label-controls prod-card prod-history" aria-labelledby="roll-label-title">
    <summary className="prod-card-head">
      <div><h3 id="roll-label-title">{text.title}</h3><p>{text.hint}</p></div>
      <span className="roll-label-count" aria-live="polite">{selected.size} / 100 {text.selected}</span>
    </summary>
    <div className="prod-card-body">
      {error && <div className="roll-label-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void launch(retryIds)}><RefreshCw />{text.retry}</button><button type="button" aria-label={lang === "ar" ? "إغلاق التنبيه" : "Dismiss alert"} onClick={() => setError("")}><X /></button></div>}
      <form className="roll-label-toolbar" onSubmit={event => { event.preventDefault(); history.search(query); }}>
        <label className="roll-label-search"><Search aria-hidden="true" /><span className="sr-only">{text.search}</span><input value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder={text.search} /></label>
        <button type="submit" className="prod-btn secondary">{text.searchAction}</button>
        <button type="button" className="prod-btn quiet" onClick={toggleFiltered} disabled={history.loading || !visibleRolls.length}>{allVisibleSelected ? <X /> : <Check />}{text.selectAll}</button>
        <button type="button" className="prod-btn quiet" onClick={() => setSelected(new Set())} disabled={!selected.size}><X />{text.clear}</button>
      </form>
      <p className="roll-label-limit">{text.limit}</p>
      {history.loading && <p role="status">{text.loading}</p>}
      {history.error && <div className="roll-label-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{history.error}</span><button type="button" onClick={history.retry}><RefreshCw />{text.retry}</button></div>}
      {history.page && (visibleRolls.length ? <div className="roll-label-list" role="group" aria-label={text.title}>
        {visibleRolls.map(roll => <label className="roll-label-option" key={roll.id}>
          <input type="checkbox" checked={selected.has(roll.id)} disabled={!selected.has(roll.id) && selected.size >= 100} onChange={() => toggle(roll.id)} />
          <span className="roll-label-option-main"><strong className="prod-number">{roll.roll_number}</strong><small>{roll.production_order_number}</small></span>
           <span className="roll-label-option-weight">{formatNumber(roll.weight_kg)} kg</span>
        </label>)}
      </div> : <div className="roll-label-empty">{text.noMatches}</div>)}
      <div className="roll-label-toolbar" style={{ marginTop: 12 }}>
        <button type="button" className="prod-btn secondary" onClick={history.previous} disabled={history.loading || history.pageNumber === 1}>{text.previous}</button>
        <span>{text.page} {formatNumber(history.pageNumber)}</span>
        <button type="button" className="prod-btn secondary" onClick={history.next} disabled={history.loading || history.page?.next == null}>{text.next}</button>
      </div>
      <div className="roll-label-footer">
        <span>{selected.size} {text.selected}</span>
        <button type="button" className="prod-btn" onClick={() => void launch([...selected])} disabled={!selected.size || busy}>
          {busy ? <RefreshCw aria-hidden="true" /> : <Printer aria-hidden="true" />}{busy ? (lang === "ar" ? "جارٍ تجهيز المعاينة…" : "Preparing preview…") : text.print}
        </button>
      </div>
    </div>
  </details>;
}