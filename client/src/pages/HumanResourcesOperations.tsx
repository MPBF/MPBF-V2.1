import { AlertTriangle, CalendarDays, Check, Download, FileDown, Plus, Printer, Search, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import i18n, { intlLocale, translate } from "../i18n";
import { hrApi } from "../lib/hr-api";
import { groupAttendanceEvents, type AttendanceAction, type AttendanceAuditGroup } from "../lib/hr-audit-grouping";
import { resolveCorrectionTimes, type CorrectionAction } from "../lib/hr-correction-time";
import "./hr-audit.css";
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
  shift_id?: string | null;
  shift_name_ar?: string | null;
  shift_name_en?: string | null;
  action: AttendanceAction;
  occurred_at: string;
  source: "employee" | "manual";
  created_by: number | null;
  updated_by: number | null;
  updated_at: string;
};
type AuditGroup = AttendanceAuditGroup<AttendanceEvent>;
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
type CorrectionEventDraft = { id?: number; action: AttendanceAction; occurred_at: string };
type AttendanceCorrection = {
  group: AuditGroup;
  checkIn: CorrectionEventDraft;
  breakStart: CorrectionEventDraft;
  breakEnd: CorrectionEventDraft;
  checkOut: CorrectionEventDraft;
  duplicateActions: AttendanceAction[];
};

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

const employeeName = (employee: HrEmployee) => (i18n.language === "en" ? employee.display_name || employee.display_name_ar : employee.display_name_ar || employee.display_name) || employee.username || `${translate("مستخدم")} ${employee.id}`;
const reportArabicName = (employee: HrEmployee) => employee.display_name_ar || "—";
const reportEnglishName = (employee: HrEmployee) => employee.display_name || "—";
const sectionName = (employee: HrEmployee) => employee.section_name || "—";
const riyadhToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const riyadhMonth = () => riyadhToday().slice(0, 7);
const riyadhDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const riyadhTime = (value: string) => new Intl.DateTimeFormat(intlLocale(), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(value));
const auditTime = (value: string | undefined, accountingDate: string) => {
  if (!value) return "—";
  const time = riyadhTime(value);
  const actualDate = riyadhDate(value);
  return actualDate === accountingDate ? time : `${time} · ${actualDate}`;
};
const formatDateTime = (value: string) => new Intl.DateTimeFormat(intlLocale(), {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
}).format(new Date(value));
const formatMinutes = (minutes: number) => i18n.language === "en"
  ? `${Math.floor(minutes / 60).toLocaleString(intlLocale())} h ${String(minutes % 60).padStart(2, "0")} min`
  : `${Math.floor(minutes / 60).toLocaleString(intlLocale())} س ${String(minutes % 60).padStart(2, "0")} د`;
