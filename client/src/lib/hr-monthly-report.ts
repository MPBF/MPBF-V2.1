import { monthlyReportCss } from "./hr-monthly-report.css";

export type MonthlyReportRow = {
  nameAr: string; nameEn: string; section: string; worked: string;
  days: number; absent: number; incomplete: number; overtime: string;
};
export type MonthlyReport = {
  language: "ar" | "en"; title: string; month: string;
  filters: string[]; headers: string[]; rows: MonthlyReportRow[];
};
export type ReportBranding = { companyNameAr: string; companyNameEn: string; logoSrc: string };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const label = (report: MonthlyReport, ar: string, en: string) => report.language === "en" ? en : ar;
const timeout = async <T>(work: Promise<T>, stage = "assets"): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Report ${stage} timed out`)), 15000);
    })]);
  } finally { clearTimeout(timer!); }
};

/** Fail explicitly rather than export a report without the requested identity. */
export async function loadReportBranding(language: "ar" | "en"): Promise<ReportBranding> {
  try {
    const response = await timeout(fetch("/api/public-branding", { credentials: "include" }));
    if (!response.ok) throw new Error("Branding unavailable");
    const branding = await response.json();
    if (!branding || !["companyNameAr", "companyNameEn", "logoSrc"].every(key => typeof branding[key] === "string") ||
      !branding.logoSrc || !(branding.companyNameAr || branding.companyNameEn)) throw new Error("Missing factory identity");
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = branding.logoSrc;
    await timeout(image.decode());
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { companyNameAr: branding.companyNameAr, companyNameEn: branding.companyNameEn, logoSrc: canvas.toDataURL("image/png") };
  } catch {
    throw new Error(language === "en"
      ? "Could not prepare the factory name and logo. Check factory settings and retry."
      : "تعذر تجهيز اسم المصنع وشعاره. تحقق من إعدادات المصنع ثم أعد المحاولة.");
  }
}

export function monthlyReportHtml(report: MonthlyReport, branding: ReportBranding, generatedAt = new Date()) {
  const generated = generatedAt.toLocaleString(report.language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh" });
  return `<!doctype html><html lang="${report.language}" dir="${report.language === "en" ? "ltr" : "rtl"}">
  <head><meta charset="utf-8"><title>${escape(report.title)} — ${escape(report.month)}</title>
  <style>${monthlyReportCss}</style></head><body><main class="report-document">
  <section class="report-page"><header class="report-header"><img class="report-logo" alt="${label(report, "شعار المصنع", "Factory logo")}" src="${escape(branding.logoSrc)}">
  <div class="report-factory"><strong lang="ar" dir="rtl">${escape(branding.companyNameAr)}</strong><span lang="en" dir="ltr">${escape(branding.companyNameEn)}</span></div></header>
  <div class="report-heading"><h1>${escape(report.title)}</h1><span class="report-month">${label(report, "الشهر", "Month")} <bdi>${escape(report.month)}</bdi></span></div>
  <div class="report-meta">${report.filters.map(filter => `<span>${escape(filter)}</span>`).join("")}</div>
  <table class="report-table"><colgroup><col style="width:26%"><col style="width:19%">${Array.from({ length: 5 }, () => '<col style="width:11%">').join("")}</colgroup>
  <thead><tr>${report.headers.map(header => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody></tbody></table>
  <footer class="report-footer"><span>${label(report, "تاريخ الإصدار (الرياض)", "Generated (Riyadh)")}: <bdi>${escape(generated)}</bdi></span><span class="report-page-number"></span></footer>
  </section></main></body></html>`;
}

function rowHtml(row: MonthlyReportRow) {
  return `<td><strong lang="ar" dir="rtl">${escape(row.nameAr)}</strong><small lang="en" dir="ltr">${escape(row.nameEn)}</small></td>
    <td>${escape(row.section)}</td><td><bdi>${escape(row.worked)}</bdi></td><td>${escape(row.days)}</td>
    <td>${escape(row.absent)}</td><td>${escape(row.incomplete)}</td><td><bdi>${escape(row.overtime)}</bdi></td>`;
}

/** Shared measured pagination for print and downloadable PDF; no screenshot slices. */
export async function prepareMonthlyReport(report: MonthlyReport, branding: ReportBranding) {
  const frame = document.createElement("iframe");
  frame.title = report.title;
  frame.dataset.hrMonthlyReport = "";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0";
  const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
  frame.srcdoc = monthlyReportHtml(report, branding);
  document.body.appendChild(frame);
  try {
    await timeout(loaded, "frame");
    const doc = frame.contentDocument!;
    doc.body.getBoundingClientRect();
    await timeout(doc.fonts.ready, "fonts");
    // The frame's load event includes its embedded PNG. decode() can wait for a
    // paint indefinitely in an off-screen/background frame despite a loaded image.
    if (Array.from(doc.images).some(image => !image.complete || image.naturalWidth === 0)) {
      throw new Error(label(report, "تعذر تحميل شعار المصنع.", "The factory logo could not be loaded."));
    }
    const root = doc.querySelector(".report-document")!;
    const template = doc.querySelector<HTMLElement>(".report-page")!;
    let page = template;
    const addPage = () => {
      page = template.cloneNode(true) as HTMLElement;
      page.querySelector("tbody")!.replaceChildren();
      root.appendChild(page);
    };
    for (const row of report.rows) {
      const tr = doc.createElement("tr");
      tr.innerHTML = rowHtml(row);
      page.querySelector("tbody")!.appendChild(tr);
      const fits = () => page.querySelector("table")!.getBoundingClientRect().bottom + 8 <= page.querySelector("footer")!.getBoundingClientRect().top;
      if (!fits()) {
        tr.remove();
        if (!page.querySelector("tbody")!.children.length) throw new Error(label(report, "بيانات أحد الصفوف أكبر من مساحة الصفحة.", "One row exceeds the page area."));
        addPage();
        page.querySelector("tbody")!.appendChild(tr);
        if (!fits()) throw new Error(label(report, "بيانات أحد الصفوف أكبر من مساحة الصفحة.", "One row exceeds the page area."));
      }
    }
    if (!report.rows.length) {
      const tr = doc.createElement("tr");
      const td = doc.createElement("td"); td.colSpan = 7;
      td.textContent = label(report, "لا توجد بيانات مطابقة للفلاتر.", "No records match the filters.");
      tr.appendChild(td); page.querySelector("tbody")!.appendChild(tr);
    }
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".report-page"));
    pages.forEach((entry, index) => {
      entry.querySelector(".report-page-number")!.textContent = `${label(report, "صفحة", "Page")} ${index + 1} / ${pages.length}`;
    });
    return { frame, pages, dispose: () => frame.remove() };
  } catch (error) { frame.remove(); throw error; }
}

export async function printMonthlyReport(report: MonthlyReport) {
  const branding = await loadReportBranding(report.language);
  const prepared = await prepareMonthlyReport(report, branding);
  const target = prepared.frame.contentWindow!;
  target.addEventListener("afterprint", prepared.dispose, { once: true });
  window.setTimeout(prepared.dispose, 300000);
  target.focus();
  target.print();
}

export async function downloadMonthlyPdf(report: MonthlyReport) {
  const branding = await loadReportBranding(report.language);
  const prepared = await prepareMonthlyReport(report, branding);
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: `${report.title} — ${report.month}`, author: branding.companyNameAr || branding.companyNameEn });
    for (const [index, page] of prepared.pages.entries()) {
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1123, windowHeight: 794 });
      if (index) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 10, 10, 277, 177, undefined, "FAST");
    }
    pdf.save(`${report.language === "en" ? "attendance" : "كشف-الحضور"}-${report.month}.pdf`);
  } finally { prepared.dispose(); }
}

export async function buildMonthlyWorkbook(report: MonthlyReport, branding: ReportBranding) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = branding.companyNameAr || branding.companyNameEn;
  workbook.title = `${report.title} — ${report.month}`;
  const sheet = workbook.addWorksheet(label(report, "كشف الحضور", "Attendance"), {
    views: [{ rightToLeft: report.language === "ar", state: "frozen", ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, printTitlesRow: "1:6",
      margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.5, header: 0.15, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${report.month}&R&P / &N` },
  });
  for (const row of [1, 2, 3, 4, 5]) sheet.mergeCells(row, 2, row, 7);
  sheet.getCell("B1").value = branding.companyNameAr;
  sheet.getCell("B2").value = branding.companyNameEn;
  sheet.getCell("B3").value = report.title;
  sheet.getCell("B4").value = `${label(report, "الشهر", "Month")}: ${report.month}`;
  sheet.getCell("B5").value = report.filters.join("  ·  ");
  for (let index = 1; index <= 5; index++) {
    const row = sheet.getRow(index); row.height = index === 5 ? 30 : 23;
    row.getCell(2).font = { name: "Arial", size: index === 3 ? 15 : 11, bold: index !== 5, color: { argb: "FF183C36" } };
    row.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  const image = workbook.addImage({ base64: branding.logoSrc, extension: "png" });
  sheet.addImage(image, { tl: { col: 0.12, row: 0.2 }, ext: { width: 105, height: 105 } });
  const header = sheet.getRow(6);
  header.values = report.headers;
  header.height = 32;
  for (const row of report.rows) sheet.addRow([`${row.nameAr}\n${row.nameEn}`, row.section, row.worked, row.days, row.absent, row.incomplete, row.overtime]);
  sheet.columns.forEach((column, index) => { column.width = [32, 25, 22, 17, 17, 20, 22][index]; });
  sheet.eachRow((row, number) => {
    if (number < 6) return;
    row.height = number === 6 ? 32 : 34;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: "Arial", size: 11, bold: number === 6, color: { argb: "FF183C36" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD3DFDB" } } };
      if (number === 6 || number % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: number === 6 ? "FFE3EFEB" : "FFF5F8F6" } };
    });
  });
  sheet.pageSetup.printArea = `A1:G${Math.max(6, sheet.rowCount)}`;
  return workbook;
}

export async function downloadMonthlyExcel(report: MonthlyReport) {
  const branding = await loadReportBranding(report.language);
  const workbook = await buildMonthlyWorkbook(report, branding);
  const { saveAs } = await import("file-saver");
  const bytes = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${report.language === "en" ? "attendance" : "كشف-الحضور"}-${report.month}.xlsx`);
}
