import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { translate } from "../../i18n";
import { api, can, list, listPage, type Row } from "../../lib/app-api";
import { createLatestRequestGate, LIST_PAGE_SIZE, runLatestRequest } from "../../lib/listing";
import { useDialogReturnFocus } from "../../lib/use-dialog-return-focus";

const professionOptions = [
  "مدير",
  "مشرف",
  "موظف إداري",
  "محاسب",
  "مندوب مبيعات",
  "مشغل ماكينة",
  "فني صيانة",
  "فني كهرباء",
  "فني ميكانيكا",
  "مراقب جودة",
  "أمين مستودع",
  "عامل إنتاج",
  "سائق",
  "حارس أمن",
  "عامل نظافة",
  "أخرى",
] as const;

const nationalityOptions = [
  "سعودي",
  "مصري",
  "سوداني",
  "يمني",
  "هندي",
  "باكستاني",
  "بنغلاديشي",
  "نيبالي",
  "فلبيني",
  "سريلانكي",
  "أردني",
  "سوري",
  "أخرى",
] as const;

function UserModal({ row, user, onClose, onSaved }: { row: Row; user: Row; onClose: () => void; onSaved: () => void }) {
  useDialogReturnFocus();
  const [form, setForm] = useState<Row>({ status: "active", include_in_attendance: true, must_change_password: false, is_system_user: false, ...row });
  const [roles, setRoles] = useState<Row[]>([]); const [sections, setSections] = useState<Row[]>([]); const [error, setError] = useState(""); const [lookupError, setLookupError] = useState(""); const [loadingLookups, setLoadingLookups] = useState(true); const [saving, setSaving] = useState(false); const [retryLookups, setRetryLookups] = useState(0);
  const isAdmin = can(user, ["admin"]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);
  useEffect(() => {
    let active = true;
    setLoadingLookups(true);
    setLookupError("");
    Promise.all([list("/roles"), list("/sections")]).then(([r, s]) => {
      if (active) { setRoles(r); setSections(s); }
    }).catch((e) => { if (active) setLookupError(e.message); }).finally(() => { if (active) setLoadingLookups(false); });
    return () => { active = false; };
  }, [retryLookups]);
  const textFields = [["username","اسم المستخدم"],["display_name","الاسم بالإنجليزية"],["display_name_ar","الاسم بالعربية"],["phone","الهاتف"],["email","البريد الإلكتروني"],["national_id","رقم الهوية"]] as const;
  const save = async (event: FormEvent) => { event.preventDefault(); setError(""); if (lookupError || loadingLookups) return; setSaving(true); try {
    const body: Row = {};
    textFields.forEach(([key]) => { body[key] = key === "username" ? String(form[key] || "").trim() : form[key] || null; });
    body.profession = form.profession || null;
    body.nationality = form.nationality || null;
    body.birth_date = form.birth_date || null;
    body.service_start_date = form.service_start_date || null;
    body.status = form.status || "active";
    const validRole = roles.some((role) => String(role.id) === String(form.role_id));
    const currentRoleMissing = row.id && String(form.role_id ?? "") === String(row.role_id ?? "") && !validRole;
    if (!validRole && !currentRoleMissing) throw new Error(translate("اختر دوراً صالحاً من القائمة"));
    if (!currentRoleMissing) body.role_id = Number(form.role_id);
    const validSection = !form.section_id || sections.some((section) => String(section.id) === String(form.section_id));
    const currentSectionMissing = row.id && String(form.section_id ?? "") === String(row.section_id ?? "") && !validSection;
    if (!validSection && !currentSectionMissing) throw new Error(translate("اختر قسماً صالحاً من القائمة"));
    if (!currentSectionMissing) body.section_id = form.section_id || null;
    if (form.password) body.password = form.password;
    if (form.birth_date && Number.isNaN(Date.parse(`${form.birth_date}T00:00:00`))) throw new Error(translate("تاريخ الميلاد غير صالح"));
    if (form.service_start_date && Number.isNaN(Date.parse(`${form.service_start_date}T00:00:00`))) throw new Error(translate("تاريخ بدء الخدمة غير صالح"));
    if (form.birth_date && new Date(`${form.birth_date}T00:00:00`).getTime() > Date.now()) throw new Error(translate("تاريخ الميلاد لا يمكن أن يكون في المستقبل"));
    if (form.birth_date && form.service_start_date && form.service_start_date < form.birth_date) throw new Error(translate("تاريخ بدء الخدمة يجب أن يكون بعد تاريخ الميلاد"));
    body.must_change_password = Boolean(form.must_change_password);
    body.include_in_attendance = Boolean(form.include_in_attendance);
    if (isAdmin) body.is_system_user = Boolean(form.is_system_user);
    if (!row.id && !form.password) throw new Error(translate("كلمة المرور مطلوبة عند إنشاء مستخدم"));
    setSaving(true);
    await api(row.id ? `/users/${row.id}` : "/users", { method: row.id ? "PUT" : "POST", body: JSON.stringify(body) }); onSaved();
  } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  const roleName = (role: Row) => role.name_ar || role.name || String(role.id);
  const currentRoleUnavailable = Boolean(form.role_id) && !roles.some((role) => String(role.id) === String(form.role_id));
  const currentSectionUnavailable = Boolean(form.section_id) && !sections.some((section) => String(section.id) === String(form.section_id));
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}><form className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onSubmit={save}>
    <header><div><div className="eyebrow">{translate("ملف هوية وصلاحيات")}</div><h3 id="user-dialog-title">{row.id ? translate("تعديل مستخدم") : translate("إضافة مستخدم")}</h3></div><button aria-label={translate("إغلاق حوار المستخدم")} title={translate("إغلاق")} disabled={saving} type="button" className="btn btn-plain" onClick={onClose}><X /></button></header>
    {lookupError && <div className="error" role="alert" style={{ margin: 18 }}>{lookupError} <button type="button" className="btn btn-muted" onClick={() => setRetryLookups((attempt) => attempt + 1)}>{translate("إعادة تحميل الأدوار والأقسام")}</button></div>}
    {currentRoleUnavailable || currentSectionUnavailable ? <div className="tag" role="status" style={{ margin: 18 }}>{translate("توجد علاقة قديمة غير موجودة في القوائم؛ ستبقى كما هي ما لم تختر بديلاً صالحاً.")}</div> : null}
    {error && <div className="error" role="alert" style={{ margin: 18 }}>{error}</div>}<div className="form-grid">
      <div className="field"><label htmlFor="user-record-id">{translate("رقم المستخدم")}</label><input id="user-record-id" value={row.id ?? "يُولَّد تلقائيًا عند الحفظ"} disabled readOnly /></div>
      {textFields.map(([key, label]) => <div className="field" key={key}><label htmlFor={`user-${key}`}>{translate(label)}</label><input id={`user-${key}`} name={key} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} required={key === "username"} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>)}
      <div className="field"><label htmlFor="user-profession">{translate("المهنة")}</label><select id="user-profession" value={form.profession ?? ""} onChange={(e) => setForm({ ...form, profession: e.target.value })}><option value="">{translate("اختر المهنة")}</option>{form.profession && !professionOptions.includes(form.profession as typeof professionOptions[number]) && <option value={String(form.profession)}>{String(form.profession)}</option>}{professionOptions.map((profession) => <option key={profession} value={profession}>{translate(profession)}</option>)}</select></div>
      <div className="field"><label htmlFor="user-nationality">{translate("الجنسية")}</label><select id="user-nationality" value={form.nationality ?? ""} onChange={(e) => setForm({ ...form, nationality: e.target.value })}><option value="">{translate("اختر الجنسية")}</option>{form.nationality && !nationalityOptions.includes(form.nationality as typeof nationalityOptions[number]) && <option value={String(form.nationality)}>{String(form.nationality)}</option>}{nationalityOptions.map((nationality) => <option key={nationality} value={nationality}>{translate(nationality)}</option>)}</select></div>
      <div className="field"><label htmlFor="user-role">{translate("الدور")}</label><select id="user-role" required={!currentRoleUnavailable} value={form.role_id ?? ""} onChange={(e) => setForm({ ...form, role_id: e.target.value })}><option value="">{translate("اختر الدور")}</option>{roles.map((r) => <option key={r.id} value={r.id}>{roleName(r)}</option>)}{currentRoleUnavailable && <option value={form.role_id}>{translate("الدور الحالي المحفوظ (")}{form.role_id})</option>}</select></div>
      <div className="field"><label htmlFor="user-section">{translate("القسم")}</label><select id="user-section" value={form.section_id ?? ""} onChange={(e) => setForm({ ...form, section_id: e.target.value })}><option value="">{translate("بدون قسم")}</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name_ar || s.name || s.id}</option>)}{currentSectionUnavailable && <option value={form.section_id}>{translate("القسم الحالي المحفوظ (")}{form.section_id})</option>}</select></div>
      <div className="field"><label>{translate("حالة الحساب")}</label><select value={form.status ?? "active"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">{translate("نشط")}</option><option value="inactive">{translate("غير نشط")}</option></select></div>
      <div className="field"><label>{translate("تاريخ الميلاد")}</label><input type="date" value={form.birth_date ?? ""} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
      <div className="field"><label>{translate("تاريخ بدء الخدمة")}</label><input type="date" value={form.service_start_date ?? ""} onChange={(e) => setForm({ ...form, service_start_date: e.target.value })} /></div>
      <div className="field"><label>{translate("كلمة المرور")}{" "}{row.id && <small>{translate("(اختيارية عند التعديل)")}</small>}</label><input type="password" autoComplete="new-password" minLength={8} required={!row.id} value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div className="check-grid wide">{[["must_change_password","إجبار تغيير كلمة المرور"],["include_in_attendance","يظهر في الحضور"],...(isAdmin ? [["is_system_user","حساب نظام"] as const] : [])].map(([key,label]) => <label className="check-row" key={key}><input type="checkbox" checked={Boolean(form[key])} disabled={key === "is_system_user" && !isAdmin} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{translate(label)}</label>)}</div>
    </div><footer><button disabled={saving || loadingLookups || Boolean(lookupError)} className="btn btn-primary"><Check size={16} />{saving ? translate("جارٍ الحفظ…") : translate("حفظ المستخدم")}</button><button disabled={saving} type="button" className="btn btn-muted" onClick={onClose}>{translate("إلغاء")}</button></footer>
  </form></div>;
}

