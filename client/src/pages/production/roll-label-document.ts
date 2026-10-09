import type { ProductionRollLabel } from "../../lib/production-api";
import { formatNumber } from "../../lib/format-number";

export type RollLabelLanguage = "ar" | "en";

const copy = {
  ar: {
    title: "ملصقات تعريف الرولات",
    preview: "معاينة ملصقات الرولات",
    print: "طباعة الملصقات",
    close: "إغلاق المعاينة",
    instructions: "إعدادات Zebra: مقاس 4 × 6 بوصة، عمودي، حجم فعلي 100%، وأوقف الرؤوس والتذييلات.",
    target: "اختر طابعة Zebra من قائمة الطابعات في نافذة المتصفح. لا يمكن للتطبيق اختيار الطابعة أو تأكيد الطباعة الفعلية.",
    roll: "رقم الرول",
    order: "أمر الإنتاج",
    weight: "وزن الفيلم",
    batch: "رقم الدفعة",
    scan: "امسح الرمز لعرض سجل الرول",
    loading: "جارٍ تجهيز الملصقات…",
    failed: "تعذر تجهيز المعاينة كاملة. أغلق النافذة وأعد المحاولة من صفحة الإنتاج.",
    imageError: "تعذر تحميل صورة QR. لم يتم تفعيل الطباعة.",
    overflow: "بيانات أحد الملصقات لا تتسع للمقاس المحدد. لم يتم تفعيل الطباعة.",
    direction: "rtl",
  },
  en: {
    title: "Roll identification labels",
    preview: "Roll label preview",
    print: "Print labels",
    close: "Close preview",
    instructions: "Zebra setup: 4 × 6 in, portrait, actual size / 100%, and browser headers and footers off.",
    target: "Choose the Zebra printer in the browser print dialog. The app cannot select a printer or confirm a physical print.",
    roll: "Roll number",
    order: "Production order",
    weight: "Film weight",
    batch: "Batch number",
    scan: "Scan to open the roll record",
    loading: "Preparing labels…",
    failed: "The complete preview could not be prepared. Close this window and retry from Production.",
    imageError: "The QR image could not be loaded. Printing is disabled.",
    overflow: "A label does not fit the selected size. Printing is disabled.",
    direction: "ltr",
  },
} as const;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function safeImageSource(value: string): string {
  const trimmed = value.trim();
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)[^<>"']*$/.test(trimmed)) return trimmed;
  throw new Error("Invalid QR image source");
}

function readableIdentifier(value: unknown): string {
  return escapeHtml(value || "—");
}

