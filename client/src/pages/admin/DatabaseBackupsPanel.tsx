import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, FileArchive, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import type { DatabaseBackupPreview, DatabaseRestoreResult } from "../../../../shared/database-backups";
import { formatWholeNumber } from "../../lib/format-number";
import "./DatabaseBackupsPanel.css";

type Props = { language: "ar" | "en" };
type ErrorInfo = { code: string; message: string };
type PendingRestore = { id: string };

const messages: Record<string, [string, string]> = {
  INVALID: ["كلمة المرور غير صحيحة أو الملف تالف.", "The passphrase is incorrect or the archive is damaged."],
  SCHEMA_CHANGED: ["مخطط قاعدة البيانات غير متوافق مع هذه النسخة.", "The database schema does not match this archive."],
  DATA_CHANGED: ["تغيرت البيانات منذ المعاينة. ارفع الملف وأنشئ معاينة جديدة.", "Data changed since preview. Upload the archive and preview it again."],
  EXPIRED: ["انتهت صلاحية المعاينة. ارفع الملف وأنشئ معاينة جديدة.", "The preview expired. Upload the archive and preview it again."],
  TOO_LARGE: ["حجم الملف يتجاوز الحد المسموح.", "The file exceeds the allowed size."],
  PASSPHRASE: ["يجب أن تتكون كلمة المرور من 12 إلى 256 حرفاً.", "Passphrases must be 12–256 characters."],
  ADMIN_MISSING: ["تعذر التحقق من صلاحية المسؤول.", "Administrator authorization could not be verified."],
  RELATION_BLOCKED: ["تمنع علاقة بيانات تطبيق الاستعادة بأمان.", "A data relation prevents a safe restore."],
  STORAGE_UNAVAILABLE: ["التخزين غير متاح حالياً. حاول لاحقاً.", "Storage is unavailable. Try again later."],
  BUSY: ["هناك عملية أخرى قيد التنفيذ. حاول مجدداً بعد انتهائها.", "Another operation is in progress. Retry when it finishes."],
  UNSAFE_SCHEMA: ["المخطط الحالي غير آمن للاستعادة.", "The current schema is not safe to restore."],
  FAILED: ["تعذر إكمال العملية. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.", "The operation could not be completed. Check the connection and permissions, then retry."],
};

function tr(language: "ar" | "en", ar: string, en: string) { return language === "ar" ? ar : en; }

function errorMessage(code: string, language: "ar" | "en") {
  const key = code.startsWith("BACKUP_") ? code.slice(7) : "FAILED";
  return messages[key]?.[language === "ar" ? 0 : 1] || messages.FAILED[language === "ar" ? 0 : 1];
}

function responseCode(body: unknown): string {
  if (!body || typeof body !== "object") return "BACKUP_FAILED";
  const record = body as Record<string, unknown>;
  const candidate = typeof record.code === "string" ? record.code : typeof record.error === "string" ? record.error : "";
  return candidate.startsWith("BACKUP_") ? candidate : "BACKUP_FAILED";
}

