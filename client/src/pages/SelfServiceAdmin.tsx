import { intlLocale, translate, translateError } from "../i18n";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, ClipboardList, RefreshCw, ShieldAlert, UserRound } from "lucide-react";
import "./user-dashboard.css";

type RequestRecord = {
  id: number; user_id: number; user_name: string; type: "leave" | "permission" | "other"; title: string;
  details: string; status: "pending" | "approved" | "rejected"; response: string | null; created_at: string;
};
type Violation = { id: number; user_id: number; user_name: string; title: string; details: string; created_at: string; acknowledged_at: string | null };
type UserOption = { id: number; username: string; display_name: string | null; display_name_ar: string | null; status: string };

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر تنفيذ الطلب"));
  return body as T;
};
const dateTime = (value: string) => new Intl.DateTimeFormat(intlLocale(), {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh",
}).format(new Date(value));
const requestTypeNames: Record<RequestRecord["type"], string> = { leave: "إجازة", permission: "استئذان", other: "أخرى" };

export default function SelfServiceAdmin({ mode, refreshToken = 0 }: { mode: "requests" | "violations"; refreshToken?: number }) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [drafts, setDrafts] = useState<Record<number, { status: "approved" | "rejected"; response: string }>>({});
  const [form, setForm] = useState({ user_id: "", title: "", details: "" });
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (mode === "requests") setRequests(await api<RequestRecord[]>("/self/admin/requests"));
      else {
        const [records, directory] = await Promise.all([
          api<Violation[]>("/self/admin/violations"),
          api<UserOption[]>("/users?limit=200"),
        ]);
        setViolations(records);
        setUsers(directory.filter((user) => user.status === "active"));
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }, [mode]);
  useEffect(() => { void load(); }, [load, refreshToken]);

  const decide = async (request: RequestRecord) => {
    const draft = drafts[request.id] || { status: "approved" as const, response: request.response || "" };
    setBusy(`request-${request.id}`); setError(""); setNotice("");
    try {
      await api(`/self/admin/requests/${request.id}`, { method: "PATCH", body: JSON.stringify(draft) });
      setNotice(translate("تم تحديث حالة الطلب."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const createViolation = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("create"); setError(""); setNotice("");
    try {
      await api("/self/admin/violations", { method: "POST", body: JSON.stringify({ ...form, user_id: Number(form.user_id) }) });
      setForm({ user_id: "", title: "", details: "" });
      setNotice(translate("تم تسجيل المخالفة."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <div className="self-page self-admin-page" dir={document.documentElement.dir}>
      <div className="self-welcome">
        <div>
          <div className="self-eyebrow">{translate("الموارد البشرية · إدارة الموظفين")}</div>
          <h2>{mode === "requests" ? translate("الطلبات الإدارية") : translate("سجل المخالفات")}</h2>
          <p>{mode === "requests" ? translate("راجع طلبات الفريق وأرسل قرارًا موثقًا.") : translate("سجّل الملاحظات الإدارية واربطها بملف الموظف.")}</p>
        </div>
        <button className="self-refresh" type="button" onClick={() => void load()} disabled={loading || !!busy}><RefreshCw size={16} />{" "}{translate("تحديث")}</button>
      </div>
      {error && <div className="self-alert self-alert-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {notice && <div className="self-alert self-alert-success" role="status"><Check size={18} /><span>{notice}</span></div>}

      {mode === "requests" ? (
        <section className="self-panel">
          <div className="self-panel-heading"><div><span className="self-section-kicker"><ClipboardList size={15} />{" "}{translate("صندوق المتابعة")}</span><h3>{translate("طلبات الموظفين")}</h3></div><span className="self-count">{requests.length}</span></div>
          {loading ? <div className="self-empty">{translate("جارٍ تحميل الطلبات…")}</div> : !requests.length ? <div className="self-empty">{translate("لا توجد طلبات بانتظار العرض.")}</div> : <div className="self-admin-list">
            {requests.map((request) => {
              const draft = drafts[request.id] || { status: request.status === "rejected" ? "rejected" as const : "approved" as const, response: request.response || "" };
              return <article className="self-admin-record" key={request.id}>
                <div className="self-admin-record-head"><div className="self-person"><span className="self-person-icon"><UserRound size={16} /></span><div><strong>{request.user_name || `${translate("موظف")} ${request.user_id}`}</strong><small>{translate(requestTypeNames[request.type])} · {dateTime(request.created_at)}</small></div></div><span className={`self-status status-${request.status}`}>{request.status === "pending" ? translate("قيد المراجعة") : request.status === "approved" ? translate("مقبول") : translate("مرفوض")}</span></div>
                <h4>{request.title}</h4><p className="self-admin-details">{request.details}</p>
                <div className="self-admin-decision">
                  <label className="self-field"><span>{translate("القرار")}</span><select value={draft.status} onChange={(event) => setDrafts({ ...drafts, [request.id]: { ...draft, status: event.target.value as "approved" | "rejected" } })}><option value="approved">{translate("مقبول")}</option><option value="rejected">{translate("مرفوض")}</option></select></label>
                  <label className="self-field"><span>{translate("رد الإدارة")}</span><textarea rows={2} maxLength={3000} value={draft.response} onChange={(event) => setDrafts({ ...drafts, [request.id]: { ...draft, response: event.target.value } })} placeholder={translate("أضف توضيحًا للموظف…")} /></label>
                  <button className="self-submit" type="button" disabled={busy === `request-${request.id}`} onClick={() => void decide(request)}><Check size={16} />{busy === `request-${request.id}` ? translate("جارٍ الحفظ…") : translate("حفظ القرار")}</button>
                </div>
              </article>;
            })}
          </div>}
        </section>
      ) : <>
        <section className="self-panel">
          <div className="self-panel-heading"><div><span className="self-section-kicker"><ShieldAlert size={15} />{" "}{translate("توثيق ملاحظة")}</span><h3>{translate("تسجيل مخالفة جديدة")}</h3></div></div>
          <form className="self-form self-admin-form" onSubmit={createViolation}>
            <div className="self-form-grid">
              <label className="self-field"><span>{translate("الموظف")}</span><select value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })} required><option value="">{translate("اختر الموظف")}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.display_name_ar || user.display_name || user.username}</option>)}</select></label>
              <label className="self-field"><span>{translate("عنوان المخالفة")}</span><input value={form.title} maxLength={200} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
            </div>
            <label className="self-field"><span>{translate("التفاصيل")}</span><textarea rows={3} maxLength={5000} value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} required /></label>
            <button className="self-submit" type="submit" disabled={busy === "create" || !users.length}><ShieldAlert size={16} />{busy === "create" ? translate("جارٍ التسجيل…") : translate("تسجيل المخالفة")}</button>
            {!loading && !users.length && <p className="self-form-note">{translate("لا تتوفر قائمة مستخدمين نشطين للتسجيل. تحقق من صلاحية الوصول إلى دليل المستخدمين.")}</p>}
          </form>
        </section>
        <section className="self-panel">
          <div className="self-panel-heading"><div><span className="self-section-kicker"><ShieldAlert size={15} />{" "}{translate("السجل")}</span><h3>{translate("المخالفات المسجلة")}</h3></div><span className="self-count">{violations.length}</span></div>
          {loading ? <div className="self-empty">{translate("جارٍ تحميل المخالفات…")}</div> : !violations.length ? <div className="self-empty">{translate("لا توجد مخالفات مسجلة.")}</div> : <div className="self-admin-list">
            {violations.map((violation) => <article className="self-admin-record self-violation-admin" key={violation.id}>
              <div className="self-admin-record-head"><div className="self-person"><span className="self-person-icon"><UserRound size={16} /></span><div><strong>{violation.user_name || `موظف ${violation.user_id}`}</strong><small>{dateTime(violation.created_at)}</small></div></div></div>
              <h4>{violation.title}</h4><p className="self-admin-details">{violation.details}</p>
              <small>{violation.acknowledged_at ? `أكد الموظف اطلاعه ${dateTime(violation.acknowledged_at)}` : translate("بانتظار تأكيد الاطلاع")}</small>
            </article>)}
          </div>}
        </section>
      </>}
    </div>
  );
}