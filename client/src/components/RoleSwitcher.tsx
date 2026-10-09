import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { RolePreviewChoice, RolePreviewState } from "../../../shared/role-preview";
import "./RoleSwitcher.css";

type RoleSwitcherUser = {
  role_id: number | null;
  role_name: string | null;
  role_name_ar: string | null;
  role_preview?: RolePreviewState;
};

type RoleSwitcherProps = {
  user: RoleSwitcherUser;
  placement: "sidebar" | "mobile";
};

type RoleListResponse = { roles: RolePreviewChoice[] };
type PreviewResponse = { success?: boolean; user?: unknown; message?: string; message_en?: string };

function roleLabel(role: { id: number | null; name: string | null; name_ar: string | null }, arabic: boolean): string {
  if (arabic) return role.name_ar || role.name || (role.id === null ? "الدور الأصلي" : `الدور ${role.id}`);
  const englishName = role.name && !/\p{Script=Arabic}/u.test(role.name) ? role.name : null;
  return englishName || (role.id === null ? "Original role" : `Role ${role.id}`);
}

async function readServerError(response: Response, arabic: boolean): Promise<string> {
  try {
    const body = (await response.json()) as PreviewResponse;
    const message = arabic ? body.message : body.message_en;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Use the language-specific fallback below when the response is not JSON.
  }
  return arabic
    ? "تعذر تغيير الدور الآن. يرجى المحاولة مرة أخرى."
    : "Could not change the role right now. Please try again.";
}

