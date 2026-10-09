import i18n, { intlLocale, translate, translateError } from "../i18n";
import { AlertTriangle, CalendarDays, Check, Download, Edit3, FileDown, Plus, Printer, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { riyadhDateTimeInput, riyadhDateTimeToIso } from "../lib/riyadh-time";

export type HrEmployee = {
  id: number;
  username: string | null;
  display_name: string | null;
  display_name_ar: string | null;
  section_id: string | null;
  section_name?: string | null;
};

type OperationsTab = "audit" | "report" | "violations";
type AttendanceEvent = HrEmployee & {
  id: number;
  user_id: number;
  session_id: number | null;
  shift_date: string | null;
  action: AttendanceAction;
  occurred_at: string;
  source: "employee" | "manual";
  created_by: number | null;
  updated_by: number | null;
  updated_at: string;
};
type AttendanceAction = "check_in" | "break_start" | "break_end" | "check_out";
type OpenSession = HrEmployee & { id: number; user_id: number; shift_date: string; shift_id: string; check_in_at: string; shift_end_at: string; last_action: AttendanceAction | null };
type SummaryRow = HrEmployee & {
  workedMinutes: number;
  daysWorked: number;
  absentDays: number;
  overtimeMinutes: number;
  incompleteDays: number;
};
type Violation = HrEmployee & {
  id: number;
  user_id: number;
  title: string;
  details: string;
  created_at: string;
  acknowledged_at: string | null;
};
type Filters = { section: string; user: string };
type EventDraft = { id?: number; user_id: string; action: AttendanceAction; occurred_at: string };
type ViolationDraft = { user_id: string; title: string; details: string };

const rawActionLabels: Record<AttendanceAction, string> = {
  check_in: "تسجيل حضور",
  break_start: "بدء استراحة",
  break_end: "إنهاء استراحة",
  check_out: "تسجيل انصراف",
};
const actionLabels: Record<AttendanceAction, string> = new Proxy(rawActionLabels, {
  get(target, property) {
    if (typeof property !== "string") return undefined;
    const value = target[property as AttendanceAction];
    return value ? translate(value) : value;
  },
});

const hrApi = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api/hr${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر تنفيذ الطلب"));
  return body as T;
};

const employeeName = (employee: HrEmployee) => (i18n.language === "en" ? employee.display_name || employee.display_name_ar : employee.display_name_ar || employee.display_name) || employee.username || `${translate("مستخدم")} ${employee.id}`;
const reportArabicName = (employee: HrEmployee) => employee.display_name_ar || "—";
const reportEnglishName = (employee: HrEmployee) => employee.display_name || "—";
const sectionName = (employee: HrEmployee) => employee.section_name || "—";
const riyadhToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const riyadhMonth = () => riyadhToday().slice(0, 7);
const formatDateTime = (value: string) => new Intl.DateTimeFormat(intlLocale(), {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
}).format(new Date(value));
const formatMinutes = (minutes: number) => i18n.language === "en"
  ? `${Math.floor(minutes / 60).toLocaleString(intlLocale())} h ${String(minutes % 60).padStart(2, "0")} min`
  : `${Math.floor(minutes / 60).toLocaleString(intlLocale())} س ${String(minutes % 60).padStart(2, "0")} د`;
const query = (values: Record<string, string>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);

function printDocument(title: string, body: string) {
  const popup = window.open("", "_blank", "width=1100,height=800");
  if (!popup) throw new Error(translate("اسمح بالنوافذ المنبثقة لإتمام الطباعة"));
  popup.document.write(`<!doctype html><html dir="${document.documentElement.dir}" lang="${document.documentElement.lang}"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#183033;padding:28px}h1{font-size:22px;border-bottom:3px solid #08756e;padding-bottom:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #cfded9;padding:9px;text-align:center}th{background:#e7f3ef}small{color:#647774}.signature{margin-top:60px;display:flex;justify-content:space-between}</style></head><body><h1>${title}</h1>${body}</body></html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}

export default function HumanResourcesOperations({ tab, employees, refreshToken = 0 }: { tab: OperationsTab; employees: HrEmployee[]; refreshToken?: number }) {
  const [filters, setFilters] = useState<Filters>({ section: "", user: "" });
  const [day, setDay] = useState(riyadhToday);
  const [month, setMonth] = useState(riyadhMonth);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [correction, setCorrection] = useState<{ session: OpenSession; checkout: string; breakEnd: string } | null>(null);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [violationDraft, setViolationDraft] = useState<ViolationDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => Array.from(new Map(employees.filter((employee) => employee.section_id).map((employee) => [employee.section_id!, sectionName(employee)])).entries()), [employees]);
  const filteredEmployees = useMemo(() => employees.filter((employee) => !filters.section || employee.section_id === filters.section), [employees, filters.section]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const common = { section_id: filters.section, user_id: filters.user };
      if (tab === "audit") {
        const [audit, open] = await Promise.all([
          hrApi<AttendanceEvent[]>(`/attendance-events?${query({ ...common, day })}`),
          hrApi<OpenSession[]>(`/attendance-sessions/open?${query(common)}`),
        ]);
        setEvents(audit);
        setOpenSessions(open);
      }
      if (tab === "report") setSummary((await hrApi<{ rows: SummaryRow[] }>(`/attendance-summary?${query({ ...common, month })}`)).rows);
      if (tab === "violations") setViolations(await hrApi<Violation[]>(`/violations?${query(common)}`));
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }, [day, filters.section, filters.user, month, tab]);

  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => {
    if (filters.user && !filteredEmployees.some((employee) => String(employee.id) === filters.user)) setFilters((current) => ({ ...current, user: "" }));
  }, [filteredEmployees, filters.user]);

  const saveEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventDraft) return;
    setBusy("event"); setError(""); setNotice("");
    try {
      await hrApi(eventDraft.id ? `/attendance-events/${eventDraft.id}` : "/attendance-events", {
        method: eventDraft.id ? "PUT" : "POST",
        body: JSON.stringify({ user_id: Number(eventDraft.user_id), action: eventDraft.action, occurred_at: riyadhDateTimeToIso(eventDraft.occurred_at) }),
      });
      setEventDraft(null); setNotice(eventDraft.id ? "تم تعديل سجل الحضور." : "تمت إضافة سجل الحضور اليدوي."); await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const correctSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!correction) return;
    setBusy("correction"); setError(""); setNotice("");
    try {
      await hrApi(`/attendance-sessions/${correction.session.id}/checkout`, {
        method: "POST",
        body: JSON.stringify({
          occurred_at: riyadhDateTimeToIso(correction.checkout),
          ...(correction.session.last_action === "break_start" ? { break_end_at: riyadhDateTimeToIso(correction.breakEnd) } : {}),
        }),
      });
      setCorrection(null);
      setNotice(translate("تم تصحيح الانصراف واحتساب الوردية في تاريخ بدايتها."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const saveViolation = async (event: FormEvent) => {
    event.preventDefault();
    if (!violationDraft) return;
    setBusy("violation"); setError(""); setNotice("");
    try {
      await hrApi("/violations", { method: "POST", body: JSON.stringify({ ...violationDraft, user_id: Number(violationDraft.user_id) }) });
      setViolationDraft(null); setNotice(translate("تم تسجيل المخالفة وإتاحتها للموظف.")); await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const deleteAttendanceEvent = async (entry: AttendanceEvent) => {
    if (!window.confirm(translate("حذف سجل {{action}} للموظف {{employee}} بتاريخ {{date}}؟", { action: actionLabels[entry.action], employee: employeeName(entry), date: formatDateTime(entry.occurred_at) }))) return;
    setBusy(`delete-event-${entry.id}`); setError(""); setNotice("");
    try {
      await hrApi(`/attendance-events/${entry.id}`, { method: "DELETE" });
      setNotice(translate("تم حذف سجل الحضور."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const exportExcel = async () => {
    setBusy("excel"); setError("");
    try {
      const XLSX = await import("xlsx");
      const rows = summary.map((row) => ({
        [translate("اسم المستخدم")]: `${reportArabicName(row)}\n${reportEnglishName(row)}`, [translate("القسم")]: sectionName(row), [translate("م ساعات العمل")]: formatMinutes(row.workedMinutes),
        [translate("م أيام العمل")]: row.daysWorked, [translate("م الغياب")]: row.absentDays, [translate("وردية ناقصة")]: row.incompleteDays, [translate("م الاضافي")]: formatMinutes(row.overtimeMinutes),
      }));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(workbook, sheet, translate("كشف الحضور"));
      XLSX.writeFile(workbook, `${i18n.language === "en" ? "attendance" : "كشف-الحضور"}-${month}.xlsx`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setBusy("pdf"); setError("");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: "#ffffff", ignoreElements: (element) => element.classList.contains("hr-no-export") });
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const width = 277;
      const height = canvas.height * width / canvas.width;
      const image = canvas.toDataURL("image/png");
      const pageHeight = 190;
      let position = 10;
      let remaining = height;
      pdf.addImage(image, "PNG", 10, position, width, height);
      while (remaining > pageHeight) {
        remaining -= pageHeight;
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(image, "PNG", 10, position, width, height);
      }
      pdf.save(`${i18n.language === "en" ? "attendance" : "كشف-الحضور"}-${month}.pdf`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const printSummary = (rows: SummaryRow[], title = translate("كشف الحضور الشهري — {{month}}", { month })) => {
    const headers = ["اسم المستخدم", "القسم", "م ساعات العمل", "م أيام العمل", "م الغياب", "وردية ناقصة", "م الاضافي"];
    const body = `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(translate(header))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(reportArabicName(row))}</strong><br><small>${escapeHtml(reportEnglishName(row))}</small></td><td>${escapeHtml(sectionName(row))}</td><td>${formatMinutes(row.workedMinutes)}</td><td>${row.daysWorked}</td><td>${row.absentDays}</td><td>${row.incompleteDays}</td><td>${formatMinutes(row.overtimeMinutes)}</td></tr>`).join("")}</tbody></table>`;
    const reportTitle = i18n.language === "en" && title.startsWith("كشف حضور —") && rows[0]
      ? translate("تقرير حضور {{employee}} — {{month}}", { employee: employeeName(rows[0]), month })
      : translate(title);
    printDocument(escapeHtml(reportTitle), body);
  };

  const printViolation = (violation: Violation) => printDocument(translate("مخالفة موظف"), `<p><strong>${escapeHtml(translate("الموظف:"))}</strong> ${escapeHtml(employeeName(violation))}</p><p><strong>${escapeHtml(translate("القسم:"))}</strong> ${escapeHtml(sectionName(violation))}</p><p><strong>${escapeHtml(translate("التاريخ:"))}</strong> ${escapeHtml(formatDateTime(violation.created_at))}</p><h2>${escapeHtml(violation.title)}</h2><p>${escapeHtml(violation.details)}</p><div class="signature"><span>${escapeHtml(translate("توقيع الموظف:"))} ________________</span><span>${escapeHtml(translate("اعتماد الإدارة:"))} ________________</span></div>`);

  return <>
    {error && <div className="hr-alert error"><AlertTriangle size={16} />{error}</div>}
    {notice && <div className="hr-alert success"><Check size={16} />{notice}</div>}

    <section className="hr-ops-section">
      <div className="hr-filters">
        <div className="hr-filter-title"><Search size={17} /><div><strong>{translate("تصفية النتائج")}</strong><small>{translate("تتحدث النتائج تلقائياً")}</small></div></div>
        {tab === "audit" && <label><span>{translate("اليوم")}</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>}
        {tab === "report" && <label><span>{translate("الشهر")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
        <label><span>{translate("القسم")}</span><select value={filters.section} onChange={(event) => setFilters({ section: event.target.value, user: "" })}><option value="">{translate("كل الأقسام")}</option>{sections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>{translate("الموظف")}</span><select value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))}><option value="">{translate("كل الموظفين")}</option>{filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}</select></label>
        <button type="button" className="hr-filter-refresh" disabled={loading} onClick={() => void load()}>{loading ? translate("جارٍ التحميل…") : translate("تحديث")}</button>
      </div>

      {tab === "audit" && <>
        <div className="hr-ops-head"><div><span>{translate("ورديات غير مكتملة")}</span><h3>{translate("ورديات بانتظار تصحيح الانصراف")}</h3><p>{translate("لا تُحتسب الساعات أو الأجر قبل تسجيل وقت الانصراف الفعلي. يمكنك تصحيح استراحة مفتوحة والانصراف معًا.")}</p></div></div>
        <div className="hr-table-wrap"><table className="hr-data-table"><thead><tr><th>{translate("الموظف")}</th><th>{translate("تاريخ احتساب الوردية")}</th><th>{translate("وقت الحضور الفعلي")}</th><th>{translate("الوردية")}</th><th>{translate("الإجراء")}</th></tr></thead><tbody>{openSessions.map((session) => <tr key={session.id}><td>{employeeName(session)}</td><td>{session.shift_date}</td><td>{formatDateTime(session.check_in_at)}</td><td>{session.shift_id}</td><td><button className="hr-icon-action" type="button" onClick={() => setCorrection({ session, checkout: "", breakEnd: "" })}>{translate("تصحيح الانصراف")}</button></td></tr>)}</tbody></table>{!loading && !openSessions.length && <div className="hr-empty">{translate("لا توجد ورديات غير مكتملة.")}</div>}</div>
        <div className="hr-ops-head"><div><span>{translate("تدقيق الحضور")}</span><h3>{translate("سجل التدقيق")}</h3><p>{translate("جميع حركات الحضور مرتبة من الأحدث إلى الأقدم.")}</p></div><button className="hr-primary" type="button" onClick={() => setEventDraft({ user_id: filters.user, action: "break_end", occurred_at: riyadhDateTimeInput() })}><Plus size={17} />{" "}{translate("إنهاء استراحة يدويًا")}</button></div>
        <div className="hr-table-wrap"><table className="hr-data-table hr-audit-table"><thead><tr><th>{translate("الموظف")}</th><th>{translate("القسم")}</th><th>{translate("الحركة")}</th><th>{translate("وقت الحركة الفعلي")}</th><th>{translate("يوم احتساب الوردية")}</th><th>{translate("المصدر")}</th><th>{translate("الإجراء")}</th></tr></thead><tbody>{events.map((entry) => <tr key={entry.id}><td className="hr-employee-cell"><strong>{reportArabicName(entry)}</strong><small>{reportEnglishName(entry)}</small></td><td>{sectionName(entry)}</td><td><span className={`hr-action-pill ${entry.action}`}>{actionLabels[entry.action]}</span></td><td>{formatDateTime(entry.occurred_at)}</td><td>{entry.shift_date || "سجل قديم"}</td><td><span className={`hr-source ${entry.source}`}>{entry.source === "manual" ? translate("يدوي") : translate("الموظف")}</span></td><td>{entry.session_id != null ? <span>{translate("محفوظ ضمن الجلسة")}</span> : <div className="hr-row-actions"><button className="hr-icon-action" type="button" onClick={() => setEventDraft({ id: entry.id, user_id: String(entry.user_id), action: entry.action, occurred_at: riyadhDateTimeInput(new Date(entry.occurred_at)) })}><Edit3 size={15} />{" "}{translate("تعديل")}</button><button className="hr-icon-action danger" type="button" disabled={busy === `delete-event-${entry.id}`} onClick={() => void deleteAttendanceEvent(entry)}><Trash2 size={15} />{busy === `delete-event-${entry.id}` ? translate("جارٍ الحذف…") : translate("حذف")}</button></div>}</td></tr>)}</tbody></table>{!loading && !events.length && <div className="hr-empty">{translate("لا توجد سجلات مطابقة لهذا اليوم.")}</div>}</div>
      </>}

      {tab === "report" && <>
        <div className="hr-ops-head"><div><span>{translate("الحضور الشهري")}</span><h3>{translate("كشف الحضور الشهري")}</h3><p>{translate("ملخص تراكمي محسوب من حركات الحضور والورديات الفعلية.")}</p></div><div className="hr-export-actions"><button type="button" onClick={() => printSummary(summary)}><Printer size={16} />{" "}{translate("طباعة الكل")}</button><button type="button" disabled={busy === "excel"} onClick={() => void exportExcel()}><Download size={16} /> Excel</button><button type="button" disabled={busy === "pdf"} onClick={() => void exportPdf()}><FileDown size={16} /> PDF</button></div></div>
        <div ref={reportRef} className="hr-report-sheet"><div className="hr-report-caption"><CalendarDays size={19} /><div><strong>{translate("كشف الحضور")}</strong><small>{translate("الشهر")}{" "}{month}</small></div></div><div className="hr-table-wrap"><table className="hr-data-table"><thead><tr><th>{translate("اسم المستخدم")}</th><th>{translate("القسم")}</th><th>{translate("م ساعات العمل")}</th><th>{translate("م أيام العمل")}</th><th>{translate("م الغياب")}</th><th>{translate("وردية ناقصة")}</th><th>{translate("م الاضافي")}</th><th className="hr-no-export">{translate("طباعة")}</th></tr></thead><tbody>{summary.map((row) => <tr key={row.id}><td className="hr-employee-cell"><strong>{reportArabicName(row)}</strong><small>{reportEnglishName(row)}</small></td><td>{sectionName(row)}</td><td>{formatMinutes(row.workedMinutes)}</td><td><b>{row.daysWorked}</b></td><td><b className={row.absentDays ? "hr-negative" : ""}>{row.absentDays}</b></td><td><b className={row.incompleteDays ? "hr-negative" : ""}>{row.incompleteDays}</b></td><td><b className="hr-positive">{formatMinutes(row.overtimeMinutes)}</b></td><td className="hr-no-export"><button className="hr-icon-action" type="button" onClick={() => printSummary([row], `كشف حضور — ${reportArabicName(row)} — ${month}`)}><Printer size={15} />{" "}{translate("طباعة")}</button></td></tr>)}</tbody></table>{!loading && !summary.length && <div className="hr-empty">{translate("لا توجد بيانات مطابقة للفلاتر.")}</div>}</div></div>
      </>}

      {tab === "violations" && <>
        <div className="hr-ops-head"><div><span>{translate("امتثال الموظفين")}</span><h3>{translate("مخالفات الموظفين")}</h3><p>{translate("سجل المخالفات وحالة اطلاع الموظف عليها.")}</p></div><button className="hr-primary" type="button" onClick={() => setViolationDraft({ user_id: filters.user, title: "", details: "" })}><ShieldAlert size={17} />{" "}{translate("إعطاء مخالفة")}</button></div>
        <div className="hr-violations-grid">{violations.map((violation) => <article className="hr-violation-card" key={violation.id}><div className="hr-violation-mark"><ShieldAlert size={20} /></div><div><div className="hr-violation-meta"><strong>{employeeName(violation)}</strong><time>{formatDateTime(violation.created_at)}</time></div><h4>{violation.title}</h4><p>{violation.details}</p><footer><span className={violation.acknowledged_at ? "seen" : "pending"}>{violation.acknowledged_at ? `تم الاطلاع ${formatDateTime(violation.acknowledged_at)}` : translate("بانتظار اطلاع الموظف")}</span><button type="button" onClick={() => printViolation(violation)}><Printer size={15} />{" "}{translate("طباعة المخالفة")}</button></footer></div></article>)}{!loading && !violations.length && <div className="hr-empty">{translate("لا توجد مخالفات مطابقة للفلاتر.")}</div>}</div>
      </>}
    </section>

    {correction && <div className="hr-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCorrection(null)}><form className="hr-modal hr-compact-modal" onSubmit={correctSession}><header><div><span>{translate("تصحيح الحضور")}</span><h3>{translate("تصحيح وردية")}{" "}{correction.session.shift_date}</h3></div><button type="button" onClick={() => setCorrection(null)} aria-label={translate("إغلاق")}><X /></button></header><p>{translate("الموظف:")}{" "}{employeeName(correction.session)}{" "}{translate("· الحضور:")}{" "}{formatDateTime(correction.session.check_in_at)}{translate(". أدخل وقت الانصراف الحقيقي، لا وقت إدخال التصحيح.")}</p><div className="hr-form-grid">
      {correction.session.last_action === "break_start" && <label><span>{translate("وقت نهاية الاستراحة الفعلي (بتوقيت الرياض)")}</span><input required type="datetime-local" value={correction.breakEnd} onChange={(event) => setCorrection({ ...correction, breakEnd: event.target.value })} /></label>}
      <label><span>{translate("وقت الانصراف الفعلي (بتوقيت الرياض)")}</span><input required type="datetime-local" value={correction.checkout} onChange={(event) => setCorrection({ ...correction, checkout: event.target.value })} /></label>
    </div><footer><button className="hr-primary" disabled={busy === "correction"}>{busy === "correction" ? translate("جارٍ التصحيح…") : translate("حفظ التصحيح")}</button><button type="button" onClick={() => setCorrection(null)}>{translate("إلغاء")}</button></footer></form></div>}
    {eventDraft && <div className="hr-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEventDraft(null)}><form className="hr-modal hr-compact-modal" onSubmit={saveEvent}><header><div><span>{translate("سجل الحضور")}</span><h3>{eventDraft.id ? translate("تعديل سجل الحضور") : translate("إضافة سجل يدوي")}</h3></div><button type="button" onClick={() => setEventDraft(null)} aria-label={translate("إغلاق")}><X /></button></header><div className="hr-form-grid">
      <label><span>{translate("الموظف")}</span><select required value={eventDraft.user_id} onChange={(event) => setEventDraft({ ...eventDraft, user_id: event.target.value })}><option value="">{translate("اختر الموظف")}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)} — {sectionName(employee)}</option>)}</select></label>
      <label><span>{translate("الحركة")}</span><select disabled={!eventDraft.id} value={eventDraft.action} onChange={(event) => setEventDraft({ ...eventDraft, action: event.target.value as AttendanceAction })}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{translate(label)}</option>)}</select></label>
      <label><span>{translate("التاريخ والوقت (بتوقيت الرياض)")}</span><input required type="datetime-local" value={eventDraft.occurred_at} onChange={(event) => setEventDraft({ ...eventDraft, occurred_at: event.target.value })} /></label>
    </div><footer><button className="hr-primary" disabled={busy === "event"}>{busy === "event" ? translate("جارٍ الحفظ…") : translate("حفظ السجل")}</button><button type="button" onClick={() => setEventDraft(null)}>{translate("إلغاء")}</button></footer></form></div>}

    {violationDraft && <div className="hr-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setViolationDraft(null)}><form className="hr-modal hr-compact-modal" onSubmit={saveViolation}><header><div><span>EMPLOYEE VIOLATION</span><h3>{translate("إعطاء مخالفة")}</h3></div><button type="button" onClick={() => setViolationDraft(null)} aria-label={translate("إغلاق")}><X /></button></header><div className="hr-form-grid hr-violation-form">
      <label><span>{translate("الموظف")}</span><select required value={violationDraft.user_id} onChange={(event) => setViolationDraft({ ...violationDraft, user_id: event.target.value })}><option value="">{translate("اختر الموظف")}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)} — {sectionName(employee)}</option>)}</select></label>
      <label><span>{translate("عنوان المخالفة")}</span><input required maxLength={200} value={violationDraft.title} onChange={(event) => setViolationDraft({ ...violationDraft, title: event.target.value })} /></label>
      <label className="full"><span>{translate("تفاصيل المخالفة")}</span><textarea required rows={5} maxLength={5000} value={violationDraft.details} onChange={(event) => setViolationDraft({ ...violationDraft, details: event.target.value })} /></label>
    </div><footer><button className="hr-primary" disabled={busy === "violation"}>{busy === "violation" ? translate("جارٍ الحفظ…") : translate("تسجيل المخالفة")}</button><button type="button" onClick={() => setViolationDraft(null)}>{translate("إلغاء")}</button></footer></form></div>}
  </>;
}
