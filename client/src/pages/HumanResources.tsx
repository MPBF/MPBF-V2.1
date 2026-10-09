import i18n, { intlLocale, translate, translateError } from "../i18n";
import { Check, ClipboardList, Clock3, Edit3, FileSpreadsheet, LocateFixed, MapPin, Plus, Search, ShieldAlert, Trash2, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import HumanResourcesOperations from "./HumanResourcesOperations";
import SelfServiceAdmin from "./SelfServiceAdmin";
import PageHero from "../components/PageHero";
import "./human-resources.css";

type Shift = {
  id: string; name_ar: string; name_en: string | null; start_time: string; end_time: string;
  next_day_checkin_time: string;
  early_checkin_minutes: number; late_checkout_minutes: number; break_minutes: number;
  geofence_enabled: boolean; geofence_center_lat: number | null; geofence_center_lng: number | null;
  geofence_radius_meters: number; is_active: boolean; assigned_users: number;
  created_at?: string; updated_at?: string;
};
type Employee = {
  id: number; username: string | null; display_name: string | null; display_name_ar: string | null;
  section_id: string | null; section_name?: string | null; assignment_id: number | null; shift_id: string | null; assigned_at: string | null;
};
type History = { id: number; user_id: number; shift_id: string; assigned_at: string; unassigned_at: string | null; assigned_by: number | null };
type HrData = { shifts: Shift[]; users: Employee[]; history: History[] };

const emptyShift: Shift = {
  id: "", name_ar: "", name_en: "", start_time: "08:00", end_time: "16:00",
  next_day_checkin_time: "06:00",
  early_checkin_minutes: 15, late_checkout_minutes: 15, break_minutes: 30,
  geofence_enabled: true, geofence_center_lat: null, geofence_center_lng: null,
  geofence_radius_meters: 200, is_active: true, assigned_users: 0,
};

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api/hr${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر تنفيذ الطلب"));
  return body as T;
};

const employeeName = (employee: Employee) => (i18n.language === "en" ? employee.display_name || employee.display_name_ar : employee.display_name_ar || employee.display_name) || employee.username || `${translate("مستخدم")} ${employee.id}`;
const timeStamp = (value: string | null) => value ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(value)) : translate("مستمرة");

