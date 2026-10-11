import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, KeyRound, Pencil, Plus, Shield, Trash2, X } from "lucide-react";
import ProductionRoleBindingFields from "../../components/ProductionRoleBindingFields";
import { localizedName, translate } from "../../i18n";
import { api, can, list, type Row } from "../../lib/app-api";
import { finishedGoodsPermissionGroup, finishedGoodsPermissionDescriptions } from "../../lib/finished-goods-permissions";
import { createLatestRequestGate } from "../../lib/listing";

const permissionGroups = [
  { label: "النظام والإدارة", items: [["admin","مدير النظام"],["manage_users","إدارة المستخدمين"],["manage_roles","إدارة الأدوار والصلاحيات"],["manage_sections","إدارة الأقسام"],["manage_settings","إدارة الإعدادات"],["manage_definitions","إدارة التعريفات"],["view_system_health","صحة النظام"],["view_system_monitoring","مراقبة النظام"]] },
  { label: "الصيانة والآلات", items: [["manage_machines","إدارة الماكينات"],["manage_maintenance","إدارة الصيانة"],["manage_maintenance_actions","إجراءات الصيانة"],["create_maintenance_requests","إنشاء طلبات الصيانة"],["view_maintenance","عرض الصيانة"],["view_maintenance_reports","تقارير الصيانة"],["view_maintenance_requests","طلبات الصيانة"],["view_maintenance_stats_reports","إحصاءات الصيانة"]] },
  { label: "الإنتاج والتشغيل", items: [["manage_production","إدارة الإنتاج"],["operate_film","تشغيل الفيلم"],["operate_printing","تشغيل الطباعة"],["operate_cutting","تشغيل القص"],["view_production_hall","عرض صالة الإنتاج"],["delete_production","حذف سجلات الإنتاج"],["manage_production_hall","إدارة صالة الإنتاج"],["view_production","عرض الإنتاج"],["view_production_monitoring","مراقبة الإنتاج"],["view_production_reports","تقارير الإنتاج"],["view_today_production","إنتاج اليوم"],["view_cutting_dashboard","لوحة القص"],["view_film_dashboard","لوحة الفيلم"],["view_printing_dashboard","لوحة الطباعة"],["manage_mixing","إدارة الخلط"],["view_mixing","عرض الخلط"]] },
  finishedGoodsPermissionGroup,
  { label: "المخزون والمستودع", items: [["manage_inventory","إدارة المخزون"],["view_inventory","عرض المخزون"],["manage_warehouse","إدارة المستودع"],["view_warehouse","عرض المستودع"],["view_raw_inventory","عرض مخزون المواد الخام"],["manage_raw_materials","إدارة مواد الخام"],["manage_warehouse_vouchers","إدارة سندات المستودع"],["view_warehouse_vouchers","عرض سندات المستودع"],["view_warehouse_reports","تقارير المستودع"],["manage_spare_parts","قطع الغيار"],["manage_consumable_parts","المواد المستهلكة"],["manage_items","إدارة الأصناف"],["manage_categories","إدارة التصنيفات"]] },
  { label: "الجودة والطلبات والعملاء", items: [["manage_quality","إدارة الجودة"],["manage_quality_settings","إعدادات الجودة"],["create_quality_inspections","إنشاء فحوص الجودة"],["view_quality","عرض الجودة"],["view_quality_reports","تقارير الجودة"],["view_quality_control_reports","تقارير ضبط الجودة"],["manage_orders","إدارة الطلبات"],["view_orders","عرض الطلبات"],["view_my_orders","طلباتي"],["update_order_status","تحديث حالة الطلب"],["manage_customers","إدارة العملاء"]] },
  { label: "الموارد البشرية والحضور", items: [["manage_hr","إدارة الموارد البشرية"],["view_hr","عرض الموارد البشرية"],["view_hr_reports","تقارير الموارد البشرية"],["manage_attendance","إدارة الحضور"],["view_attendance","عرض الحضور"],["view_attendance_reports","تقارير الحضور"],["manage_leaves","إدارة الإجازات"],["manage_training","إدارة التدريب"],["view_training","عرض التدريب"],["manage_negligence","إدارة الإهمال"],["manage_work_violations","إدارة مخالفات العمل"],["record_work_violations","تسجيل مخالفات العمل"],["view_work_violations","عرض مخالفات العمل"]] },
  { label: "التحليلات والعرض", items: [["view_dashboard","لوحة المتابعة"],["view_user_dashboard","لوحة المستخدم"],["view_home","الرئيسية"],["view_reports","التقارير"],["manage_analytics","التحليلات"],["view_financial_reports","التقارير المالية"],["manage_alerts","إدارة التنبيهات"],["view_alerts","عرض التنبيهات"],["view_notifications","الإشعارات"],["manage_display_screen","إدارة شاشة العرض"],["view_display_screen","عرض الشاشة"]] },
  { label: "الذكاء والتكاملات", items: [["manage_ai_agent","إدارة وكيل الذكاء"],["use_ai_agent","استخدام وكيل الذكاء"],["view_ai_agent","عرض وكيل الذكاء"],["manage_whatsapp","إدارة واتساب"],["manage_factory_simulation","إدارة محاكاة المصنع"],["view_factory_simulation","عرض محاكاة المصنع"],["view_tools","عرض الأدوات"],["view_legacy_database","عرض قاعدة البيانات القديمة"],["view_bag_configurator","مهيئ الأكياس"],["manage_master_batch","إدارة الماستر باتش"]] },
] as const;
const allPermissionLabels = new Map<string, string>(permissionGroups.flatMap((group) => group.items as readonly (readonly [string, string])[]));

