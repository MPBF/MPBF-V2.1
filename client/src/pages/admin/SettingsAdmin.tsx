import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Check } from "lucide-react";
import { translate } from "../../i18n";
import { api, list, type Row } from "../../lib/app-api";

export default function SettingsAdmin({ refreshToken = 0 }: { refreshToken?: number }) {
  const [profile, setProfile] = useState<Row>({
    name: "",
    name_ar: "",
    tax_number: "",
    phone: "",
    email: "",
    address: "",
    default_language: "ar",
    working_hours_per_day: 8,
  });
  const [settings, setSettings] = useState<Row[]>([]);
  const [operations, setOperations] = useState<Row>({
    timezone: "Asia/Riyadh",
    overtime_factor: "1.50",
    weekly_holiday_day: "friday",
    enable_holiday_overtime: "true",
  });
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const languageOptions = [
    { value: "ar", label: "العربية" },
    { value: "en", label: "English" },
  ];
  const timezoneOptions = ["Asia/Riyadh", "UTC", "Asia/Dubai", "Africa/Cairo"];
  const overtimeFactorOptions = ["1.25", "1.50", "1.75", "2.00"];
  const weeklyHolidayOptions = [
    { value: "sunday", label: "الأحد" },
    { value: "monday", label: "الاثنين" },
    { value: "tuesday", label: "الثلاثاء" },
    { value: "wednesday", label: "الأربعاء" },
    { value: "thursday", label: "الخميس" },
    { value: "friday", label: "الجمعة" },
    { value: "saturday", label: "السبت" },
  ];

  const settingsByKey = useMemo(
    () => Object.fromEntries(settings.map((row) => [String(row.setting_key), row])),
    [settings],
  );

  const parseBoolean = (value: unknown, fallback = false) => {
    if (value === undefined || value === null || value === "") return fallback;
    return String(value).toLowerCase() === "true";
  };

  const getSettingValue = (key: string, fallback = "") => {
    const value = settingsByKey[key]?.setting_value;
    if (value === undefined || value === null || value === "") return fallback;
    return String(value);
  };

  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([api("/company-profile"), list("/system-settings")])
      .then(([company, sys]) => {
        if (!active) return;
        const loadedProfile = company || {};
        setSettings(Array.isArray(sys) ? sys : []);
        setProfile({
          name: loadedProfile.name ?? "",
          name_ar: loadedProfile.name_ar ?? "",
          tax_number: loadedProfile.tax_number ?? "",
          phone: loadedProfile.phone ?? "",
          email: loadedProfile.email ?? "",
          address: loadedProfile.address ?? "",
          default_language: loadedProfile.default_language ?? "ar",
          working_hours_per_day: Number(loadedProfile.working_hours_per_day ?? 8) || 8,
        });
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refreshToken]);

  useEffect(() => {
    if (!settings.length) return;
    setOperations({
      timezone: getSettingValue("factory_timezone", "Asia/Riyadh"),
      overtime_factor: getSettingValue("overtime_factor", "1.50"),
      weekly_holiday_day: getSettingValue("weekly_holiday_day", "friday"),
      enable_holiday_overtime: getSettingValue("enable_holiday_overtime", "true"),
    });
    setLogoDataUrl(getSettingValue("company_logo_data_url", ""));
    setLogoFileName(getSettingValue("company_logo_file_name", ""));
  }, [settingsByKey]);

  const upsertSetting = async (key: string, value: string, type: string, description: string) => {
    let existing = settingsByKey[key];
    if (!existing) {
      const candidates = await list("/system-settings", key);
      if (Array.isArray(candidates)) {
        const matchingSetting = candidates.find((row) => String(row.setting_key) === key);
        if (matchingSetting) existing = matchingSetting;
      }
    }
    if (existing?.id) {
      await api(`/system-settings/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ setting_value: value }),
      });
      return;
    }
    await api("/system-settings", {
      method: "POST",
      body: JSON.stringify({
        setting_key: key,
        setting_value: value,
        setting_type: type,
        description,
        is_editable: true,
      }),
    });
  };

  const saveCompanyAndOperations = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved("");
    try {
      if (!String(profile.name || "").trim()) throw new Error("اسم الشركة مطلوب");
      await api("/company-profile", {
        method: "PUT",
        body: JSON.stringify({
          name: String(profile.name).trim(),
          name_ar: profile.name_ar || null,
          tax_number: profile.tax_number || null,
          phone: profile.phone || null,
          email: profile.email || null,
          address: profile.address || null,
          default_language: profile.default_language || "ar",
          working_hours_per_day: Number(profile.working_hours_per_day) || 8,
        }),
      });

      await upsertSetting("factory_timezone", String(operations.timezone || "Asia/Riyadh"), "string", "المنطقة الزمنية للمصنع");
      await upsertSetting("overtime_factor", String(operations.overtime_factor || "1.50"), "number", "معامل ساعة العمل الإضافي");
      await upsertSetting("weekly_holiday_day", String(operations.weekly_holiday_day || "friday"), "string", "يوم العطلة الأسبوعي");
      await upsertSetting("enable_holiday_overtime", String(parseBoolean(operations.enable_holiday_overtime, true)), "boolean", "تفعيل احتساب إضافي في يوم العطلة");
      await upsertSetting("company_logo_data_url", logoDataUrl || "", "string", "ملف شعار الشركة المرفوع");
      await upsertSetting("company_logo_file_name", logoFileName || "", "string", "اسم ملف شعار الشركة");

      setSettings(await list("/system-settings"));
      setSaved(translate("تم حفظ هوية المصنع وإعدادات التشغيل"));
      window.dispatchEvent(new Event("branding:updated"));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onLogoFileChange = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(translate("ملف الشعار يجب أن يكون صورة"));
      return;
    }
    if (file.size > 1_500_000) {
      setError(translate("حجم الشعار كبير. الحد الأقصى 1.5MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(String(reader.result || ""));
      setLogoFileName(file.name);
      setError("");
    };
    reader.onerror = () => setError(translate("تعذر قراءة ملف الشعار"));
    reader.readAsDataURL(file);
  };

  return (
    <div className="settings-layout">
      <div aria-live="polite">
        {error && <div className="error" role="alert">{error}</div>}
        {saved && <div className="success"><Check size={16} />{saved}</div>}
      </div>
      <section className="panel settings-section">
        <div className="panel-head">
          <div>
            <div className="eyebrow">{translate("هوية المصنع وتشغيل النظام")}</div>
            <h3>{translate("الإعدادات الأساسية")}</h3>
          </div>
          <Building2 size={21} color="var(--orange)" />
        </div>
        <form className="form-grid" onSubmit={saveCompanyAndOperations}>
          <div className="field">
            <label htmlFor="profile-name-ar">{translate("اسم الشركة بالعربية")}</label>
            <input id="profile-name-ar" value={profile.name_ar ?? ""} onChange={(e) => setProfile({ ...profile, name_ar: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-name">{translate("اسم الشركة بالإنجليزية")}</label>
            <input id="profile-name" required value={profile.name ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-tax">{translate("الرقم الضريبي")}</label>
            <input id="profile-tax" value={profile.tax_number ?? ""} onChange={(e) => setProfile({ ...profile, tax_number: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-phone">{translate("الهاتف")}</label>
            <input id="profile-phone" type="tel" value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="profile-email">{translate("البريد الإلكتروني")}</label>
            <input id="profile-email" type="email" value={profile.email ?? ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div className="field wide">
            <label htmlFor="profile-address">{translate("العنوان")}</label>
            <textarea id="profile-address" value={profile.address ?? ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
          </div>
          <div className="field wide">
            <label htmlFor="profile-logo-file">{translate("شعار الشركة (رفع ملف)")}</label>
            <input id="profile-logo-file" type="file" accept="image/*" onChange={onLogoFileChange} />
            {logoFileName && <small className="cell-sub">{translate("الملف الحالي:")}{" "}{logoFileName}</small>}
            {logoDataUrl && <img src={logoDataUrl} alt={translate("شعار الشركة")} style={{ marginTop: 8, maxHeight: 72, borderRadius: 8, border: "1px solid var(--line)" }} />}
          </div>
          <div className="field">
            <label htmlFor="default-language">{translate("اللغة الافتراضية")}</label>
            <select id="default-language" value={profile.default_language ?? "ar"} onChange={(e) => setProfile({ ...profile, default_language: e.target.value })}>
              {languageOptions.map((option) => <option key={option.value} value={option.value}>{translate(option.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="factory-timezone">{translate("المنطقة الزمنية")}</label>
            <select id="factory-timezone" value={operations.timezone} onChange={(e) => setOperations({ ...operations, timezone: e.target.value })}>
              {timezoneOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="work-hours-day">{translate("ساعات العمل اليومية")}</label>
            <select id="work-hours-day" value={String(profile.working_hours_per_day ?? 8)} onChange={(e) => setProfile({ ...profile, working_hours_per_day: Number(e.target.value) })}>
              {[6, 7, 8, 9, 10, 12].map((hours) => <option key={hours} value={hours}>{hours}{" "}{translate("ساعة")}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="overtime-factor">{translate("معامل ساعة الإضافي")}</label>
            <select id="overtime-factor" value={operations.overtime_factor} onChange={(e) => setOperations({ ...operations, overtime_factor: e.target.value })}>
              {overtimeFactorOptions.map((factor) => <option key={factor} value={factor}>{factor}x</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="holiday-day">{translate("يوم العطلة الأسبوعي")}</label>
            <select id="holiday-day" value={operations.weekly_holiday_day} onChange={(e) => setOperations({ ...operations, weekly_holiday_day: e.target.value })}>
              {weeklyHolidayOptions.map((day) => <option key={day.value} value={day.value}>{translate(day.label)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="holiday-overtime">{translate("احتساب إضافي في يوم العطلة")}</label>
            <select id="holiday-overtime" value={String(operations.enable_holiday_overtime)} onChange={(e) => setOperations({ ...operations, enable_holiday_overtime: e.target.value })}>
              <option value="true">{translate("مفعل")}</option>
              <option value="false">{translate("غير مفعل")}</option>
            </select>
          </div>
          <div className="wide">
            <button className="btn btn-primary">{translate("حفظ الإعدادات الأساسية")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