export default function HumanResources({ canReviewRequests }: { canReviewRequests: boolean }) {
  const [data, setData] = useState<HrData>({ shifts: [], users: [], history: [] });
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkShift, setBulkShift] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Shift | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"shifts" | "audit" | "report" | "violations" | "requests">("shifts");
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api<HrData>("/data")); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.users;
    return data.users.filter((employee) => `${employeeName(employee)} ${employee.username || ""} ${employee.section_id || ""}`.toLowerCase().includes(term));
  }, [data.users, search]);
  const shiftById = useMemo(() => new Map(data.shifts.map((shift) => [shift.id, shift])), [data.shifts]);

  const saveShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (draft.start_time === draft.end_time) { setError(translate("وقت بداية الوردية ونهايتها لا يمكن أن يتساويا.")); return; }
    if (draft.geofence_enabled && (draft.geofence_center_lat === null || draft.geofence_center_lng === null)) {
      setError(translate("حدد إحداثيات مركز النطاق الجغرافي قبل حفظ الوردية.")); return;
    }
    setBusy("shift"); setError(""); setNotice("");
    try {
      const { assigned_users: _assignedUsers, created_at: _createdAt, updated_at: _updatedAt, next_day_checkin_time: _legacyBoundary, ...editable } = draft;
      const payload = {
        ...editable,
        name_en: draft.name_en || null,
        geofence_center_lat: draft.geofence_center_lat === null ? null : Number(draft.geofence_center_lat),
        geofence_center_lng: draft.geofence_center_lng === null ? null : Number(draft.geofence_center_lng),
        geofence_radius_meters: Number(draft.geofence_radius_meters),
        early_checkin_minutes: Number(draft.early_checkin_minutes),
        late_checkout_minutes: Number(draft.late_checkout_minutes),
        break_minutes: Number(draft.break_minutes),
      };
      await api(editingId ? `/shifts/${encodeURIComponent(editingId)}` : "/shifts", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(editingId ? (({ id: _id, ...rest }) => rest)(payload) : payload),
      });
      setDraft(null); setEditingId(null); setNotice(translate(editingId ? "تم تحديث الوردية." : "تم إنشاء الوردية."));
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const removeShift = async (shift: Shift) => {
    if (!confirm(translate("حذف وردية {{name}}؟", { name: i18n.language === "en" ? shift.name_en || shift.name_ar : shift.name_ar }))) return;
    setBusy(`delete-${shift.id}`); setError(""); setNotice("");
    try { await api(`/shifts/${encodeURIComponent(shift.id)}`, { method: "DELETE" }); setNotice(translate("تم حذف الوردية.")); await load(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const assign = async (userIds: number[], shiftId: string | null) => {
    if (!userIds.length) return;
    setBusy("assign"); setError(""); setNotice("");
    try {
      const result = await api<{ changed: number }>("/assignments", { method: "POST", body: JSON.stringify({ user_ids: userIds, shift_id: shiftId }) });
      setNotice(`تم تحديث ورديات ${result.changed} مستخدم.`); setSelected([]); await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(""); }
  };

  const useCurrentLocation = () => {
    if (!draft || !navigator.geolocation) return setError(translate("المتصفح لا يدعم تحديد الموقع."));
    setBusy("location"); setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setDraft({ ...draft, geofence_center_lat: coords.latitude, geofence_center_lng: coords.longitude }); setBusy(""); },
      () => { setError(translate("تعذر تحديد الموقع. اسمح للموقع ثم أعد المحاولة.")); setBusy(""); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return <div className="hr-page" dir={document.documentElement.dir}>
    <PageHero kicker={translate("الموارد البشرية · التشغيل")} title={translate("الموارد البشرية")} description="إدارة الورديات والحضور والتقارير والمخالفات من مركز واحد." onRefresh={() => { void load(); setRefreshToken((token) => token + 1); }} refreshing={loading || !!busy} />
    <div className="hr-tabs" role="tablist">
      <button className={tab === "shifts" ? "active" : ""} role="tab" aria-selected={tab === "shifts"} onClick={() => setTab("shifts")}><Clock3 size={17} />{" "}{translate("إدارة الورديات")}</button>
      <button className={tab === "audit" ? "active" : ""} role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")}><ClipboardList size={17} />{" "}{translate("سجل التدقيق")}</button>
      <button className={tab === "report" ? "active" : ""} role="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}><FileSpreadsheet size={17} />{" "}{translate("كشف الحضور")}</button>
      <button className={tab === "violations" ? "active" : ""} role="tab" aria-selected={tab === "violations"} onClick={() => setTab("violations")}><ShieldAlert size={17} />{" "}{translate("مخالفات الموظفين")}</button>
      {canReviewRequests && <button className={tab === "requests" ? "active" : ""} role="tab" aria-selected={tab === "requests"} onClick={() => setTab("requests")}><ClipboardList size={17} />{" "}{translate("الطلبات الإدارية")}</button>}
    </div>
    {error && <div className="hr-alert error">{error}</div>}{notice && <div className="hr-alert success"><Check size={16} />{notice}</div>}

    {tab === "shifts" && <>
    <section className="hr-shift-section">
      <div className="hr-section-head"><div><span>{translate("تعريفات التشغيل")}</span><h3>{translate("الورديات الحالية")}</h3></div><button className="hr-primary" type="button" onClick={() => { setEditingId(null); setDraft({ ...emptyShift, id: `shift-${Date.now()}` }); }}><Plus size={17} />{" "}{translate("إضافة وردية")}</button></div>
      <div className="hr-shift-grid">{data.shifts.map((shift) => <article className={`hr-shift-card ${shift.is_active ? "" : "inactive"}`} key={shift.id}>
        <div className="hr-shift-top"><div className="hr-shift-clock"><Clock3 size={19} /></div><div><strong>{shift.name_ar}</strong><small>{shift.name_en || shift.id}</small></div><span>{shift.assigned_users}{" "}{translate("موظف")}</span></div>
        <div className="hr-shift-time"><b>{shift.start_time}</b><i /><b>{shift.end_time}</b></div>
         <div className="hr-shift-meta"><span><MapPin size={13} />{shift.geofence_enabled ? `${shift.geofence_radius_meters} متر` : translate("الموقع غير مفعّل")}</span><span>{translate("تُحتسب الوردية في يوم بدايتها")}</span><span>{translate("سماح ±")}{" "}{shift.early_checkin_minutes}/{shift.late_checkout_minutes}{" "}{translate("د")}</span></div>
        <footer><button type="button" onClick={() => { setEditingId(shift.id); setDraft({ ...shift }); }}><Edit3 size={15} />{" "}{translate("تعديل")}</button><button type="button" disabled={busy === `delete-${shift.id}`} onClick={() => void removeShift(shift)}><Trash2 size={15} />{" "}{translate("حذف")}</button></footer>
      </article>)}{!loading && !data.shifts.length && <div className="hr-empty">{translate("لا توجد ورديات. أنشئ الوردية الأولى للبدء.")}</div>}</div>
    </section>

    <section className="hr-assignment-section">
      <div className="hr-section-head"><div><span>{translate("توزيع الفريق")}</span><h3>{translate("تكليف المستخدمين")}</h3></div><div className="hr-search"><Search size={16} /><input placeholder={translate("بحث بالاسم أو المستخدم…")} value={search} onChange={(event) => setSearch(event.target.value)} /></div></div>
      <div className="hr-bulk"><div><UsersRound size={18} /><strong>{selected.length}</strong><span>{translate("محدد")}</span></div><select value={bulkShift} onChange={(event) => setBulkShift(event.target.value)}><option value="">{translate("اختر الوردية")}</option>{data.shifts.filter((shift) => shift.is_active).map((shift) => <option key={shift.id} value={shift.id}>{shift.name_ar}</option>)}</select><button type="button" disabled={!selected.length || !bulkShift || busy === "assign"} onClick={() => void assign(selected, bulkShift)}><UserRoundCheck size={16} />{" "}{translate("تكليف المحددين")}</button><button className="muted" type="button" disabled={!selected.length || busy === "assign"} onClick={() => void assign(selected, null)}><X size={16} />{" "}{translate("إلغاء التكليف")}</button></div>
      <div className="hr-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label={translate("تحديد الجميع")} checked={visibleUsers.length > 0 && visibleUsers.every((employee) => selected.includes(employee.id))} onChange={(event) => setSelected(event.target.checked ? Array.from(new Set([...selected, ...visibleUsers.map((employee) => employee.id)])) : selected.filter((id) => !visibleUsers.some((employee) => employee.id === id)))} /></th><th>{translate("المستخدم")}</th><th>{translate("القسم")}</th><th>{translate("الوردية الحالية")}</th><th>{translate("بداية التكليف")}</th><th>{translate("تغيير فردي")}</th></tr></thead><tbody>{visibleUsers.map((employee) => <tr key={employee.id}><td><input type="checkbox" checked={selected.includes(employee.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, employee.id] : selected.filter((id) => id !== employee.id))} /></td><td><strong>{employeeName(employee)}</strong><small>{employee.username || "—"}</small></td><td>{employee.section_id || "—"}</td><td><span className={`hr-shift-pill ${employee.shift_id ? "assigned" : "unassigned"}`}>{employee.shift_id ? shiftById.get(employee.shift_id)?.name_ar || employee.shift_id : translate("غير مكلف")}</span></td><td>{timeStamp(employee.assigned_at)}</td><td><select aria-label={`وردية ${employeeName(employee)}`} value={employee.shift_id || ""} disabled={busy === "assign"} onChange={(event) => void assign([employee.id], event.target.value || null)}><option value="">{translate("بدون وردية")}</option>{data.shifts.filter((shift) => shift.is_active).map((shift) => <option key={shift.id} value={shift.id}>{shift.name_ar}</option>)}</select></td></tr>)}</tbody></table></div>
    </section>

    <section className="hr-history"><div className="hr-section-head"><div><span>{translate("سجل التكليفات")}</span><h3>{translate("آخر تغييرات الورديات")}</h3></div></div><div className="hr-history-list">{data.history.slice(0, 20).map((entry) => { const employee = data.users.find((item) => item.id === entry.user_id); return <div key={entry.id}><span className={entry.unassigned_at ? "closed" : "open"} /><strong>{employee ? employeeName(employee) : `مستخدم ${entry.user_id}`}</strong><b>{shiftById.get(entry.shift_id)?.name_ar || entry.shift_id}</b><small>{timeStamp(entry.assigned_at)} ← {timeStamp(entry.unassigned_at)}</small></div>; })}</div></section>
    </>}

    {tab === "requests" && canReviewRequests && <SelfServiceAdmin mode="requests" refreshToken={refreshToken} />}
    {tab !== "shifts" && tab !== "requests" && <HumanResourcesOperations tab={tab} employees={data.users} refreshToken={refreshToken} />}

    {draft && <div className="hr-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDraft(null)}><form className="hr-modal" onSubmit={saveShift}><header><div><span>SHIFT DEFINITION</span><h3>{editingId ? translate("تعديل الوردية") : translate("إضافة وردية")}</h3></div><button type="button" onClick={() => setDraft(null)} aria-label={translate("إغلاق")}><X /></button></header><div className="hr-form-grid">
      {!editingId && <label><span>{translate("رمز الوردية")}</span><input required value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label>}
      <label><span>{translate("اسم الوردية بالعربية")}</span><input required value={draft.name_ar} onChange={(event) => setDraft({ ...draft, name_ar: event.target.value })} /></label><label><span>{translate("الاسم بالإنجليزية")}</span><input value={draft.name_en || ""} onChange={(event) => setDraft({ ...draft, name_en: event.target.value })} /></label>
       <label><span>{translate("وقت البداية")}</span><input type="time" required value={draft.start_time} onChange={(event) => setDraft({ ...draft, start_time: event.target.value })} /></label><label><span>{translate("وقت النهاية")}</span><input type="time" required value={draft.end_time} onChange={(event) => setDraft({ ...draft, end_time: event.target.value })} /></label><p className="muted-text">{translate("الوردية الليلية تُحسب كاملة في تاريخ بدايتها، ويُحفظ تاريخ الخروج الحقيقي.")}</p>
      <label><span>{translate("السماح المبكر (دقيقة)")}</span><input type="number" min="0" max="240" value={draft.early_checkin_minutes} onChange={(event) => setDraft({ ...draft, early_checkin_minutes: Number(event.target.value) })} /></label><label><span>{translate("السماح المتأخر (دقيقة)")}</span><input type="number" min="0" max="240" value={draft.late_checkout_minutes} onChange={(event) => setDraft({ ...draft, late_checkout_minutes: Number(event.target.value) })} /></label><label><span>{translate("مدة الاستراحة (دقيقة)")}</span><input type="number" min="0" max="240" value={draft.break_minutes} onChange={(event) => setDraft({ ...draft, break_minutes: Number(event.target.value) })} /></label>
      <label><span>{translate("تفعيل النطاق الجغرافي")}</span><select value={String(draft.geofence_enabled)} onChange={(event) => setDraft({ ...draft, geofence_enabled: event.target.value === "true" })}><option value="true">{translate("مفعّل")}</option><option value="false">{translate("غير مفعّل")}</option></select></label>
       <label><span>{translate("خط العرض")}</span><input type="number" step="any" required={draft.geofence_enabled} disabled={!draft.geofence_enabled} value={draft.geofence_center_lat ?? ""} onChange={(event) => setDraft({ ...draft, geofence_center_lat: event.target.value ? Number(event.target.value) : null })} /></label><label><span>{translate("خط الطول")}</span><input type="number" step="any" required={draft.geofence_enabled} disabled={!draft.geofence_enabled} value={draft.geofence_center_lng ?? ""} onChange={(event) => setDraft({ ...draft, geofence_center_lng: event.target.value ? Number(event.target.value) : null })} /></label><label><span>{translate("نصف القطر بالمتر")}</span><input type="number" min="20" max="5000" disabled={!draft.geofence_enabled} value={draft.geofence_radius_meters} onChange={(event) => setDraft({ ...draft, geofence_radius_meters: Number(event.target.value) })} /></label>
      <button className="hr-location" type="button" disabled={!draft.geofence_enabled || busy === "location"} onClick={useCurrentLocation}><LocateFixed size={16} />{busy === "location" ? translate("جارٍ تحديد الموقع…") : translate("استخدام موقعي كمركز")}</button>
    </div><footer><button className="hr-primary" disabled={busy === "shift"}>{busy === "shift" ? translate("جارٍ الحفظ…") : translate("حفظ الوردية")}</button><button type="button" onClick={() => setDraft(null)}>{translate("إلغاء")}</button></footer></form></div>}
  </div>;
}