function RoleModal({ row, user, onClose, onSaved }: { row: Row; user: Row; onClose: () => void; onSaved: () => void }) {
  const existing: string[] = Array.isArray(row.permissions) ? row.permissions.map(String) : []; const [form, setForm] = useState<Row>({ ...row, permissions: existing, production_role_binding: row.production_role_binding ?? { mode: "general", stages: [] } }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const actorPermissions: string[] = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
  const isAdmin = can(user, ["admin"]);
  const canGrant = (permission: string) => isAdmin || (permission !== "admin" && (actorPermissions.includes("*") || actorPermissions.includes(permission)));
  const toggle = (value: string) => {
    if (!canGrant(value)) return;
    const permissions: string[] = form.permissions;
    if (value === "admin" && !window.confirm(translate("تغيير صلاحية مدير النظام قد يمنح وصولاً كاملاً للنظام أو يزيله. هل تريد المتابعة؟"))) return;
    setForm({ ...form, permissions: permissions.includes(value) ? permissions.filter((p) => p !== value) : [...permissions, value] });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!String(form.name || "").trim()) { setError(translate("اسم الدور مطلوب")); return; }
    const newlyGranted = form.permissions.filter((permission: string) => !existing.includes(permission));
    if (newlyGranted.some((permission: string) => !canGrant(permission))) { setError(translate("لا يمكنك منح صلاحيات لا تملكها")); return; }
    setSaving(true); setError("");
    try { await api(row.id ? `/roles/${row.id}` : "/roles", { method: row.id ? "PUT" : "POST", body: JSON.stringify({ name: String(form.name).trim(), name_ar: form.name_ar || null, permissions: form.permissions, production_role_binding: form.production_role_binding }) }); onSaved(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [saving, onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
    <form className="modal role-modal" role="dialog" aria-modal="true" aria-labelledby="role-dialog-title" onSubmit={save}>
      <header><div><div className="eyebrow">{translate("سياسة الوصول")}</div><h3 id="role-dialog-title">{row.id ? translate("تعديل دور") : translate("إضافة دور")}</h3></div><button aria-label={translate("إغلاق حوار الدور")} title={translate("إغلاق")} disabled={saving} type="button" className="btn btn-plain" onClick={onClose}><X /></button></header>
      {error && <div className="error" role="alert" style={{ margin: 18 }}>{error}</div>}
      <div className="role-head form-grid">
        <div className="field"><label htmlFor="role-record-id">{translate("رقم الدور")}</label><input id="role-record-id" value={row.id ?? "يُولَّد تلقائيًا عند الحفظ"} disabled readOnly /></div>
        <div className="field"><label htmlFor="role-name">{translate("اسم الدور بالإنجليزية")}</label><input id="role-name" required value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="role-name-ar">{translate("اسم الدور بالعربية")}</label><input id="role-name-ar" value={form.name_ar ?? ""} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
      </div>
      <ProductionRoleBindingFields value={form.production_role_binding} disabled={saving}
        onChange={production_role_binding => setForm({ ...form, production_role_binding })} />
      <div className="permission-summary"><KeyRound size={17} /> <strong>{form.permissions.length}</strong>{" "}{translate("صلاحية محددة")}{" "}<span>{translate("الصلاحيات التي لا تملكها محفوظة دون تغيير؛ منح صلاحية مدير النظام يتطلب تأكيداً صريحاً من مدير النظام.")}</span></div>
      <div className="permission-groups">
        {permissionGroups.map((group) => {
          const bulkKeys: string[] = group.items.map(([key]) => key).filter((key) => key !== "admin" && canGrant(key));
          const selected = bulkKeys.filter((key) => form.permissions.includes(key)).length;
          return <section className="permission-group" key={group.label}>
            <div className="permission-group-head">
              <strong>{translate(group.label)}</strong>
              {bulkKeys.length > 0 && <button type="button" className="text-button" onClick={() => setForm({ ...form, permissions: selected === bulkKeys.length ? form.permissions.filter((p: string) => !bulkKeys.includes(p)) : Array.from(new Set([...form.permissions, ...bulkKeys])) })}>{selected === bulkKeys.length ? translate("إلغاء تحديد الكل") : translate("تحديد الكل")}</button>}
              <span>{selected}/{bulkKeys.length}{" "}{translate("متاحة")}</span>
            </div>
            {"description" in group && <p className="permission-group-description">{translate(group.description)}</p>}
            <div className="permission-grid">{group.items.map(([key, label]) => <label className={`permission ${form.permissions.includes(key) ? "selected" : ""}`} key={key}>
              <input type="checkbox" checked={form.permissions.includes(key)} disabled={!canGrant(key)} aria-describedby={finishedGoodsPermissionDescriptions[key] ? `permission-description-${key}` : undefined} onChange={() => toggle(key)} />
              <span>{translate(label)}{key === "admin" ? translate(" (تأكيد مطلوب)") : ""}
                {finishedGoodsPermissionDescriptions[key] && <small id={`permission-description-${key}`}>{translate(finishedGoodsPermissionDescriptions[key])}</small>}
              </span>
            </label>)}</div>
          </section>;
        })}
        {existing.filter((p: string) => !allPermissionLabels.has(p)).length > 0 && <div className="unknown-permissions"><strong>{translate("صلاحيات محفوظة أخرى")}</strong><div>{existing.filter((p: string) => !allPermissionLabels.has(p)).map((p: string) => <span className="tag" key={p}>{p}</span>)}</div></div>}
      </div>
      <footer><button disabled={saving} className="btn btn-primary"><Check size={16} />{saving ? translate("جارٍ الحفظ…") : translate("حفظ الدور")}</button><button disabled={saving} type="button" className="btn btn-muted" onClick={onClose}>{translate("إلغاء")}</button></footer>
    </form>
  </div>;
}

export default function RolesAdmin({ user, refreshToken = 0, writable, deletable }: { user: Row; refreshToken?: number; writable: boolean; deletable: boolean }) {
  const [rows, setRows] = useState<Row[]>([]); const [edit, setEdit] = useState<Row | null>(null); const [error, setError] = useState("");
  const requestGate = useRef(createLatestRequestGate());
  const load = useCallback(() => {
    const request = requestGate.current.begin();
    setError("");
    list("/roles").then((value) => {
      if (requestGate.current.isCurrent(request)) setRows(value);
    }).catch((e) => {
      if (requestGate.current.isCurrent(request)) setError(e.message);
    });
  }, []);
  useEffect(() => {
    const gate = requestGate.current;
    load();
    return () => gate.invalidate();
  }, [load, refreshToken]);
  const remove = async (r: Row) => { if (!deletable || !confirm(translate("تأكيد حذف الدور؟"))) return; try { await api(`/roles/${r.id}`, { method: "DELETE" }); load(); } catch (e) { setError((e as Error).message); } };
  return <>{writable && <div className="page-heading"><button className="btn btn-primary" onClick={() => setEdit({ permissions: [] })}><Plus size={17} />{" "}{translate("إضافة دور")}</button></div>}{error && <div className="error" role="alert">{error}</div>}<div className="role-cards">{rows.map((r) => <article className="role-card" key={r.id}><div className="role-icon"><Shield size={19} /></div><div className="role-card-main"><strong>{localizedName(r.name_ar, r.name, String(r.id))}</strong><span className="cell-sub">{localizedName("", r.name, "")}</span><div className="role-count">{Array.isArray(r.permissions) ? r.permissions.length : 0}{" "}{translate("صلاحية")}</div></div><div className="actions">{writable && <button aria-label={`${translate("تعديل")} ${translate("دور")} ${localizedName(r.name_ar, r.name, String(r.id))}`} title={translate("تعديل")} className="btn btn-plain" onClick={() => setEdit(r)}><Pencil size={16} /></button>}{deletable && <button aria-label={`${translate("حذف")} ${translate("دور")} ${localizedName(r.name_ar, r.name, String(r.id))}`} title={translate("حذف")} className="btn btn-plain" onClick={() => remove(r)}><Trash2 size={16} /></button>}</div></article>)}{!rows.length && <div className="empty panel"><strong>{translate("لا توجد أدوار")}</strong>{writable ? translate("أنشئ أول سياسة وصول للنظام.") : translate("لا توجد أدوار مسجلة.")}</div>}</div>{edit && writable && <RoleModal row={edit} user={user} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}</>;
}
