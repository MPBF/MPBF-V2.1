import i18n, { intlLocale, translate, translateError } from "../i18n";
import { AlertCircle, ArrowDownLeft, ArrowUpLeft, CalendarDays, Check, Clock3, Coffee, FilePlus2, Fingerprint, LogIn, LogOut, MapPin, MessageCircle, Navigation, Play, Send, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { NetworkRequestError, resilientFetch } from "../lib/resilient-fetch";
import "./user-dashboard.css";
import PageHero from "../components/PageHero";

type AttendanceAction = "check_in" | "break_start" | "break_end" | "check_out";
type AttendanceEvent = { id: number; action: AttendanceAction; occurred_at: string; latitude: number; longitude: number; accuracy: number | null };
type Recipient = { id: number; display_name: string | null; display_name_ar: string | null };
type Message = { id: number; sender_id: number; recipient_id: number; sender_name: string; recipient_name: string; body: string; reply_to_id: number | null; created_at: string; read_at: string | null };
type RequestRecord = { id: number; type: "leave" | "permission" | "other"; title: string; details: string; status: "pending" | "approved" | "rejected"; response: string | null; created_at: string };
type Violation = { id: number; title: string; details: string; created_at: string; acknowledged_at: string | null };
type DashboardUser = { id?: number; display_name_ar?: string | null; display_name?: string | null; username?: string | null };
type ActiveShift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  geofenceStatus: "enabled" | "disabled" | "invalid";
  radiusMeters: number | null;
};
type AttendanceData = { events: AttendanceEvent[]; status: "out" | "working" | "break"; month: string; daysPresent: number; currentSession?: { id: number; shiftDate: string; incomplete: boolean } | null; unresolvedIncompleteSession?: { id: number; shiftDate: string } | null; activeShift: ActiveShift | null; withinShiftWindow: boolean; serverNow: string; workedSeconds: number; sessionStartedAt: string | null; actionTimes: Partial<Record<AttendanceAction, string>> };

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await resilientFetch(`/api/self${path}`, {
      credentials: "include",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (cause) {
    if (!(cause instanceof NetworkRequestError)) throw cause;
    const read = ["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase());
    throw new ApiError(translate(read
      ? "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد تحميل البيانات."
      : "تعذر تأكيد تنفيذ العملية بسبب انقطاع الاتصال. حدّث البيانات قبل تكرارها."), 0, "NETWORK_ERROR");
  }
  const body = await response.json().catch(() => ({})) as { message?: string; code?: string };
  if (!response.ok) throw new ApiError(translateError(body.message || "تعذر تنفيذ الطلب"), response.status, body.code);
  return body as T;
};

const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });
const dateTime = (value: string) => new Intl.DateTimeFormat(intlLocale(), {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
}).format(new Date(value));
const monthName = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric", timeZone: "Asia/Riyadh" })
    .format(new Date(Date.UTC(year, month - 1, 15, 9)));
};
const actionNames: Record<AttendanceAction, string> = {
  check_in: "حضور", break_start: "استراحة", break_end: "استكمال", check_out: "خروج",
};
const allAttendanceActions: AttendanceAction[] = ["check_in", "break_start", "break_end", "check_out"];
const requestNames: Record<RequestRecord["type"], string> = { leave: "إجازة", permission: "استئذان", other: "أخرى" };
const requestStatus: Record<RequestRecord["status"], string> = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
const attendanceIcons = { check_in: LogIn, break_start: Coffee, break_end: Play, check_out: LogOut } as const;
const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
};
const actionTime = (value?: string) => value ? new Intl.DateTimeFormat(intlLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(value)) : "—";