const query = (values: Record<string, string>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const auditTranslate = (source: string, english: string, values?: Record<string, unknown>) => translate(source, i18n.language === "en" ? { ...values, defaultValue: english } : values);
const correctionEvent = (entry: AttendanceEvent | undefined, action: AttendanceAction): CorrectionEventDraft => ({
  ...(entry ? { id: entry.id } : {}),
  action,
  occurred_at: entry ? riyadhDateTimeInput(new Date(entry.occurred_at)).slice(11, 16) : "",
});
const correctionFromGroup = (group: AuditGroup): AttendanceCorrection => {
  const byAction = (action: AttendanceAction) => group.events.filter((entry) => entry.action === action);
  const checkIns = byAction("check_in");
  const starts = byAction("break_start");
  const ends = byAction("break_end");
  const checkOuts = byAction("check_out");
  return {
    group,
    checkIn: correctionEvent(checkIns[0], "check_in"),
    breakStart: correctionEvent(starts[0], "break_start"),
    breakEnd: correctionEvent(ends[0], "break_end"),
    checkOut: correctionEvent(checkOuts[0], "check_out"),
    duplicateActions: (["check_in", "break_start", "break_end", "check_out"] as AttendanceAction[]).filter((action) => byAction(action).length > 1),
  };
};

const correctionTimeOptions = Array.from({ length: 24 * 60 }, (_, index) =>
  `${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
);

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
  const [month, setMonth] = useState(riyadhMonth);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([]);
  const [correction, setCorrection] = useState<AttendanceCorrection | null>(null);
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
  const auditGroups = useMemo(() => groupAttendanceEvents(events), [events]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const common = { section_id: filters.section, user_id: filters.user };
      if (tab === "audit") {
        const [audit, open] = await Promise.all([
          hrApi<AttendanceEvent[]>(`/attendance-events?${query({ ...common, month })}`),
          hrApi<OpenSession[]>(`/attendance-sessions/open?${query({ ...common, month })}`),
        ]);
        setEvents(audit);
        setOpenSessions(open);
      }
      if (tab === "report") setSummary((await hrApi<{ rows: SummaryRow[] }>(`/attendance-summary?${query({ ...common, month })}`)).rows);
      if (tab === "violations") setViolations(await hrApi<Violation[]>(`/violations?${query(common)}`));
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }, [filters.section, filters.user, month, tab]);

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

  const correctAttendance = async (event: FormEvent) => {
    event.preventDefault();
    if (!correction) return;
    if (correction.duplicateActions.length) return;
    if (Boolean(correction.breakStart.occurred_at) !== Boolean(correction.breakEnd.occurred_at)) {
      setError(auditTranslate("يجب إدخال وقتي بدء الاستراحة وانتهائها معًا، أو تركهما فارغين.", "Enter both break times, or leave both blank."));
      return;
    }
    if (!correction.checkIn.occurred_at || !correction.checkOut.occurred_at) {
      setError(auditTranslate("وقت الحضور ووقت الانصراف مطلوبان.", "Check-in and check-out times are required."));
      return;
    }
    setBusy("correction"); setError(""); setNotice("");
    try {
      const group = correction.group;
      const correctionRows = [correction.checkIn, correction.breakStart, correction.breakEnd, correction.checkOut];
      const resolved = resolveCorrectionTimes(
        correctionRows.map((entry) => ({ id: entry.id, action: entry.action as CorrectionAction, time: entry.occurred_at })),
        group.shift_date,
        group.events,
      );
      const eventsPayload = correctionRows.filter((entry) => entry.occurred_at).map((entry) => ({
        ...(entry.id ? { id: entry.id } : {}),
        action: entry.action,
        occurred_at: resolved[entry.action as CorrectionAction]!,
      }));
      await hrApi("/attendance-corrections", {
        method: "POST",
        body: JSON.stringify({
          session_id: group.events[0]?.session_id ?? null,
          user_id: group.user_id,
          shift_date: group.shift_date,
          expected_events: group.events.map(({ id, updated_at }) => ({ id, updated_at })),
          events: eventsPayload,
        }),
      });
      setCorrection(null);
      setNotice(translate("تم حفظ تصحيح الحضور."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const updateCorrectionEvent = (action: AttendanceAction, value: string) => {
    const field = action === "check_in" ? "checkIn"
      : action === "break_start" ? "breakStart"
        : action === "break_end" ? "breakEnd" : "checkOut";
    setCorrection((current) => current ? { ...current, [field]: { ...current[field], occurred_at: value } } : current);
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

  const exportExcel = async () => {
    setBusy("excel"); setError("");
    try {
      const { Workbook } = await import("exceljs");
      const { saveAs } = await import("file-saver");
      const rows = summary.map((row) => ({
        [translate("اسم المستخدم")]: `${reportArabicName(row)}\n${reportEnglishName(row)}`, [translate("القسم")]: sectionName(row), [translate("م ساعات العمل")]: formatMinutes(row.workedMinutes),
        [translate("م أيام العمل")]: row.daysWorked, [translate("م الغياب")]: row.absentDays, [translate("وردية ناقصة")]: row.incompleteDays, [translate("م الاضافي")]: formatMinutes(row.overtimeMinutes),
      }));
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet(translate("كشف الحضور"));
      const headers = [
        translate("اسم المستخدم"), translate("القسم"), translate("م ساعات العمل"),
        translate("م أيام العمل"), translate("م الغياب"), translate("وردية ناقصة"), translate("م الاضافي"),
      ];
      sheet.addRow(headers);
      for (const row of rows) sheet.addRow(headers.map((header) => row[header]));
      sheet.columns.forEach((column, index) => { column.width = [28, 22, 20, 18, 16, 22, 20][index]; });
      const bytes = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([new Uint8Array(bytes)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }), `${i18n.language === "en" ? "attendance" : "كشف-الحضور"}-${month}.xlsx`);
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
        {tab === "audit" && <label><span>{translate("الشهر")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
        {tab === "report" && <label><span>{translate("الشهر")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
        <label><span>{translate("القسم")}</span><select value={filters.section} onChange={(event) => setFilters({ section: event.target.value, user: "" })}><option value="">{translate("كل الأقسام")}</option>{sections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>{translate("الموظف")}</span><select value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))}><option value="">{translate("كل الموظفين")}</option>{filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeName(employee)}</option>)}</select></label>
        <button type="button" className="hr-filter-refresh" disabled={loading} onClick={() => void load()}>{loading ? translate("جارٍ التحميل…") : translate("تحديث")}</button>
      </div>

      {tab === "audit" && <>
        <div className="hr-ops-head"><div><span>{translate("تدقيق الحضور")}</span><h3>{translate("سجل التدقيق")}</h3><p>{auditTranslate("عرض كل موظف مرة واحدة لكل وردية، مع ترتيب الورديات من الأحدث إلى الأقدم.", "One row per employee per shift, newest shifts first.")}</p></div><button className="hr-primary" type="button" onClick={() => setEventDraft({ user_id: filters.user, action: "break_end", occurred_at: riyadhDateTimeInput() })}><Plus size={17} />{" "}{translate("إنهاء استراحة يدويًا")}</button></div>
        <div className="hr-table-wrap" role="region" aria-label={auditTranslate("سجل تدقيق الحضور", "Attendance audit log")} tabIndex={0}><table className="hr-data-table hr-audit-table"><thead><tr><th>{i18n.language === "en" ? "Serial" : "م"}</th><th>{auditTranslate("التاريخ", "Date")}</th><th>{translate("الموظف")}</th><th>{auditTranslate("وقت الحضور", "Check-in")}</th><th>{auditTranslate("وقت الاستراحة", "Break start")}</th><th>{auditTranslate("وقت العودة من الاستراحة", "Break end")}</th><th>{auditTranslate("وقت المغادرة", "Check-out")}</th><th>{auditTranslate("اسم الوردية", "Shift name")}</th><th>{auditTranslate("الإجراءات", "Actions")}</th></tr></thead><tbody>{auditGroups.map((group, index) => {
          const person = group.employee;
          const shiftName = i18n.language === "en"
            ? (person.shift_name_en && !/[\u0600-\u06ff]/.test(person.shift_name_en)
              ? person.shift_name_en
              : person.shift_id && !/[\u0600-\u06ff]/.test(person.shift_id) ? person.shift_id : "—")
            : (person.shift_name_ar || person.shift_name_en || person.shift_id || "—");
          const timeCell = (items: AttendanceEvent[]) => items.length
            ? <div className="hr-audit-times">{items.map((entry) => <span key={entry.id}>{auditTime(entry.occurred_at, group.shift_date)}</span>)}</div>
            : "—";
          const incompleteSession = openSessions.find((session) =>
            session.user_id === group.user_id &&
            group.events.some((entry) => entry.session_id === session.id && entry.user_id === session.user_id)
          );
          const ordered = group.events;
          let breakDepth = 0;
          let breaksWellFormed = true;
          for (const entry of ordered) {
            if (entry.action === "break_start") {
              if (breakDepth > 0) breaksWellFormed = false;
              breakDepth += 1;
            }
            if (entry.action === "break_end") {
              if (breakDepth <= 0) breaksWellFormed = false;
              else breakDepth -= 1;
            }
          }
          const hasCheckIn = group.checkIns.length > 0;
          const hasCheckOut = group.checkOuts.length > 0;
          const firstCheckIn = group.checkIns[0];
          const lastCheckOut = group.checkOuts[group.checkOuts.length - 1];
          const checkInTime = firstCheckIn ? Date.parse(firstCheckIn.occurred_at) : Number.NaN;
          const checkOutTime = lastCheckOut ? Date.parse(lastCheckOut.occurred_at) : Number.NaN;
          const breaksOutsideShift = Boolean(firstCheckIn && lastCheckOut) && group.events.some((entry) =>
            (entry.action === "break_start" || entry.action === "break_end") &&
            (Date.parse(entry.occurred_at) <= checkInTime || Date.parse(entry.occurred_at) >= checkOutTime)
          );
          const malformedClosed = hasCheckOut && (
            group.checkIns.length !== 1 ||
            group.checkOuts.length !== 1 ||
            breakDepth !== 0 ||
            !breaksWellFormed ||
            checkInTime >= checkOutTime ||
            breaksOutsideShift
          );
          const incomplete = !hasCheckIn || !hasCheckOut || malformedClosed;
          const overdueOpen = Boolean(incompleteSession && Date.now() > Date.parse(incompleteSession.shift_end_at));
          const redRow = overdueOpen || malformedClosed;
          return <tr key={group.key} className={redRow ? "hr-audit-overdue" : undefined}>
            <td>{(index + 1).toLocaleString(intlLocale())}</td><td>{group.shift_date}</td><td className="hr-employee-cell"><strong>{reportArabicName(person)}</strong><small>{reportEnglishName(person)}</small></td><td>{timeCell(group.checkIns)}</td><td>{timeCell(group.breakStarts)}</td><td>{timeCell(group.breakEnds)}</td><td>{timeCell(group.checkOuts)}</td><td>{shiftName}</td><td><button className={`hr-audit-status ${incomplete ? "incomplete" : "complete"}`} type="button" aria-label={auditTranslate("تصحيح حالة حضور {{employee}} بتاريخ {{date}}", "Correct attendance status for {{employee}} on {{date}}", { employee: employeeName(person), date: group.shift_date })} onClick={() => setCorrection(correctionFromGroup(group))}>{incomplete ? auditTranslate("غير مكتمل", "Incomplete") : auditTranslate("مكتمل", "Complete")}</button></td>
          </tr>;
        })}</tbody></table>{loading && <div className="hr-empty" aria-live="polite">{translate("جارٍ التحميل…")}</div>}{!loading && !auditGroups.length && <div className="hr-empty">{auditTranslate("لا توجد سجلات مطابقة لهذا الشهر.", "No matching records for this month.")}</div>}</div>
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

    {correction && <div className="hr-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && busy !== "correction" && setCorrection(null)}><form className="hr-modal hr-compact-modal hr-correction-modal" onSubmit={correctAttendance}><header><div><span>{auditTranslate("تصحيح سجل الوردية", "SHIFT ATTENDANCE CORRECTION")}</span><h3>{employeeName(correction.group.employee)}</h3></div><button type="button" disabled={busy === "correction"} onClick={() => setCorrection(null)} aria-label={translate("إغلاق")}><X /></button></header>
      <div className="hr-correction-employee" aria-label={auditTranslate("بيانات الموظف والوردية", "Employee and shift details")}><div><span>{auditTranslate("التاريخ المحاسبي", "Accounting date")}</span><strong>{correction.group.shift_date}</strong></div><div><span>{auditTranslate("اسم الوردية", "Shift name")}</span><strong>{i18n.language === "en"
        ? (correction.group.employee.shift_name_en && !/[\u0600-\u06ff]/.test(correction.group.employee.shift_name_en) ? correction.group.employee.shift_name_en : correction.group.employee.shift_id || "—")
        : correction.group.employee.shift_name_ar || correction.group.employee.shift_name_en || correction.group.employee.shift_id || "—"}</strong></div><small>{auditTranslate("أدخل وقت الرياض فقط. يمكن إدخال استراحة واحدة كحد أقصى.", "Riyadh time only. One break pair is allowed per day.")}</small></div>
      {error && <div className="hr-alert error" role="alert"><AlertTriangle size={16} />{error}</div>}
      {correction.duplicateActions.length > 0 && <div className="hr-correction-blocking" role="alert"><AlertTriangle size={18} /><div><strong>{auditTranslate("لا يمكن تصحيح هذه الوردية من هذه الشاشة.", "This shift cannot be corrected here.")}</strong><p>{auditTranslate("تحتوي السجلات التاريخية على حركات مكررة. تم الاحتفاظ بكل الحركات، ويجب مراجعة السجل كاملًا قبل أي تصحيح.", "Historical records contain duplicate actions. Every event is preserved; review the complete audit history before making a correction.")}</p><ul>{correction.group.events.map((entry) => <li key={entry.id}><span>{actionLabels[entry.action]}</span><time>{auditTime(entry.occurred_at, correction.group.shift_date)}</time></li>)}</ul></div></div>}
      <div className="hr-correction-fields">
        {[correction.checkIn, correction.checkOut, correction.breakStart, correction.breakEnd].map((entry, fieldIndex) => {
          const labels = [
            auditTranslate("حضور", "Check-in"),
            auditTranslate("انصراف", "Check-out"),
            auditTranslate("استراحة", "Break start"),
            auditTranslate("انتهاء استراحة", "Break end"),
          ];
          const required = entry.action === "check_in" || entry.action === "check_out";
          return <label className={`hr-correction-time-field field-${fieldIndex + 1}`} key={entry.action} htmlFor={`correction-${entry.action}`}>
            <span>{labels[fieldIndex]}{required ? <b aria-hidden="true"> *</b> : null}</span>
            <select id={`correction-${entry.action}`} required={required} value={entry.occurred_at} aria-label={labels[fieldIndex]} aria-invalid={(entry.action === "break_start" && Boolean(entry.occurred_at) !== Boolean(correction.breakEnd.occurred_at)) || (entry.action === "break_end" && Boolean(entry.occurred_at) !== Boolean(correction.breakStart.occurred_at))} disabled={correction.duplicateActions.length > 0 || busy === "correction"} onChange={(event) => updateCorrectionEvent(entry.action, event.target.value)}>
              <option value="">{auditTranslate("بدون وقت", "No time")}</option>
              {correctionTimeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </label>;
        })}
      </div>
      {Boolean(correction.breakStart.occurred_at) !== Boolean(correction.breakEnd.occurred_at) && <p className="hr-correction-pair-error" role="alert">{auditTranslate("يجب إدخال وقتي بدء الاستراحة وانتهائها معًا، أو تركهما فارغين.", "Enter both break times, or leave both blank.")}</p>}
      <footer><button className="hr-primary" disabled={busy === "correction" || correction.duplicateActions.length > 0 || !correction.checkIn.occurred_at || !correction.checkOut.occurred_at || (Boolean(correction.breakStart.occurred_at) !== Boolean(correction.breakEnd.occurred_at))}>{busy === "correction" ? translate("جارٍ الحفظ…") : translate("حفظ التصحيح")}</button><button type="button" disabled={busy === "correction"} onClick={() => setCorrection(null)}>{translate("إلغاء")}</button></footer></form></div>}
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