export default function UsersAdmin({ user, refreshToken = 0 }: { user: Row; refreshToken?: number }) {
  const [loadedRows, setRows] = useState<Row[]>([]); const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const [resultKey, setResultKey] = useState(""); const [busy, setBusy] = useState(true); const [edit, setEdit] = useState<Row | null>(null); const [error, setError] = useState("");
  const requestGate = useRef(createLatestRequestGate());
  const activeKey = `${search}|${page}|${refreshToken}`;
  const rows = resultKey === activeKey ? loadedRows : [];
  const requestBusy = busy || resultKey !== activeKey;
  const load = useCallback(() => {
    const request = requestGate.current.begin();
    const requestKey = activeKey;
    setBusy(true);
    setResultKey("");
    setError("");
    void runLatestRequest(requestGate.current, request, listPage("/users", search, page * LIST_PAGE_SIZE), {
      onSuccess: (value) => {
        setRows(value);
        setResultKey(requestKey);
      },
      onError: (requestError) => {
        setRows([]);
        setResultKey(requestKey);
        setError(requestError.message);
      },
      onSettled: () => setBusy(false),
    });
  }, [activeKey, page, search]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load]);
  const remove = async (row: Row) => { if (!confirm(translate("تأكيد حذف المستخدم؟"))) return; try { await api(`/users/${row.id}`, { method: "DELETE" }); latestLoad.current(); } catch (e) { setError((e as Error).message); } };
  const arabicName = (row: Row) => row.display_name_ar || row.full_name || row.display_name || "—";
  const englishName = (row: Row) => row.display_name || row.full_name || "—";
  return <>
    <div className="page-heading"><button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={17} />{" "}{translate("إضافة مستخدم")}</button></div>
    {error && <div className="error" role="alert">{error}</div>}
    <section className="panel">
      <div className="panel-head">
        <div><h3>{translate("دليل المستخدمين")}</h3><small className="muted-text">{translate("بيانات الهوية، الدور، والقسم")}</small></div>
        <div className="tools"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="users-search">{translate("بحث في المستخدمين")}</label><input id="users-search" aria-label={translate("بحث بالاسم أو المستخدم")} className="search" placeholder={translate("بحث بالاسم أو المستخدم…")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setEdit(null); }} /></div>
      </div>
      {requestBusy ? <div style={{ padding: 20 }} aria-busy="true"><div className="skeleton" /></div> : <div className="table-wrap">
        <table className="users-table"><thead><tr><th>{translate("الاسم")}</th><th>{translate("اسم المستخدم")}</th><th>{translate("القسم")}</th><th>{translate("الدور")}</th><th>{translate("الهاتف")}</th><th>{translate("خيارات")}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{arabicName(r)}</strong><small className="cell-sub" dir="ltr">{englishName(r)}</small></td><td>{r.username || "—"}</td><td>{r.section_name_ar || r.section_name || "—"}</td><td>{r.role_name_ar || r.role_name || "—"}</td><td>{r.phone || "—"}</td><td><div className="actions"><button aria-label={translate("تعديل المستخدم")} className="btn btn-plain" title={translate("تعديل")} onClick={() => setEdit(r)}><Pencil size={16} /></button>{can(user, ["admin"]) && <button aria-label={translate("حذف المستخدم")} className="btn btn-plain" title={translate("حذف")} onClick={() => remove(r)}><Trash2 size={16} /></button>}</div></td></tr>)}</tbody>
        </table>
        <div className="mobile-cards user-cards">{rows.map((r) => <article className="entity-card" key={r.id}><strong>{arabicName(r)}</strong><small className="cell-sub" dir="ltr">{englishName(r)}</small><div className="card-line"><span>{translate("اسم المستخدم")}</span><b>{r.username || "—"}</b></div><div className="card-line"><span>{translate("القسم")}</span><b>{r.section_name_ar || r.section_name || "—"}</b></div><div className="card-line"><span>{translate("الدور")}</span><b>{r.role_name_ar || r.role_name || "—"}</b></div><div className="card-line"><span>{translate("الهاتف")}</span><b>{r.phone || "—"}</b></div><div className="actions"><button aria-label={translate("تعديل المستخدم")} className="btn btn-muted" onClick={() => setEdit(r)}><Pencil size={15} />{" "}{translate("تعديل")}</button>{can(user, ["admin"]) && <button aria-label={translate("حذف المستخدم")} className="btn btn-danger" onClick={() => remove(r)}><Trash2 size={15} />{" "}{translate("حذف")}</button>}</div></article>)}</div>
        {!rows.length && <div className="empty"><strong>{translate("لا توجد حسابات مطابقة")}</strong>{translate("أنشئ حساباً جديداً لبدء إدارة الوصول.")}</div>}
      </div>}
      {!requestBusy && (page > 0 || rows.length === LIST_PAGE_SIZE) && <nav className="list-pagination" aria-label={translate("صفحات المستخدمين")}><button className="btn btn-muted" type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{translate("السابق")}</button><span>{translate("صفحة")}{" "}{page + 1}</span><button className="btn btn-muted" type="button" disabled={rows.length < LIST_PAGE_SIZE} onClick={() => setPage((current) => current + 1)}>{translate("التالي")}</button></nav>}
    </section>
    {edit && <UserModal row={edit} user={user} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); latestLoad.current(); }} />}
  </>;
}