/** Pure fixture-friendly renderer. All API-provided values are escaped before entering markup. */
export function buildRollLabelDocument(labels: ProductionRollLabel[], language: RollLabelLanguage): string {
  if (!labels.length) throw new Error("At least one roll label is required");
  const t = copy[language];
  const pages = labels.map(({ roll, qr }) => {
    const image = escapeHtml(safeImageSource(qr.image));
    const number = readableIdentifier(roll.roll_number);
    const order = readableIdentifier(roll.production_order_number);
    const batch = roll.batch_number ? `
      <div class="field batch"><span>${t.batch}</span><strong dir="auto">${readableIdentifier(roll.batch_number)}</strong></div>` : "";
    const longIdentifiers = roll.roll_number.length > 32 || roll.production_order_number.length > 28 || (roll.batch_number?.length ?? 0) > 28;
    return `<article class="label-sheet${longIdentifiers ? " long-identifiers" : ""}" aria-label="${escapeHtml(t.roll)} ${number}">
      <header class="label-head"><span class="brand">MPBF&nbsp; / &nbsp;ROLL TRACE</span><span class="serial">01</span></header>
      <div class="roll-number${roll.roll_number.length > 32 ? " compact" : ""}"><span>${t.roll}</span><strong dir="auto">${number}</strong></div>
      <div class="field order${roll.production_order_number.length > 28 ? " compact" : ""}"><span>${t.order}</span><strong dir="auto">${order}</strong></div>
      <div class="field weight"><span>${t.weight}</span><strong dir="ltr">${escapeHtml(formatNumber(roll.weight_kg))} <small>kg</small></strong></div>
      ${batch}
      <div class="qr-frame"><img src="${image}" alt="QR" /><span>${t.scan}</span></div>
      <footer>PRODUCTION&nbsp; / &nbsp;ROLL IDENTIFICATION</footer>
    </article>`;
  }).join("");
  return `<!doctype html>
<html lang="${language}" dir="${t.direction}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t.title)}</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #152d2c; background: #edf1ed; font-family: "Noto Sans Arabic", system-ui, sans-serif; }
    .preview-toolbar { max-width: 980px; margin: 20px auto; padding: 18px 22px; background: #fff; border: 1px solid #ccd7d0; color: #183c39; }
    .toolbar-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
    .preview-toolbar h1 { margin: 0; font-size: 19px; }
    .preview-toolbar p { margin: 9px 0 0; font-size: 13px; line-height: 1.65; }
    .preview-toolbar .target { color: #657875; }
    .preview-toolbar button { border: 0; border-radius: 3px; background: #174d4a; color: #fff; min-height: 42px; padding: 0 18px; font: 700 14px system-ui, sans-serif; cursor: pointer; }
    .preview-toolbar button:disabled { opacity: .48; cursor: wait; }
    .preview-toolbar button.close { background: transparent; color: #174d4a; border: 1px solid #bdcec5; margin-inline-start: 8px; }
    .preview-toolbar button:focus-visible { outline: 3px solid #d8784e; outline-offset: 2px; }
    .status { padding-top: 8px; color: #8c412e; }
    .label-sheet { width: 4in; height: 6in; overflow: hidden; position: relative; margin: 18px auto; padding: .24in .25in .2in; display: flex; flex-direction: column; background: #fff; color: #101817; break-after: page; page-break-after: always; }
    .label-sheet:last-child { break-after: auto; page-break-after: auto; }
    .label-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #171d1c; padding-bottom: .12in; color: #293b39; font: 700 8pt "Courier New", monospace; letter-spacing: .7pt; }
    .serial { border: 1px solid #273432; padding: 3px 6px; }
    .roll-number { display: grid; gap: 4px; padding: .19in 0 .14in; border-bottom: 1px solid #8b9693; }
    .roll-number span, .field span { color: #4a5754; font-size: 8pt; font-weight: 700; letter-spacing: .45pt; text-transform: uppercase; }
    .roll-number strong { font: 800 clamp(21pt, 8vw, 31pt)/1.1 "Courier New", monospace; letter-spacing: -.7pt; overflow-wrap: anywhere; word-break: break-word; }
    .roll-number.compact strong { font-size: 12pt; letter-spacing: 0; }
    .field { display: grid; gap: 3px; padding: .11in 0; border-bottom: 1px solid #c2c9c6; min-width: 0; }
    .field strong { font-size: 15pt; line-height: 1.13; font-weight: 750; overflow-wrap: anywhere; word-break: break-word; }
    .field.order strong { font: 700 15pt/1.16 "Courier New", monospace; }
    .field.order.compact strong { font-size: 11pt; }
    .field.batch strong { font-size: 11pt; }
    .long-identifiers .roll-number { padding: .12in 0 .1in; }
    .long-identifiers .field { padding: .07in 0; }
    .field.weight strong { font-size: 18pt; font-variant-numeric: tabular-nums; }
    .field.weight small { font-size: 11pt; }
    .qr-frame { margin: auto auto .05in; display: flex; flex-direction: column; align-items: center; }
    .qr-frame img { display: block; width: 1.78in; height: 1.78in; object-fit: contain; padding: .09in; background: #fff; image-rendering: pixelated; filter: grayscale(1) contrast(1.4); }
    .qr-frame span { margin-top: 3px; font-size: 7.5pt; text-align: center; }
    .label-sheet footer { border-top: 1px solid #171d1c; padding-top: .08in; color: #44504e; font: 700 7pt "Courier New", monospace; letter-spacing: .55pt; text-align: center; }
    @media screen { .label-sheet { max-width: 100%; box-shadow: 0 4px 18px #243c3520; } }
    @media print {
      html, body { width: 4in; margin: 0; padding: 0; background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .preview-toolbar { display: none !important; }
      .label-sheet { margin: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <section class="preview-toolbar" aria-label="${escapeHtml(t.preview)}">
    <div class="toolbar-row"><h1>${t.preview} · ${labels.length}</h1>
      <div><button id="print-labels" type="button" disabled>${t.print}</button><button id="close-preview" class="close" type="button">${t.close}</button></div>
    </div>
    <p>${t.instructions}</p><p class="target">${t.target}</p>
    <div class="status" id="preview-status" role="status">${t.loading}</div>
  </section>
  <main>${pages}</main>
</body>
</html>`;
}

export function rollLabelPreviewCopy(language: RollLabelLanguage) {
  return copy[language];
}