function attachmentName(disposition: string, fallback: string) {
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8.replace(/^["']|["']$/g, "")); } catch { /* use plain filename */ }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

async function readJsonError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return responseCode(body);
}

async function downloadBinary(response: Response, fallback: string) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  const blob = await response.blob();
  const start = (await blob.slice(0, 256).text()).trimStart();
  if (type.includes("application/json") || type.includes("text/") || /^[{\[]/.test(start)) {
    let code = "BACKUP_FAILED";
    try { code = responseCode(JSON.parse(start)); } catch { /* malformed error payload */ }
    throw Object.assign(new Error(code), { code });
  }
  if (!blob.size) throw Object.assign(new Error("BACKUP_FAILED"), { code: "BACKUP_FAILED" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachmentName(response.headers.get("content-disposition") || "", fallback);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function DatabaseBackupsPanel({ language }: Props) {
  const [createPass, setCreatePass] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [restorePass, setRestorePass] = useState("");
  const [preview, setPreview] = useState<DatabaseBackupPreview | null>(null);
  const [safetySaved, setSafetySaved] = useState(false);
  const [ackReplace, setAckReplace] = useState(false);
  const [safetyChecksum, setSafetyChecksum] = useState("");
  const [safetyReady, setSafetyReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [restored, setRestored] = useState<DatabaseRestoreResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (code: string) => setError({ code, message: errorMessage(code, language) });
  const clearRestoreApproval = () => {
    setPreview(null);
    setSafetySaved(false);
    setAckReplace(false);
    setSafetyChecksum("");
    setSafetyReady(false);
    setPendingRestore(null);
    setRestored(null);
    setNotice("");
  };

  const createBackup = async (event: FormEvent) => {
    event.preventDefault();
    if (createPass.length < 12 || createPass.length > 256 || createPass !== createConfirm || busy) return;
    const passphrase = createPass;
    setBusy("create"); setError(null); setNotice("");
    try {
      const response = await fetch("/api/database-backups/create", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) {
        const code = await readJsonError(response);
        throw Object.assign(new Error(code), { code });
      }
      await downloadBinary(response, "database-backup.mpbfbak");
      setNotice(tr(language, "تم تنزيل النسخة المشفرة. احتفظ بكلمة المرور؛ لا يمكن استعادتها.", "Encrypted backup downloaded. Keep the passphrase; it cannot be recovered."));
    } catch (e) {
      const code = e instanceof Error && "code" in e ? String((e as Error & { code: string }).code) : "BACKUP_FAILED";
      fail(code);
    } finally {
      setCreatePass(""); setCreateConfirm(""); setBusy("");
    }
  };

  const onArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] || null;
    event.target.value = "";
    if (!next) return;
    clearRestoreApproval();
    setArchive(next); setRestorePass(""); setError(null);
  };

  const previewBackup = async (event: FormEvent) => {
    event.preventDefault();
    if (!archive || restorePass.length < 12 || restorePass.length > 256 || busy) return;
    const passphrase = restorePass;
    const form = new FormData();
    form.append("file", archive);
    form.append("passphrase", passphrase);
    setBusy("preview"); setError(null); setNotice(""); clearRestoreApproval();
    try {
      const response = await fetch("/api/database-backups/preview", { method: "POST", credentials: "include", body: form });
      if (!response.ok) {
        const code = await readJsonError(response);
        throw Object.assign(new Error(code), { code });
      }
      const data = await response.json() as DatabaseBackupPreview;
      if (!data || typeof data.id !== "string" || !Array.isArray(data.tables) || !Array.isArray(data.excludedTables)) throw Object.assign(new Error(), { code: "BACKUP_FAILED" });
      setPreview(data);
    } catch (e) {
      const code = e instanceof Error && "code" in e ? String((e as Error & { code: string }).code) : "BACKUP_FAILED";
      fail(code);
    } finally { setRestorePass(""); setBusy(""); }
  };

  const prepareSafety = async () => {
    if (!preview || restorePass.length < 12 || restorePass.length > 256 || busy) return;
    const passphrase = restorePass;
    setBusy("safety"); setError(null); setNotice(""); setSafetyReady(false); setSafetyChecksum(""); setSafetySaved(false);
    try {
      const response = await fetch("/api/database-backups/safety", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: preview.id, passphrase }),
      });
      if (!response.ok) {
        const code = await readJsonError(response);
        throw Object.assign(new Error(code), { code });
      }
      const checksum = response.headers.get("X-Backup-Safety-Checksum") || "";
      if (!checksum) throw Object.assign(new Error(), { code: "BACKUP_FAILED" });
      await downloadBinary(response, "pre-restore-safety.mpbfbak");
      setSafetyChecksum(checksum);
      setSafetyReady(true);
      setNotice(tr(language, "بدأ تنزيل نسخة الأمان المشفرة. احفظها خارج هذا النظام قبل المتابعة.", "Safety archive download started. Save it outside this system before continuing."));
    } catch (e) {
      const code = e instanceof Error && "code" in e ? String((e as Error & { code: string }).code) : "BACKUP_FAILED";
      fail(code);
    } finally { setRestorePass(""); setBusy(""); }
  };

  const applyRestore = async () => {
    if (!preview || !safetyReady || !safetySaved || !ackReplace || restorePass.length < 12 || restorePass.length > 256 || busy) return;
    const operation = pendingRestore || { id: preview.id };
    const passphrase = restorePass;
    setPendingRestore(operation);
    setBusy("apply"); setError(null); setNotice("");
    try {
      const response = await fetch("/api/database-backups/apply", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: operation.id, passphrase, safetyChecksum,
          confirmRestore: true, confirmSafetySaved: true,
        }),
      });
      if (!response.ok) {
        const code = await readJsonError(response);
        const definite = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        if (definite) setPendingRestore(null);
        throw Object.assign(new Error(code), { code });
      }
      const data = await response.json() as DatabaseRestoreResult;
      if (data.requiresLogin !== true) throw Object.assign(new Error(), { code: "BACKUP_FAILED" });
      setRestored(data);
      setPendingRestore(null);
    } catch (e) {
      const code = e instanceof Error && "code" in e ? String((e as Error & { code: string }).code) : "BACKUP_FAILED";
      fail(code);
      if (!(e instanceof Error && "code" in e)) setPendingRestore(operation);
    } finally { setRestorePass(""); setBusy(""); }
  };

  const removeArchive = () => {
    setArchive(null); setRestorePass(""); clearRestoreApproval(); setError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  return <section className="panel transfer-section db-backup db-backups-panel" aria-labelledby="db-backup-title">
    <div className="panel-head">
      <div><div className="eyebrow">{tr(language, "نسخة كاملة مشفرة", "ENCRYPTED FULL BACKUP")}</div><h3 id="db-backup-title">{tr(language, "نسخ قاعدة البيانات واستعادتها", "Database backup and restore")}</h3>
        <p>{tr(language, "أرشيف محمول مشفر بكلمة مرور تختارها؛ لن تُحفظ كلمة المرور في هذا النظام.", "A portable archive encrypted with your chosen passphrase; it is never saved by this system.")}</p></div>
      <ShieldCheck size={20} color="var(--teal)" aria-hidden="true" />
    </div>
    {error && <div className="db-backup-alert" role="alert"><AlertTriangle size={17} /><span>{error.message}</span><button type="button" onClick={() => setError(null)}>{tr(language, "إغلاق", "Dismiss")}</button></div>}
    {notice && !restored && <div className="db-backup-notice" role="status">{notice}</div>}
    <div className="db-backup-explainer">
      <LockKeyhole size={18} aria-hidden="true" />
      <p>{tr(language, "تتضمن النسخة المستخدمين والأدوار، وتستبدل بيانات الجداول المشمولة عند الاستعادة. تُستثنى الجلسات والأسرار وجداول النقل التقنية. يجب أن يطابق المخطط الحالي النسخة؛ المرفقات الخارجية غير مشمولة. احتفظ بكلمة المرور في مكان آمن — لا توجد طريقة لاستعادتها.", "The archive includes users and roles, and restore replaces included data. Sessions, secrets and technical transfer tables are excluded. The current schema must match; external attachments are not included. Store the passphrase safely—there is no recovery method.")}</p>
    </div>

    <div className="db-backup-grid">
      <form className="db-backup-card" onSubmit={createBackup}>
        <div className="db-backup-card__heading"><DatabaseBackup size={18} /><div><h4>{tr(language, "إنشاء نسخة احتياطية", "Create a backup")}</h4><p>{tr(language, "اختر كلمة مرور قوية واحتفظ بها منفصلة عن الملف.", "Choose a strong passphrase and store it separately from the file.")}</p></div></div>
        <label className="db-backup-field"><span>{tr(language, "كلمة المرور", "Passphrase")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={createPass} onChange={(e) => setCreatePass(e.target.value)} required aria-describedby="db-pass-help" /></label>
        <label className="db-backup-field"><span>{tr(language, "تأكيد كلمة المرور", "Confirm passphrase")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={createConfirm} onChange={(e) => setCreateConfirm(e.target.value)} required /></label>
        <small id="db-pass-help">{tr(language, "12 إلى 256 حرفاً. لا يمكن استعادة كلمة المرور المفقودة.", "12–256 characters. A lost passphrase cannot be recovered.")}</small>
        {createConfirm && createPass !== createConfirm && <small className="db-backup-inline-error">{tr(language, "كلمتا المرور غير متطابقتين.", "Passphrases do not match.")}</small>}
        <button className="btn btn-primary" type="submit" disabled={busy !== "" || createPass.length < 12 || createPass.length > 256 || createPass !== createConfirm}>
          <Download size={16} />{busy === "create" ? tr(language, "جارٍ إنشاء النسخة…", "Creating archive…") : tr(language, "إنشاء نسخة احتياطية", "Create backup")}
        </button>
      </form>

      <div className="db-backup-card">
        <div className="db-backup-card__heading"><RotateCcw size={18} /><div><h4>{tr(language, "استرجاع نسخة", "Restore a backup")}</h4><p>{tr(language, "افحص الأرشيف أولاً؛ التطبيق يستبدل الصفوف المشمولة.", "Preview first; applying replaces included rows.")}</p></div></div>
        <label className="db-backup-upload">
          <FileArchive size={20} /><strong>{archive?.name || tr(language, "اختر ملف .mpbfbak", "Choose a .mpbfbak archive")}</strong>
          <input ref={fileInput} type="file" accept=".mpbfbak,application/octet-stream" onChange={onArchiveChange} disabled={busy !== "" || Boolean(pendingRestore)} />
        </label>
        {archive && <button type="button" className="db-backup-text-button" onClick={removeArchive} disabled={busy !== "" || Boolean(pendingRestore)}>{tr(language, "إزالة الملف وإعادة البدء", "Remove file and start over")}</button>}
        <form onSubmit={previewBackup} className="db-backup-preview-form">
          <label className="db-backup-field"><span>{tr(language, "كلمة مرور الأرشيف", "Archive passphrase")}</span><input type="password" autoComplete="off" minLength={12} maxLength={256} value={restorePass} onChange={(e) => setRestorePass(e.target.value)} required disabled={!archive || busy !== ""} /></label>
          <button className="btn btn-muted" type="submit" disabled={!archive || busy !== "" || restorePass.length < 12}>
            <FileArchive size={16} />{busy === "preview" ? tr(language, "جارٍ فحص الأرشيف…", "Inspecting archive…") : tr(language, "معاينة النسخة", "Preview backup")}
          </button>
        </form>
      </div>
    </div>

    {preview && !restored && <div className="db-backup-preview" aria-live="polite">
      <div className="db-backup-preview__head"><div><div className="eyebrow">{tr(language, "مراجعة قبل الاستبدال", "REVIEW BEFORE REPLACEMENT")}</div><h4>{tr(language, "معاينة الاستعادة", "Restore preview")}</h4></div><span className="tag neutral">{preview.environment === "production" ? tr(language, "الإنتاج", "Production") : tr(language, "التطوير", "Development")}</span></div>
      <div className="db-backup-meta"><span>{tr(language, "أُنشئت", "Created")}: {new Date(preview.createdAt).toLocaleString(language === "ar" ? "ar" : "en-GB")}</span><span>{tr(language, "تنتهي", "Expires")}: {new Date(preview.expiresAt).toLocaleString(language === "ar" ? "ar" : "en-GB")}</span><strong>{formatWholeNumber(preview.totalRows)} {tr(language, "صفاً في الأرشيف", "archived rows")}</strong></div>
      <div className="db-backup-table-wrap"><table><thead><tr><th>{tr(language, "الجدول", "Table")}</th><th>{tr(language, "الصفوف الحالية", "Current rows")}</th><th>{tr(language, "صفوف النسخة", "Backup rows")}</th></tr></thead>
        <tbody>{preview.tables.map((table) => <tr key={table.name}><th scope="row"><code>{table.name}</code></th><td>{formatWholeNumber(table.currentRows)}</td><td>{formatWholeNumber(table.backupRows)}</td></tr>)}</tbody>
      </table></div>
      {preview.excludedTables.length > 0 && <div className="db-backup-excluded"><strong>{tr(language, "جداول مستثناة", "Excluded tables")}</strong><span>{preview.excludedTables.map((name) => <code key={name}>{name}</code>)}</span></div>}
      <div className="db-backup-safety">
        <div><strong>{tr(language, "1. أنشئ نسخة أمان للحالة الحالية", "1. Create a safety backup of the current state")}</strong><p>{tr(language, "نزّل الملف المشفر قبل الموافقة. إذا فشل التنزيل فلن يتاح التطبيق.", "Download this encrypted file before approving. Apply remains unavailable if the download fails.")}</p></div>
        {!safetyReady && <div className="db-backup-warning">{tr(language, "يلزم تنزيل نسخة الأمان وحفظها خارج النظام قبل تطبيق الاسترجاع.", "Download and save the safety backup outside the system before applying restore.")}</div>}
        <label className="db-backup-field"><span>{tr(language, "أعد إدخال كلمة مرور الأرشيف", "Re-enter archive passphrase")}</span><input type="password" autoComplete="off" minLength={12} maxLength={256} value={restorePass} onChange={(e) => setRestorePass(e.target.value)} disabled={busy !== ""} /></label>
        <button type="button" className="btn btn-muted" onClick={() => void prepareSafety()} disabled={busy !== "" || restorePass.length < 12 || safetyReady}>
          <Download size={16} />{busy === "safety" ? tr(language, "جارٍ إنشاء نسخة الأمان…", "Preparing safety backup…") : tr(language, "تنزيل نسخة الأمان", "Download safety backup")}
        </button>
        {safetyReady && <div className="db-backup-checks">
          <label><input type="checkbox" checked={safetySaved} onChange={(e) => setSafetySaved(e.target.checked)} /><span>{tr(language, "أؤكد أنني حفظت ملف الأمان خارج هذا النظام.", "I confirm I saved the safety file outside this system.")}</span></label>
          <label><input type="checkbox" checked={ackReplace} onChange={(e) => setAckReplace(e.target.checked)} /><span>{tr(language, "أفهم أن تطبيق الاستعادة سيستبدل الصفوف الحالية في الجداول المشمولة.", "I understand restore will replace current rows in the included tables.")}</span></label>
        </div>}
      </div>
      {pendingRestore && <div className="db-backup-warning" role="status">{tr(language, "تعذر تأكيد نتيجة العملية. أعد إدخال كلمة المرور لإرسال الطلب نفسه بالمعرّف ذاته؛ لا تُنشئ معاينة جديدة.", "The outcome could not be confirmed. Re-enter the passphrase to retry the same request with the same operation ID; do not create a new preview.")}</div>}
      {(safetyReady && safetySaved && ackReplace) && <div className="db-backup-apply">
        <label className="db-backup-field"><span>{tr(language, "كلمة مرور الأرشيف للتطبيق", "Archive passphrase to apply")}</span><input type="password" autoComplete="off" minLength={12} maxLength={256} value={restorePass} onChange={(e) => setRestorePass(e.target.value)} disabled={busy !== ""} /></label>
        <button type="button" className="btn btn-danger" onClick={() => void applyRestore()} disabled={busy !== "" || restorePass.length < 12}>
          <RotateCcw size={16} />{busy === "apply" ? tr(language, "جارٍ الاسترجاع…", "Applying restore…") : pendingRestore ? tr(language, "إعادة محاولة الاسترجاع", "Retry restore") : tr(language, "استرجاع نسخة", "Restore backup")}
        </button>
      </div>}
    </div>}
    {restored && <div className="db-backup-success" role="status">
      <CheckCircle2 size={20} /><div><strong>{tr(language, "اكتمل استرجاع قاعدة البيانات.", "Database restore completed.")}</strong>
        <p>{formatWholeNumber(restored.restoredRows)} {tr(language, "صفاً عبر", "rows across")} {formatWholeNumber(restored.restoredTables)} {tr(language, "جدولاً. يجب تسجيل الدخول مجدداً قبل متابعة العمل.", "tables. Sign in again before continuing.")}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{tr(language, "إعادة التحميل وتسجيل الدخول", "Reload and sign in")}</button>
      </div>
    </div>}
  </section>;
}
