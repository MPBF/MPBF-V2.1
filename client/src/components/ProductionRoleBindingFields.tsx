import type { ProductionRoleBinding } from "../../../shared/production-role";
import { translate } from "../i18n";

export default function ProductionRoleBindingFields({ value, onChange, disabled }: {
  value: ProductionRoleBinding;
  onChange: (value: ProductionRoleBinding) => void;
  disabled: boolean;
}) {
  return <fieldset className="role-head" disabled={disabled}>
    <legend>{translate("تخصيص لوحة الإنتاج للدور")}</legend>
    <label className="field" htmlFor="production-role-mode">
      {translate("نوع التنقّل")}
      <select id="production-role-mode" value={value.mode} onChange={event =>
        onChange(event.target.value === "operator" ? { mode: "operator", stages: [] } : { mode: "general", stages: [] })}>
        <option value="general">{translate("عام / إدارة — حسب الصلاحيات")}</option>
        <option value="operator">{translate("مشغل — مراحل محددة فقط")}</option>
      </select>
    </label>
    {value.mode === "operator" && <div className="permission-grid">
      {(["film", "printing", "cutting"] as const).map(stage => <label className="permission" key={stage}>
        <input type="checkbox" checked={value.stages.includes(stage)} onChange={event =>
          onChange({ mode: "operator", stages: event.target.checked ? [...value.stages, stage] : value.stages.filter(item => item !== stage) })} />
        <span>{translate({ film: "الفيلم", printing: "الطباعة", cutting: "القص" }[stage])}</span>
      </label>)}
    </div>}
    <p>{translate("هذا الربط لا يمنح صلاحيات. تظهر المراحل المحددة فقط مع صلاحية عرضها أو تشغيلها. الإدارة تبقى حسب صلاحيات الإدارة.")}</p>
  </fieldset>;
}