export default function RoleSwitcher({ user, placement }: RoleSwitcherProps) {
  const preview = user.role_preview;
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<RolePreviewChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const dialogId = useId();
  const { i18n } = useTranslation();
  const arabic = (i18n.resolvedLanguage || i18n.language).startsWith("ar");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError("");
    fetch("/api/me/role-preview/roles", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readServerError(response, arabic));
        return (await response.json()) as RoleListResponse;
      })
      .then((data) => {
        if (!Array.isArray(data.roles)) throw new Error(arabic ? "تعذر تحميل الأدوار." : "Could not load roles.");
        if (current) setRoles(data.roles);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : arabic ? "تعذر تحميل الأدوار." : "Could not load roles.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, arabic]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(".rs-dialog");
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])"));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy]);

  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!preview) return null;

  const originalRole = preview.original_role;
  const originalLabel = roleLabel(originalRole, arabic);
  const activeRole = !preview.role_available ? (arabic ? "الدور غير متاح" : "Role unavailable") : roleLabel(
    { id: user.role_id, name: user.role_name, name_ar: user.role_name_ar },
    arabic,
  );
  const copy = arabic
    ? {
        control: "تغيير الدور",
        testing: "الدور قيد الاختبار",
        original: "دوري الأصلي",
        return: "العودة إلى دوري الأصلي",
        title: "اختيار دور للاختبار",
        description: "ستُطبّق صلاحيات الدور المحدد على هذه الجلسة.",
        warning: "تنبيه: الإجراءات تحفظ بيانات حقيقية. لا يتغير الدور المحفوظ لحسابك.",
        loading: "جارٍ تحميل الأدوار...",
        retry: "إعادة المحاولة",
        cancel: "إلغاء",
        working: "جارٍ تطبيق الدور...",
        choose: "اختبار هذا الدور",
        close: "إغلاق",
        empty: "لا توجد أدوار متاحة للاختبار.",
        originalTag: "الدور الأصلي",
      }
    : {
        control: "Change role",
        testing: "Currently testing",
        original: "My original role",
        return: "Return to my original role",
        title: "Choose a role to test",
        description: "The selected role's permissions will apply to this session.",
        warning: "Changes write real data. Your account's saved role will not change.",
        loading: "Loading available roles…",
        retry: "Try again",
        cancel: "Cancel",
        working: "Applying role…",
        choose: "Test this role",
        close: "Close",
        empty: "No roles are available to test.",
        originalTag: "Original role",
      };

  const openChooser = () => setOpen(true);
  const closeChooser = () => {
    if (!busy) setOpen(false);
  };

  const applyChoice = async (roleId: number | null) => {
    setBusy(true);
    setError("");
    try {
      const response =
        roleId === originalRole.id
          ? await fetch("/api/me/role-preview", { method: "DELETE", credentials: "include" })
          : await fetch("/api/me/role-preview", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role_id: roleId }),
            });
      if (!response.ok) throw new Error(await readServerError(response, arabic));
      try {
        window.localStorage.setItem("mpbf:role-preview-changed", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      } catch {
        // Navigation still resets the app when storage is unavailable.
      }
      window.location.assign("/");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : arabic ? "تعذر تغيير الدور الآن." : "Could not change the role right now.");
      setBusy(false);
    }
  };

  const restoreOriginal = () => applyChoice(originalRole.id);

  return (
    <section className={`rs-root rs-${placement}`} aria-label={arabic ? "معاينة الأدوار" : "Role preview"}>
      <button className={`rs-trigger${preview.active ? " is-active" : ""}`} type="button" ref={triggerRef} onClick={openChooser} aria-haspopup="dialog" aria-expanded={open} disabled={busy}>
        <span className="rs-trigger-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
        <span className="rs-trigger-copy">
          <strong>{copy.control}</strong>
          {preview.active && <small>{copy.testing}: {activeRole}</small>}
        </span>
        <ChevronDown className="rs-trigger-chevron" size={16} aria-hidden="true" />
      </button>
      {preview.active && (
        <button className="rs-return" data-role-preview-action="restore" type="button" onClick={restoreOriginal} disabled={busy} aria-label={copy.return}>
          {busy ? <Loader2 size={15} className="rs-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
          <span>{copy.return}</span>
        </button>
      )}
      {error && !open && <div className="rs-error" role="alert">{error}</div>}

      {open && (
        <div className="rs-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeChooser(); }}>
          <section className="rs-dialog" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}>
            <header className="rs-dialog-header">
              <div className="rs-dialog-mark"><ShieldCheck size={19} aria-hidden="true" /></div>
              <div className="rs-dialog-heading">
                <h2 id={`${dialogId}-title`}>{copy.title}</h2>
                <p id={`${dialogId}-description`}>{copy.description}</p>
              </div>
              <button className="rs-icon-button" type="button" ref={closeRef} onClick={closeChooser} disabled={busy} aria-label={copy.close}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="rs-warning" role="note">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{copy.warning}</span>
            </div>
            {error && <div className="rs-error" role="alert">{error}</div>}
            <div className="rs-options" aria-label={copy.title}>
              <button
                 className={`rs-option${!preview.active ? " is-current" : ""}`}
                type="button"
                onClick={() => void applyChoice(originalRole.id)}
                disabled={busy || loading}
              >
                <span className="rs-option-main"><strong>{originalLabel}</strong><small>{copy.originalTag}</small></span>
                {busy && originalRole.id === user.role_id ? <Loader2 size={17} className="rs-spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
              </button>
              {loading && <div className="rs-loading" aria-live="polite"><span /><span /><span />{copy.loading}</div>}
              {!loading && !error && roles.length === 0 && <p className="rs-empty">{copy.empty}</p>}
               {!loading && roles.filter(role => role.id !== originalRole.id).map((role) => {
                const current = preview.active && role.id === user.role_id;
                return (
                   <button key={role.id} data-role-preview-role={role.id} className={`rs-option${current ? " is-current" : ""}`} type="button" onClick={() => void applyChoice(role.id)} disabled={busy}>
                    <span className="rs-option-main">
                      <strong>{roleLabel(role, arabic)}</strong>
                      {current && <small>{copy.testing}</small>}
                    </span>
                    {busy && current ? <Loader2 size={17} className="rs-spin" aria-hidden="true" /> : <span className="rs-option-arrow" aria-hidden="true">›</span>}
                  </button>
                );
              })}
            </div>
            {error && <button className="rs-retry" type="button" onClick={() => { setError(""); setOpen(false); requestAnimationFrame(() => setOpen(true)); }} disabled={busy}>{copy.retry}</button>}
            <footer className="rs-dialog-footer">
              <span className="rs-current-label">{preview.active ? `${copy.testing}: ${activeRole}` : `${copy.original}: ${originalLabel}`}</span>
              <button className="rs-cancel" type="button" onClick={closeChooser} disabled={busy}>{busy ? <Loader2 size={15} className="rs-spin" aria-hidden="true" /> : null}{busy ? copy.working : copy.cancel}</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