function locate(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(translate("المتصفح لا يدعم تحديد الموقع. لا يمكن تسجيل الحضور من هذا الجهاز.")));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED
        ? translate("يجب السماح بالوصول إلى الموقع لتسجيل هذا الإجراء.")
        : error.code === error.TIMEOUT
          ? translate("تعذر تحديد الموقع في الوقت المحدد. حاول مرة أخرى في مكان مفتوح.")
          : translate("تعذر تحديد الموقع. تحقق من إعدادات الموقع ثم أعد المحاولة."))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export default function UserDashboard({ user }: { user: DashboardUser }) {
  const [attendance, setAttendance] = useState<AttendanceData | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [errorTitle, setErrorTitle] = useState("");
  const [notice, setNotice] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [requestForm, setRequestForm] = useState({ type: "leave" as RequestRecord["type"], title: "", details: "" });
  const [timerTick, setTimerTick] = useState(Date.now());
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (quiet = false) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (!quiet) setLoading(true);
    setError(""); setErrorTitle("");
    const results = await Promise.allSettled([
      api<AttendanceData>("/attendance", { signal: controller.signal }),
      api<Recipient[]>("/recipients", { signal: controller.signal }),
      api<Message[]>("/messages", { signal: controller.signal }),
      api<RequestRecord[]>("/requests", { signal: controller.signal }),
      api<Violation[]>("/violations", { signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    loadController.current = null;
    const failures: string[] = [];
    let networkFailure = false;
    const apply = <T,>(result: PromiseSettledResult<T>, setValue: (value: T) => void, section: string) => {
      if (result.status === "fulfilled") setValue(result.value);
      else {
        networkFailure ||= result.reason instanceof ApiError &&
          (result.reason.code === "NETWORK_ERROR" || [502, 503, 504].includes(result.reason.status));
        failures.push(`${translate(section)}: ${(result.reason as Error)?.message || translate("تعذر تحميل البيانات")}`);
      }
    };
    apply(results[0], setAttendance, "الحضور");
    apply(results[1], setRecipients, "قائمة المستلمين");
    apply(results[2], setMessages, "الرسائل");
    apply(results[3], setRequests, "الطلبات");
    apply(results[4], setViolations, "المخالفات");
    if (failures.length) setError(results.every(result =>
      result.status === "rejected" && result.reason instanceof ApiError && result.reason.code === "NETWORK_ERROR")
      ? translate("تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد تحميل البيانات.")
      : failures.join(" · "));
    setNeedsReconnect(networkFailure);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return () => { loadController.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!needsReconnect) return;
    const recover = () => {
      if (document.visibilityState !== "hidden" && !loadController.current) void load();
    };
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [load, needsReconnect]);
  useEffect(() => {
    if (attendance?.status !== "working") return;
    const timer = window.setInterval(() => setTimerTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [attendance?.status]);

  const attendanceActions = useMemo(() => {
    if (attendance?.status === "working") return ["break_start", "check_out"] as AttendanceAction[];
    if (attendance?.status === "break") return ["break_end"] as AttendanceAction[];
    return ["check_in"] as AttendanceAction[];
  }, [attendance?.status]);

  const registerAttendance = async (action: AttendanceAction) => {
    setBusy(action); setError(""); setErrorTitle(""); setNotice("");
    try {
      const location = await locate();
      await post("/attendance", { action, ...location });
      setNotice(translate("تم {{action}} بنجاح بعد التحقق من الموقع.", { action: translate(actionNames[action]) }));
      await load(true);
    } catch (cause) {
      const apiError = cause as ApiError;
      setError(apiError.message);
      if (apiError.code === "OUTSIDE_GEOFENCE") setErrorTitle(translate("تعذر تسجيل الحضور من هذا الموقع"));
      else if (apiError.code === "OUTSIDE_SHIFT_WINDOW") setErrorTitle(translate("العملية خارج وقت الوردية"));
      else if (apiError.code === "NO_SHIFT_ASSIGNMENT") setErrorTitle(translate("لا توجد وردية مكلّف بها"));
      else if (apiError.code === "INVALID_GEOFENCE") setErrorTitle(translate("إعداد موقع الوردية غير مكتمل"));
    } finally {
      setBusy("");
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!recipientId || !messageBody.trim()) return;
    setBusy("message"); setError(""); setErrorTitle(""); setNotice("");
    try {
      await post("/messages", { recipient_id: Number(recipientId), body: messageBody.trim(), ...(replyTo ? { reply_to_id: replyTo } : {}) });
      setMessageBody(""); setReplyTo(null);
      setNotice(translate("تم إرسال الرسالة."));
      await load(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const markRead = async (message: Message) => {
    setBusy(`read-${message.id}`); setError(""); setErrorTitle("");
    try { await post(`/messages/${message.id}/read`, {}); await load(true); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("request"); setError(""); setErrorTitle(""); setNotice("");
    try {
      await post("/requests", requestForm);
      setRequestForm({ type: "leave", title: "", details: "" });
      setNotice(translate("تم إرسال الطلب إلى الإدارة."));
      await load(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const acknowledge = async (violation: Violation) => {
    setBusy(`violation-${violation.id}`); setError(""); setErrorTitle(""); setNotice("");
    try {
      await post(`/violations/${violation.id}/ack`, {});
      setNotice(translate("تم تأكيد الاطلاع على المخالفة."));
      await load(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const displayName = (i18n.language === "en" ? user.display_name || user.display_name_ar : user.display_name_ar || user.display_name) || user.username || translate("زميل");
  const statusLabel = translate(attendance?.status === "working" ? "على رأس العمل" : attendance?.status === "break" ? "في الاستراحة" : "خارج العمل");
  const liveWorkedSeconds = attendance ? attendance.workedSeconds + (attendance.status === "working" ? Math.max(0, Math.floor((timerTick - new Date(attendance.serverNow).getTime()) / 1000)) : 0) : 0;

  return (
    <div className="self-page" dir={document.documentElement.dir}>
      <PageHero kicker={translate("مساحة الموظف · {{name}}", { name: displayName })} title={translate("لوحة المستخدم")} description="تابع يومك وسجلاتك وتواصل مع فريقك من مكان واحد." onRefresh={() => void load()} refreshing={loading || !!busy} />

      {error && <div className="self-alert self-alert-error" role="alert"><AlertCircle size={18} /><div className="self-alert-copy">{errorTitle ? <strong>{errorTitle}</strong> : null}<span>{error}</span>{needsReconnect && <button type="button" className="btn btn-muted" disabled={loading || !!busy} onClick={() => void load()}>{translate("إعادة المحاولة")}</button>}</div></div>}
      {notice && <div className="self-alert self-alert-success" role="status"><Check size={18} /><span>{notice}</span></div>}

      <div className="self-summary" aria-label={translate("إحصاءاتك الشخصية")}>
        <div className="self-summary-item"><span>{translate("أيام الحضور هذا الشهر")}</span><strong>{attendance?.daysPresent ?? "—"}</strong></div>
        <div className="self-summary-item"><span>{translate("الرسائل غير المقروءة")}</span><strong>{messages.filter((message) => message.recipient_id === user.id && !message.read_at).length}</strong></div>
        <div className="self-summary-item"><span>{translate("طلبات قيد المراجعة")}</span><strong>{requests.filter((request) => request.status === "pending").length}</strong></div>
        <div className="self-summary-item"><span>{translate("مخالفات بانتظار الاطلاع")}</span><strong>{violations.filter((violation) => !violation.acknowledged_at).length}</strong></div>
      </div>

      <section className="self-attendance self-panel" aria-labelledby="self-attendance-title">
        <div className="self-attendance-main">
          <div className="self-section-kicker"><Fingerprint size={15} />{" "}{translate("نظام البصمة")}</div>
          <div className="self-attendance-status-line"><h3 id="self-attendance-title">{loading && !attendance ? translate("جارٍ تحميل الحالة…") : statusLabel}</h3><span className={`self-current-status is-${attendance?.status || "out"}`}>{statusLabel}</span></div>
          <p>{translate("الموقع إلزامي لكل تسجيل. سيُطلب إذن الموقع عند تنفيذ كل إجراء.")}</p>
          {attendance?.currentSession?.shiftDate && <p>{translate("تاريخ احتساب الوردية:")}{" "}<strong>{attendance.currentSession.shiftDate}</strong>{translate("، حتى لو كان الانصراف بعد منتصف الليل.")}</p>}
          {attendance?.unresolvedIncompleteSession && <div className="self-window-warning" role="alert"><AlertCircle size={16} />{" "}{translate("وردية")}{" "}{attendance.unresolvedIncompleteSession.shiftDate}{" "}{translate("بلا انصراف. لا تُحتسب ساعاتها أو أجرها حتى تُصححها إدارة الموارد البشرية، ويمكنك بدء ورديتك الجديدة.")}</div>}
          <div className={`self-shift-context is-${attendance?.activeShift?.geofenceStatus || "none"}`}>
            <span className="self-shift-icon"><Navigation size={18} /></span>
            <div className="self-shift-copy">
              <span className="self-shift-label">{translate("وردية اليوم")}</span>
              {loading && !attendance ? <strong>{translate("جارٍ تحديد الوردية…")}</strong> : attendance?.activeShift ? (
                <>
                  <div className="self-shift-title"><strong>{attendance.activeShift.name}</strong><span>{attendance.activeShift.startTime}–{attendance.activeShift.endTime}</span></div>
                  <div className="self-shift-geofence">
                    <span className="self-shift-badge">
                      {attendance.activeShift.geofenceStatus === "enabled" ? translate("نطاق الموقع مفعّل") : attendance.activeShift.geofenceStatus === "disabled" ? translate("دون تقييد جغرافي") : translate("إعداد النطاق غير مكتمل")}
                    </span>
                    <small>
                      {attendance.activeShift.geofenceStatus === "enabled"
                        ? `يجب أن تكون داخل ${attendance.activeShift.radiusMeters} متر لإتمام التسجيل.`
                        : attendance.activeShift.geofenceStatus === "disabled"
                          ? translate("لا يوجد تقييد جغرافي لهذه الوردية.")
                          : translate("يرجى التواصل مع الإدارة.")}
                    </small>
                  </div>
                </>
              ) : <strong>{translate("لم يتم تعيين وردية لك")}</strong>}
            </div>
          </div>
          <div className={`self-live-timer is-${attendance?.status || "out"}`}><div><span>{translate("وقت العمل الفعلي")}</span><strong dir="ltr">{formatDuration(liveWorkedSeconds)}</strong></div><small>{attendance?.status === "working" ? translate("العداد يعمل الآن") : attendance?.status === "break" ? translate("العداد متوقف مؤقتًا أثناء الاستراحة") : attendance?.sessionStartedAt ? translate("انتهت جلسة العمل") : translate("يبدأ عند تسجيل الحضور")}</small></div>
          {attendance?.activeShift && !attendance.withinShiftWindow && <div className="self-window-warning"><Clock3 size={15} />{" "}{translate("أنت خارج النطاق الزمني المسموح للوردية، جميع عمليات البصمة متوقفة.")}</div>}
          <div className="self-attendance-actions">
            {allAttendanceActions.map((action) => { const Icon = attendanceIcons[action]; return <div className={`self-attendance-action action-${action}`} key={action}><button
              className={`self-attendance-btn action-${action}`}
              type="button"
              onClick={() => void registerAttendance(action)}
              disabled={loading || !!busy || !attendance || !attendance.withinShiftWindow || !attendanceActions.includes(action)}
            >
              {busy === action ? <span className="self-spinner" /> : <Icon size={19} />}
              {busy === action ? translate("جارٍ التحقق…") : translate(actionNames[action])}
            </button><time>{actionTime(attendance?.actionTimes[action])}</time></div>; })}
          </div>
        </div>
        <div className="self-attendance-stat">
          <span className="self-stat-icon"><CalendarDays size={19} /></span>
          <div><span>{translate("أيام الحضور")}</span><strong>{loading && !attendance ? "—" : attendance?.daysPresent ?? "—"}</strong><small>{attendance?.month ? monthName(attendance.month) : translate("الشهر الحالي")}</small></div>
        </div>
      </section>

      <section className="self-panel">
        <div className="self-panel-heading"><div><span className="self-section-kicker"><Clock3 size={15} />{" "}{translate("سجل الشهر")}</span><h3>{translate("أحداث الحضور")}</h3></div><span className="self-muted">{attendance?.month ? monthName(attendance.month) : translate("الشهر الحالي")}</span></div>
        {loading && !attendance ? <div className="self-empty">{translate("جارٍ تحميل سجل الحضور…")}</div> : !attendance?.events.length ? <div className="self-empty">{translate("لا توجد أحداث حضور مسجلة لهذا الشهر.")}</div> : (
          <div className="self-event-list">
            {attendance.events.map((event) => <article className="self-event" key={event.id}>
              <span className={`self-event-dot ${event.action === "check_out" ? "is-soft" : ""}`} />
              <div className="self-event-copy"><strong>{translate(actionNames[event.action])}</strong><small><MapPin size={12} />{" "}{translate("تم حفظ الموقع")}</small></div>
              <time dateTime={event.occurred_at}>{dateTime(event.occurred_at)}</time>
            </article>)}
          </div>
        )}
      </section>

      <div className="self-columns">
        <section className="self-panel">
          <div className="self-panel-heading"><div><span className="self-section-kicker"><MessageCircle size={15} />{" "}{translate("تواصل الفريق")}</span><h3>{translate("الرسائل الداخلية")}</h3></div><span className="self-count">{messages.length}</span></div>
          <form className="self-form" onSubmit={sendMessage}>
            <div className="self-field">
              <label htmlFor="self-recipient">{translate("إلى")}</label>
              <select id="self-recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} required>
                <option value="">{translate("اختر مستلمًا")}</option>
                {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{(i18n.language === "en" ? recipient.display_name || recipient.display_name_ar : recipient.display_name_ar || recipient.display_name) || `${translate("مستخدم")} ${recipient.id}`}</option>)}
              </select>
            </div>
            {replyTo && <div className="self-replying">{translate("الرد على رسالة #")}{replyTo}<button type="button" onClick={() => setReplyTo(null)}>{translate("إلغاء")}</button></div>}
            <label className="self-field" htmlFor="self-message"><span>{translate("الرسالة")}</span><textarea id="self-message" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} rows={3} maxLength={5000} placeholder={translate("اكتب رسالتك هنا…")} required /></label>
            <button className="self-submit" type="submit" disabled={busy === "message" || !recipientId || !messageBody.trim()}><Send size={16} />{busy === "message" ? translate("جارٍ الإرسال…") : translate("إرسال الرسالة")}</button>
          </form>
          <div className="self-list">
            {loading && !messages.length ? <div className="self-empty">{translate("جارٍ تحميل الرسائل…")}</div> : !messages.length ? <div className="self-empty">{translate("لا توجد رسائل بعد.")}</div> : messages.map((message) => (
              <article className={`self-message ${!message.read_at && message.recipient_id === user.id ? "is-unread" : ""}`} key={message.id}>
                <div className="self-message-top"><strong>{message.sender_id === user.id ? <><ArrowUpLeft size={13} />{" "}{translate("إلى")}{" "}{message.recipient_name}</> : <><ArrowDownLeft size={13} />{" "}{translate("من")}{" "}{message.sender_name}</>}</strong><time dateTime={message.created_at}>{dateTime(message.created_at)}</time></div>
                {message.reply_to_id && <small className="self-reply-reference">{translate("رد على رسالة سابقة")}</small>}
                <p>{message.body}</p>
                <div className="self-message-actions">
                  <button type="button" onClick={() => { setReplyTo(message.id); if (message.sender_id !== user.id) setRecipientId(String(message.sender_id)); else setRecipientId(String(message.recipient_id)); }}><MessageCircle size={13} />{" "}{translate("رد")}</button>
                  {message.recipient_id === user.id && !message.read_at && <button type="button" disabled={busy === `read-${message.id}`} onClick={() => void markRead(message)}><Check size={13} /> {busy === `read-${message.id}` ? translate("جارٍ الحفظ…") : translate("تحديد كمقروءة")}</button>}
                  {message.read_at && message.sender_id === user.id && <small>{translate("قُرئت")}{" "}{dateTime(message.read_at)}</small>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="self-panel">
          <div className="self-panel-heading"><div><span className="self-section-kicker"><FilePlus2 size={15} />{" "}{translate("خدمات الموظفين")}</span><h3>{translate("طلب إداري")}</h3></div></div>
          <form className="self-form" onSubmit={submitRequest}>
            <div className="self-form-grid">
              <div className="self-field"><label htmlFor="self-request-type">{translate("نوع الطلب")}</label><select id="self-request-type" value={requestForm.type} onChange={(event) => setRequestForm({ ...requestForm, type: event.target.value as RequestRecord["type"] })}><option value="leave">{translate("إجازة")}</option><option value="permission">{translate("استئذان")}</option><option value="other">{translate("أخرى")}</option></select></div>
              <div className="self-field"><label htmlFor="self-request-title">{translate("العنوان")}</label><input id="self-request-title" value={requestForm.title} maxLength={200} onChange={(event) => setRequestForm({ ...requestForm, title: event.target.value })} required /></div>
            </div>
            <label className="self-field" htmlFor="self-request-details"><span>{translate("التفاصيل")}</span><textarea id="self-request-details" value={requestForm.details} onChange={(event) => setRequestForm({ ...requestForm, details: event.target.value })} rows={3} maxLength={5000} required /></label>
            <button className="self-submit" type="submit" disabled={busy === "request"}><Send size={16} />{busy === "request" ? translate("جارٍ الإرسال…") : translate("إرسال الطلب")}</button>
          </form>
          <div className="self-list">
            {!requests.length ? <div className="self-empty">{translate("لم ترسل أي طلبات حتى الآن.")}</div> : requests.map((request) => <article className="self-request" key={request.id}>
              <div className="self-request-top"><span className={`self-status status-${request.status}`}>{translate(requestStatus[request.status] || "قيد المراجعة")}</span><small>{translate(requestNames[request.type])} · {dateTime(request.created_at)}</small></div>
              <h4>{request.title}</h4><p>{request.details}</p>
              {request.response && <div className="self-response"><strong>{translate("رد الإدارة")}</strong><p>{request.response}</p></div>}
            </article>)}
          </div>
        </section>
      </div>

      <section className="self-panel">
        <div className="self-panel-heading"><div><span className="self-section-kicker"><ShieldAlert size={15} />{" "}{translate("المتابعة الإدارية")}</span><h3>{translate("المخالفات")}</h3></div><span className="self-count">{violations.length}</span></div>
        {!violations.length ? <div className="self-empty">{translate("لا توجد مخالفات مسجلة.")}</div> : <div className="self-violation-list">
          {violations.map((violation) => <article className="self-violation" key={violation.id}>
            <div className="self-violation-mark"><ShieldAlert size={19} /></div>
            <div className="self-violation-content"><div className="self-violation-top"><strong>{violation.title}</strong><time dateTime={violation.created_at}>{dateTime(violation.created_at)}</time></div><p>{violation.details}</p></div>
            {violation.acknowledged_at
              ? <span className="self-acknowledged"><Check size={14} />{" "}{translate("تم الاطلاع")}{" "}{dateTime(violation.acknowledged_at)}</span>
              : <button className="self-ack-btn" type="button" disabled={busy === `violation-${violation.id}`} onClick={() => void acknowledge(violation)}>{busy === `violation-${violation.id}` ? translate("جارٍ الحفظ…") : translate("تأكيد الاطلاع")}</button>}
          </article>)}
        </div>}
      </section>
    </div>
  );
}
