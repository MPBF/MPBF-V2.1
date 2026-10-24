import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeftRight, Check, CheckCircle2, ChevronDown, Clock3, Download, FileArchive, FileSpreadsheet, FileText, RefreshCw, RotateCcw, Save, ShieldCheck, Upload, X } from "lucide-react";
import type { TransferApproval, TransferFile, TransferMapping, TransferOperation, TransferPreview, TransferPreviewRow, TransferSchema, TransferTable, TransferTemplate } from "../../../../shared/data-transfer";
import "./DataTransferAdmin.css";
import DatabaseBackupsPanel from "./DatabaseBackupsPanel";

type Props = { refreshToken?: number };
type ErrorInfo = { message: string; detail: string };
class TransferRequestError extends Error { constructor(message:string,public status:number){super(message);} }
// Transfer values must not pass through the ordinary Arabic-digit normalizer.
async function api(path:string,options:RequestInit={}) {
  const response=await fetch(`/api${path}`,{credentials:"include",headers:{"Content-Type":"application/json"},...options});
  const body=await response.json();
  if(!response.ok)throw new TransferRequestError(body.message_en||body.message||"Transfer request failed",response.status);
  return body;
}

const groups: Record<string, [string, string]> = {
  catalogue: ["الكتالوج", "Catalogue"],
  production: ["الإنتاج", "Production"],
  warehouse: ["المستودع", "Warehouse"],
  accounts: ["الحسابات", "Accounts"],
  discovered: ["جداول البيانات الأخرى", "Other data tables"],
};
const knownErrors: Record<string, [string, string]> = {
  "Unsafe identifier": ["اسم حقل غير آمن", "Unsafe field identifier"],
  "Invalid ISO timestamp": ["التاريخ والوقت غير صالحين. استخدم تاريخًا مثل 2026-01-22T18:12:57.076Z.", "Invalid date and time. Use a timestamp such as 2026-01-22T18:12:57.076Z."],
  "Invalid ISO date": ["التاريخ غير صالح. استخدم الصيغة سنة-شهر-يوم، مثل 2026-01-22.", "Invalid date. Use year-month-day, such as 2026-01-22."],
  "File too large": ["حجم الملف يتجاوز الحد المسموح", "The file exceeds the allowed size"],
  "Too many rows": ["عدد الصفوف يتجاوز الحد المسموح", "The file contains too many rows"],
  "Unsupported file type": ["نوع الملف غير مدعوم", "Unsupported file type"],
  "Preview expired": ["انتهت صلاحية المعاينة، أنشئ معاينة جديدة", "Preview expired; create a new preview"],
  "Invalid preview": ["المعاينة غير صالحة أو انتهت صلاحيتها", "The preview is invalid or has expired"],
  "current administrator": ["لا يمكن إزالة صلاحيات المسؤول الحالي أو منعه من الوصول.", "The current administrator cannot remove their own access."],
  "current admin": ["لا يمكن إزالة صلاحيات المسؤول الحالي أو منعه من الوصول.", "The current administrator cannot remove their own access."],
  "last administrator": ["لا يمكن إزالة صلاحيات المسؤول الأخير.", "The last administrator's access cannot be removed."],
  "last admin": ["لا يمكن إزالة صلاحيات المسؤول الأخير.", "The last administrator's access cannot be removed."],
  "admin confirmation": ["تتطلب هذه العملية تأكيداً صريحاً من المسؤول.", "This operation requires explicit administrator confirmation."],
  "administrator confirmation": ["تتطلب هذه العملية تأكيداً صريحاً من المسؤول.", "This operation requires explicit administrator confirmation."],
  "admin-grant": ["تتطلب هذه العملية تأكيداً صريحاً من المسؤول.", "This operation requires explicit administrator confirmation."],
  "security settings": ["إعدادات الأمان مستثناة من الاستيراد والتصدير.", "Security settings are excluded from import and export."],
  "settings excluded": ["إعدادات الأمان مستثناة من الاستيراد والتصدير.", "Security settings are excluded from import and export."],
  "duplicate username": ["اسم المستخدم مستخدم بالفعل؛ اختر اسماً آخر.", "That username is already in use; choose another."],
  "username": ["تعذر التحقق من اسم المستخدم. استخدم اسماً صالحاً وغير مستخدم.", "The username could not be accepted. Use a valid, unused username."],
  "role permission": ["تعذر التحقق من صلاحيات الدور؛ استخدم دوراً وصلاحيات معتمدة.", "Role permissions could not be validated; use an approved role and permissions."],
  "role-permission": ["تعذر التحقق من صلاحيات الدور؛ استخدم دوراً وصلاحيات معتمدة.", "Role permissions could not be validated; use an approved role and permissions."],
  "numeric id": ["يجب تأكيد أن المعرّفات الرقمية تشير إلى سجلات قاعدة البيانات الحالية.", "Confirm that numeric IDs refer to records in the current database."],
  "numeric local id": ["يجب تأكيد أن المعرّفات الرقمية تشير إلى سجلات قاعدة البيانات الحالية.", "Confirm that numeric IDs refer to records in the current database."],
  "local id": ["يجب تأكيد أن المعرّفات الرقمية تشير إلى سجلات قاعدة البيانات الحالية.", "Confirm that numeric IDs refer to records in the current database."],
};

function knownErrorMessage(raw: string, tr: (ar: string, en: string) => string) {
  const normalizedRaw = raw.toLowerCase().replace(/[_-]+/g, " ");
  const match = Object.entries(knownErrors).find(([key]) => normalizedRaw.includes(key.toLowerCase().replace(/[_-]+/g, " ")));
  return match ? tr(match[1][0], match[1][1]) : null;
}

function localError(error: unknown, tr: (ar: string, en: string) => string): ErrorInfo {
  const raw = error instanceof Error ? error.message : "";
  return {
    message: knownErrorMessage(raw, tr) || tr("تعذر إكمال العملية. تحقق من الاتصال والصلاحيات ثم حاول مجدداً.", "The operation could not be completed. Check your connection and permissions, then retry."),
    detail: raw ? `SERVER_RESPONSE · ${raw}` : "REQUEST_FAILED",
  };
}

function exactSuggestions(headers: string[], table: TransferTable): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((header) => {
    const normalized = header.trim().toLocaleLowerCase();
    const matches = table.columns.filter((column) =>
      [column.name, column.labelAr, column.labelEn].some((candidate) => candidate.trim().toLocaleLowerCase() === normalized),
    );
    if (matches.length === 1) result[header] = matches[0].name;
  });
  return result;
}

function numberLabel(value: number, language: string) {
  return new Intl.NumberFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-GB").format(value);
}

function dateLabel(value: string, language: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function downloadResponse(url: string, filename: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message_en || data.message || `HTTP_${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const serverName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = serverName || filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function DataTransferAdmin({ refreshToken = 0 }: Props) {
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith("en") ? "en" : "ar";
  const tr = (ar: string, en: string) => language === "ar" ? ar : en;
  const [schema, setSchema] = useState<TransferSchema | null>(null);
  const [operations, setOperations] = useState<TransferOperation[]>([]);
  const [templates, setTemplates] = useState<TransferTemplate[]>([]);
  const [file, setFile] = useState<TransferFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileTableName, setFileTableName] = useState("");
  const [importTargetName, setImportTargetName] = useState("");
  const [mappingColumns, setMappingColumns] = useState<Record<string, string>>({});
  const [matchKey, setMatchKey] = useState<string[]>([]);
  const [nullColumns, setNullColumns] = useState<string[]>([]);
  const [mappingConfigs, setMappingConfigs] = useState<Record<string, TransferMapping>>({});
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [approvals, setApprovals] = useState<Record<number, string[]>>({});
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmLocalIds, setConfirmLocalIds] = useState(false);
  const [confirmAdminGrants, setConfirmAdminGrants] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importTargetRef = useRef("");
  const workflowHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const lastImportButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingApply = useRef<{previewId:string;approvals:TransferApproval[];confirmNew:boolean;confirmAdminGrants:boolean}|null>(null);
  const [uncertain,setUncertain] = useState(false);

  const selectedFileTable = file?.tables.find((item) => item.name === fileTableName) || null;
  const targetTable = schema?.tables.find((table) => table.name === importTargetName && table.approved && table.importable) || null;
  const compatibleTemplates = useMemo(
    () => templates.filter((template) => schema && template.version === schema.version),
    [templates, schema?.version],
  );
  const groupsList = useMemo(() => {
    if (!schema) return [];
    const map = new Map<string, TransferTable[]>();
    schema.tables.forEach((table) => map.set(table.group, [...(map.get(table.group) || []), table]));
    return [...map.entries()].sort(([groupA], [groupB]) =>
      groupA === "discovered" ? (groupB === "discovered" ? 0 : 1) : groupB === "discovered" ? -1 : 0,
    );
  }, [schema]);

  const loadData = async () => {
    setBusy("load");
    setError(null);
    try {
      const nextSchema=await api("/data-transfer/schema") as TransferSchema;
      setSchema(nextSchema);
      const [nextOperations, nextTemplates] = nextSchema.ready ? await Promise.all([
        api("/data-transfer/operations") as Promise<TransferOperation[]>,
        api("/data-transfer/templates") as Promise<TransferTemplate[]>,
      ]) : [[],[]];
      setOperations(Array.isArray(nextOperations) ? nextOperations : []);
      setTemplates(Array.isArray(nextTemplates) ? nextTemplates : []);
    } catch (e) {
      setError(localError(e, tr));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (pendingApply.current) return;
    setPreview(null);
    setApprovals({});
    setConfirmNew(false);
    setConfirmLocalIds(false);
    setConfirmAdminGrants(false);
    setFile(null);
    setFileName("");
    setFileTableName("");
    setMappingConfigs({});
    setImportTargetName("");
    importTargetRef.current = "";
    void loadData();
  }, [refreshToken]);

  useEffect(() => {
    if (file && importTargetName) workflowHeadingRef.current?.focus();
  }, [file, importTargetName]);

  useEffect(() => {
    if (!selectedFileTable || !targetTable) {
      setMappingColumns({});
      setMatchKey([]);
      setNullColumns([]);
      return;
    }
    const stored = mappingConfigs[selectedFileTable.name];
    if (stored?.table === targetTable.name) {
      setMappingColumns(stored.columns);
      setMatchKey(stored.matchKey);
      setNullColumns(stored.nullColumns);
    } else {
      setMappingColumns(exactSuggestions(selectedFileTable.headers, targetTable));
      setMatchKey(targetTable.keys[0] || []);
      setNullColumns([]);
    }
  }, [selectedFileTable?.name, targetTable?.name, mappingConfigs]);

  const clearWorkflow = () => {
    if(pendingApply.current)return;
    setPreview(null);
    setApprovals({});
    setConfirmNew(false);
    setConfirmLocalIds(false);
    setConfirmAdminGrants(false);
    setNotice("");
  };

  const refreshSchema = async () => {
    if(pendingApply.current)return;
    clearWorkflow();
    setFile(null);
    setFileName("");
    setFileTableName("");
    setMappingConfigs({});
    setImportTargetName("");
    importTargetRef.current = "";
    await loadData();
  };

  const closeImportWorkflow = () => {
    if (busy !== "" || pendingApply.current) return;
    clearWorkflow();
    setFile(null);
    setFileName("");
    setFileTableName("");
    setMappingConfigs({});
    setImportTargetName("");
    importTargetRef.current = "";
    setTemplateName("");
    setSelectedTemplate("");
    const trigger = lastImportButtonRef.current;
    requestAnimationFrame(() => trigger?.focus());
  };

  const openImportChooser = (table: TransferTable, button: HTMLButtonElement) => {
    if (!schema?.ready || !table.approved || !table.importable || busy !== "" || preview || file || pendingApply.current) return;
    lastImportButtonRef.current = button;
    clearWorkflow();
    setError(null);
    setFile(null);
    setFileName("");
    setFileTableName("");
    setMappingConfigs({});
    setTemplateName("");
    setSelectedTemplate("");
    importTargetRef.current = table.name;
    setImportTargetName(table.name);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    if(pendingApply.current)return;
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) {
      setFile(null);
      setFileName("");
      setFileTableName("");
      return;
    }
    const requestedTarget = importTargetRef.current;
    if (!requestedTarget || !schema?.tables.some((table) => table.name === requestedTarget && table.approved && table.importable)) return;
    clearWorkflow();
    setBusy("file");
    setError(null);
    setFileName(selected.name);
    try {
      const form = new FormData();
      form.append("file", selected);
      const response = await fetch("/api/data-transfer/read-file", { method: "POST", body: form, credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message_en || data.message || `HTTP_${response.status}`);
      const parsed = data as TransferFile;
      if (!Array.isArray(parsed.tables) || parsed.tables.length === 0) throw new Error("No importable tables found in file");
      setFile(parsed);
      setFileTableName(parsed.tables.find((item) => item.name === requestedTarget)?.name || parsed.tables[0].name);
      setMappingConfigs({});
    } catch (e) {
      setError(localError(e, tr));
      setFile(null);
      setFileName("");
    } finally { setBusy(""); }
  };

  const currentMapping = (): TransferMapping | null => {
    if (!selectedFileTable || !targetTable) return null;
    return { table: targetTable.name, fileTable: selectedFileTable.name, columns: mappingColumns, matchKey, nullColumns };
  };

  const rememberCurrentMapping = () => {
    const mapping = currentMapping();
    if (mapping) setMappingConfigs((current) => ({ ...current, [mapping.fileTable]: mapping }));
  };

  const createPreview = async (mapping: TransferMapping) => {
    if(pendingApply.current)return;
    if (!file || !selectedFileTable || !targetTable) return;
    setBusy("preview");
    setError(null);
    setNotice("");
    setPreview(null);
    setApprovals({});
    setConfirmNew(false);
    setConfirmAdminGrants(false);
    try {
      const result = await api("/data-transfer/preview", {
        method: "POST",
        body: JSON.stringify({ version: schema?.version, file: { ...file, tables: [selectedFileTable] }, mappings: [mapping], confirmLocalIds: file.source === "external" && confirmLocalIds }),
      }) as TransferPreview;
      setPreview(result);
    } catch (e) { setError(localError(e, tr)); }
    finally { setBusy(""); }
  };

  const saveTemplate = async () => {
    const mapping = currentMapping();
    if (!mapping || !templateName.trim() || !schema) return;
    setBusy("template");
    setError(null);
    try {
      await api("/data-transfer/templates", { method: "POST", body: JSON.stringify({ name: templateName.trim(), version: schema.version, mappings: [mapping] }) });
      setTemplateName("");
      setTemplates(await api("/data-transfer/templates") as TransferTemplate[]);
      setNotice(tr("تم حفظ قالب الربط", "Mapping template saved"));
    } catch (e) { setError(localError(e, tr)); }
    finally { setBusy(""); }
  };

  const useTemplate = () => {
    const template = compatibleTemplates.find((item) => item.id === selectedTemplate);
    const mapping = template?.mappings.find((item) => item.fileTable === selectedFileTable?.name && item.table === targetTable?.name);
    if (!mapping) {
      setError({ message: tr("القالب لا يطابق الجدول والملف المحددين", "The template does not match the selected file and target tables"), detail: "TEMPLATE_MAPPING_MISMATCH" });
      return;
    }
    const targetColumns = new Set(targetTable?.columns.map((column) => column.name) || []);
    clearWorkflow();
    setMappingColumns(Object.fromEntries(Object.entries(mapping.columns).filter(([source, target]) => selectedFileTable?.headers.includes(source) && (!target || targetColumns.has(target)))));
    setMatchKey(mapping.matchKey.filter((column) => targetTable?.keys.flat().includes(column)));
    setNullColumns(mapping.nullColumns.filter((column) => targetColumns.has(column)));
    setError(null);
  };

  const applyPreview = async () => {
    if (!preview) return;
    const blocked = preview.rows.some((row) => row.status === "invalid" || row.status === "conflict");
    if (blocked) return;
    const approvalsPayload: TransferApproval[] = preview.rows
      .filter((row) => row.status === "existing" && (approvals[row.index]?.length ?? 0) > 0)
      .map((row) => ({ index: row.index, columns: approvals[row.index] || [] }));
    const hasNew = preview.rows.some((row) => row.status === "new");
    if (hasNew && !confirmNew) return;
    if (preview.requiresAdminConfirmation && !confirmAdminGrants) return;
    setBusy("apply");
    setError(null);
    const payload=pendingApply.current??{previewId:preview.id,approvals:approvalsPayload,confirmNew,confirmAdminGrants};
    pendingApply.current=payload;
    try {
      await api("/data-transfer/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(tr("اكتمل النقل بنجاح", "Transfer completed successfully"));
      pendingApply.current=null;setUncertain(false);
      setPreview(null);
      setApprovals({});
      setConfirmLocalIds(false);
      setConfirmAdminGrants(false);
      setFile(null);
      setFileName("");
      setFileTableName("");
      setMappingConfigs({});
      setImportTargetName("");
      importTargetRef.current = "";
      await loadData();
    } catch (e) {
      setError(localError(e,tr));
      if(e instanceof TransferRequestError && [400,401,403,404,409,410,422].includes(e.status)){
        pendingApply.current=null;setUncertain(false);
      } else setUncertain(true);
    }
    finally { setBusy(""); }
  };

  const previewRestore = async (operation: TransferOperation) => {
    if(pendingApply.current)return;
    setBusy(`restore-${operation.id}`);
    setError(null);
    setNotice("");
    setPreview(null);
    setApprovals({});
    setConfirmNew(false);
    setConfirmLocalIds(false);
    setConfirmAdminGrants(false);
    try {
      const result = await api("/data-transfer/restore-preview", { method: "POST", body: JSON.stringify({ operationId: operation.id }) }) as TransferPreview;
      setPreview(result);
    } catch (e) { setError(localError(e, tr)); }
    finally { setBusy(""); }
  };

  const toggleApproval = (row: TransferPreviewRow, column: string, checked: boolean) => {
    if(pendingApply.current)return;
    setApprovals((current) => {
      const next = new Set(current[row.index] || []);
      if (checked) next.add(column); else next.delete(column);
      return { ...current, [row.index]: [...next] };
    });
  };

  const exportTable = async (table: TransferTable) => {
    if (!schema?.ready || !table.approved || !table.exportable || busy !== "" || pendingApply.current) return;
    setBusy(`export-${table.name}`);
    setError(null);
    try {
      await downloadResponse("/api/data-transfer/export", `mpbf-transfer-${table.name}.xlsx`, "POST", { tables: [table.name], format: "xlsx", version: schema.version });
      const label = language === "ar" ? table.labelAr : table.labelEn;
      setNotice(tr(`بدأ تنزيل ${label}`, `Download started for ${label}`));
    } catch (e) { setError(localError(e, tr)); }
    finally { setBusy(""); }
  };

  const statusLabel = (status: TransferPreviewRow["status"]) => ({
    new: tr("جديد", "New"), existing: tr("موجود", "Existing"), conflict: tr("تعارض", "Conflict"), invalid: tr("غير صالح", "Invalid"),
  })[status];
  const operationKind = (kind: string) => ({
    import: tr("استيراد", "Import"), export: tr("تصدير", "Export"), restore: tr("استعادة", "Restore"), preview:tr("معاينة","Preview"),
  }[kind.toLowerCase()] || kind);
  const operationStatus = (status: string) => ({
    completed: tr("مكتملة", "Completed"), success: tr("ناجحة", "Succeeded"), failed: tr("فشلت", "Failed"),
    preview: tr("معاينة", "Preview"), applied: tr("تم التطبيق", "Applied"),
  }[status.toLowerCase()] || status);
  const counts = (rows: TransferPreviewRow[]) => ({
    new: rows.filter((row) => row.status === "new").length,
    existing: rows.filter((row) => row.status === "existing").length,
    conflict: rows.filter((row) => row.status === "conflict").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
  });
  const relationNames = (table: TransferTable) => [...new Set(table.relations.map(relation => {
    const target = schema?.tables.find(t => t.name === relation.table);
    return target ? language === "ar" ? target.labelAr : target.labelEn : relation.table;
  }))].join(" · ");

  return (
    <div className="transfer-page">
      {error && <div className="transfer-alert" role="alert"><AlertTriangle size={18} /><div><strong>{error.message}</strong><div className="transfer-alert__details" dir="ltr">{error.detail}</div></div><button type="button" className="btn btn-plain transfer-retry" aria-label={tr("إغلاق التنبيه", "Dismiss alert")} onClick={() => setError(null)}><X size={17} /></button></div>}
      {notice && <div className="success" role="status"><Check size={16} />{notice}<button type="button" className="btn btn-plain transfer-retry" aria-label={tr("إغلاق الرسالة", "Dismiss message")} onClick={() => setNotice("")}><X size={16} /></button></div>}

      <header className="transfer-hero">
        <div>
          <div className="eyebrow">{tr("إدارة البيانات • أدوات النظام", "DATA ADMINISTRATION • SYSTEM TOOLS")}</div>
          <h2>{tr("نقل قاعدة البيانات", "Database transfer")}</h2>
          <p>{tr("صدّر البيانات المعتمدة أو استورد تغييرات محددة مع معاينة وموافقة صريحة قبل التطبيق.", "Export approved data or import selected changes with a review and explicit approval before applying.")}</p>
        </div>
        <div className="transfer-hero__icon" aria-hidden="true"><ArrowLeftRight size={25} /></div>
      </header>

      {busy === "load" && !schema ? <div className="panel transfer-loading" aria-label={tr("جارٍ التحميل", "Loading")}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : null}
      {schema && <>
        <div className="transfer-statusline">
          <span className={`transfer-dot${schema.ready ? "" : " offline"}`} />
          <span>{tr("البيئة المتصلة", "Connected environment")}</span>
          <strong className="mono">{schema.environment}</strong>
          <span className={`tag ${schema.ready ? "" : "red"}`}>{schema.ready ? tr("جاهز", "Ready") : tr("غير جاهز", "Not ready")}</span>
          <span className="mono">{tr("الإصدار", "Version")} {schema.version}</span>
          <div className="transfer-toolbar" style={{ marginInlineStart: "auto" }}>
            <button type="button" className="btn btn-muted" onClick={() => void refreshSchema()} disabled={busy !== "" || Boolean(pendingApply.current)}><RefreshCw size={15} />{tr("تحديث المخطط", "Refresh schema")}</button>
          </div>
        </div>
        <div className="transfer-facts" aria-label={tr("حدود النقل", "Transfer limits")}>
          <div className="transfer-fact"><span>{tr("الحد الأقصى للملف", "Maximum file size")}</span><strong>{numberLabel(schema.limits.bytes / (1024 * 1024), language)} MB</strong></div>
          <div className="transfer-fact"><span>{tr("حد صفوف الاستيراد", "Import row limit")}</span><strong>{numberLabel(schema.limits.rows, language)}</strong></div>
          <div className="transfer-fact"><span>{tr("الاحتفاظ بالنسخ", "Backup retention")}</span><strong>{numberLabel(schema.limits.retentionDays, language)} {tr("يوماً", "days")}</strong></div>
          <div className="transfer-fact"><span>{tr("نمط التطبيق", "Apply mode")}</span><strong>{tr("ALL · OR · NOTHING", "ALL · OR · NOTHING")}</strong></div>
        </div>
        <div className="transfer-footer-note"><ShieldCheck size={16} /><span>{tr("استيراد الجداول لا ينشئ جداول ولا يحذف سجلات. الإدراجات الجديدة افتراضياً، وتعديلات السجلات الموجودة تحتاج اختيار الأعمدة والموافقة عليها. هذا مختلف عن الاسترجاع الكامل الذي يستبدل البيانات بعد تأكيد مستقل.", "Table imports do not create tables or delete records. New rows are the default; existing-row updates require explicit column approval. This differs from full restore, which replaces data after separate confirmation.")}</span></div>

        <section className="panel transfer-section">
          <div className="panel-head">
            <div><div className="eyebrow">{tr("فهرس نقل البيانات", "DATA TRANSFER CATALOGUE")}</div><h3>{tr("الجداول المعتمدة", "Approved data tables")}</h3><p>{tr("يعرض الفهرس الجداول المتاحة وفق صلاحيات الاستيراد والتصدير، مع العلاقات المرتبطة بها.", "This catalogue lists tables available under import and export permissions, with their relationships.")}</p></div>
            <span className="tag">{numberLabel(schema.tables.filter((table) => table.approved).length, language)} {tr("معتمد", "approved")}</span>
          </div>
          <div className="transfer-groups">
            {groupsList.length === 0 && <div className="transfer-empty"><strong>{tr("لا توجد جداول مكتشفة", "No discovered tables")}</strong>{tr("سيظهر المخطط هنا عند توفره.", "The schema will appear here when available.")}</div>}
            {groupsList.map(([group, tables]) => <div className="transfer-group" key={group}>
              <div className="transfer-group-head"><strong>{groups[group]?.[language === "ar" ? 0 : 1] || group}</strong><span className="mono">{tables.length}</span></div>
              <div className="transfer-table-grid">
                {tables.map((table) => <article className="transfer-table-card" key={table.name}>
                  <div className="transfer-table-card__head"><div><strong>{language === "ar" ? table.labelAr : table.labelEn}</strong><small className="cell-sub mono">{table.name}</small></div>
                    <span className={`tag ${table.approved ? "" : "neutral"}`}>{table.approved ? tr("معتمد", "Approved") : tr("غير معتمد", "Not approved")}</span>
                  </div>
                  <p>{table.approved ? (language === "ar" ? table.reasonAr : table.reasonEn) : (language === "ar" ? table.reasonAr : table.reasonEn) || tr("غير مصرح بالاستيراد لأسباب سلامة البيانات.", "Import is restricted for data-integrity reasons.")}</p>
                  <div className="transfer-chips">
                    <button
                      type="button"
                      className={`transfer-chip transfer-chip--action ${table.approved && table.exportable ? "" : "transfer-chip--muted"}`}
                      data-transfer-export={table.name}
                      aria-label={tr(`تصدير ${language === "ar" ? table.labelAr : table.labelEn}`, `Export ${language === "ar" ? table.labelAr : table.labelEn}`)}
                      title={tr(`تصدير ${language === "ar" ? table.labelAr : table.labelEn}`, `Export ${language === "ar" ? table.labelAr : table.labelEn}`)}
                      disabled={!schema.ready || !table.approved || !table.exportable || busy !== "" || Boolean(pendingApply.current)}
                      onClick={() => void exportTable(table)}
                    ><Download size={12} />{table.exportable ? tr("تصدير", "Export") : tr("لا تصدير", "No export")}</button>
                    <button
                      type="button"
                      className={`transfer-chip transfer-chip--action ${table.approved && table.importable ? "" : "transfer-chip--muted"}`}
                      data-transfer-import={table.name}
                      aria-label={tr(`استيراد ${language === "ar" ? table.labelAr : table.labelEn}`, `Import ${language === "ar" ? table.labelAr : table.labelEn}`)}
                      title={tr(`استيراد ${language === "ar" ? table.labelAr : table.labelEn}`, `Import ${language === "ar" ? table.labelAr : table.labelEn}`)}
                      disabled={!schema.ready || !table.approved || !table.importable || busy !== "" || Boolean(file && importTargetName) || Boolean(preview) || Boolean(pendingApply.current)}
                      onClick={(event) => openImportChooser(table, event.currentTarget)}
                    ><Upload size={12} />{table.importable ? tr("استيراد", "Import") : tr("تصدير فقط", "Export only")}</button>
                    <span className="transfer-chip transfer-chip--muted">{numberLabel(table.columns.length, language)} {tr("عمود", "columns")}</span>
                  </div>
                  {relationNames(table) && <p><strong>{tr("العلاقات:", "Relations:")}</strong> {relationNames(table)}</p>}
                </article>)}
              </div>
            </div>)}
          </div>
        </section>

        <DatabaseBackupsPanel language={language} />

        <input
          ref={fileInputRef}
          className="transfer-hidden-file-input"
          data-transfer-file-input="true"
          type="file"
          accept=".csv,.xlsx,.xls,.json,.zip,application/json,text/csv,application/zip"
          aria-label={tr("اختر ملفاً لاستيراده إلى الجدول المحدد", "Choose a file to import into the selected table")}
          onChange={handleFile}
        />

        {importTargetName && file && targetTable && <section className="panel transfer-section transfer-import-workflow" aria-live="polite">
          <div className="panel-head">
            <div><div className="eyebrow">{tr("استيراد جدول محدد", "SINGLE-TABLE IMPORT")}</div><h3 ref={workflowHeadingRef} tabIndex={-1}>{tr("استيراد إلى", "Import into")} {language === "ar" ? targetTable.labelAr : targetTable.labelEn}</h3><p>{tr("الوجهة ثابتة لهذا المسار؛ اختر جدول المصدر واربط الأعمدة لمراجعة التغييرات قبل التطبيق.", "The target is locked for this workflow. Choose a source table and map its columns to review changes before applying.")} · <code className="mono">{targetTable.name}</code></p></div>
            <button type="button" className="btn btn-muted" onClick={closeImportWorkflow} disabled={busy !== "" || Boolean(pendingApply.current)}><X size={15} />{tr("إغلاق الاستيراد", "Close import")}</button>
          </div>
          <div className="transfer-section-body">
            <div className="transfer-import-file"><FileText size={16} /><span>{tr("الملف المحدد:", "Selected file:")} <strong dir="auto">{fileName}</strong></span></div>
            <div className="transfer-callout"><AlertTriangle size={16} /><span>{file.source === "external" ? tr("ملف خارجي: استخدم المعرّفات الرقمية للمفاتيح أو العلاقات فقط بعد تأكيد أنها تشير إلى سجلات قاعدة البيانات الحالية.", "External file: use numeric primary or foreign IDs only after confirming they refer to records in the current database.") : tr("ملف من قاعدة البيانات نفسها: يمكن استخدام المراجع الرقمية، مع بقاء التحقق من المفاتيح والعلاقات إلزامياً.", "Same-database file: numeric references may be used, while key and relation validation still applies.")}</span></div>
            {file.source === "external" && <label className="check-row transfer-safety-check">
              <input type="checkbox" checked={confirmLocalIds} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => { clearWorkflow(); setConfirmLocalIds(event.target.checked); }} />
              <span><strong>{tr("أؤكد أن المعرّفات الرقمية في الملف تشير إلى سجلات قاعدة البيانات الحالية", "I confirm numeric IDs in this file refer to records in the current database")}</strong><small>{tr("قد تشير المعرّفات الأساسية أو المرتبطة إلى سجلات مختلفة في قاعدة أخرى؛ اترك التأكيد غير محدد ما لم تتحقق من مصدرها.", "Primary or foreign IDs may refer to different records in another database; leave unchecked unless you have verified their source.")}</small></span>
            </label>}
            <div className="transfer-password-note"><ShieldCheck size={15} /><span>{tr("عند استيراد مستخدمين جدد، يحفظ الخادم تجزئة كلمة مرور عشوائية غير قابلة للاستخدام ويلزم تغييرها؛ يعيّن المسؤول كلمة صالحة من إدارة المستخدمين. لا تُستورد كلمات مرور المستخدمين الحاليين ولا تُصدّر أو تُحدّث.", "For new users, the server stores a random, unusable password hash and requires a change; an admin sets a usable password in user management. Existing users’ passwords are never imported, exported or updated.")}</span></div>
            <div className="transfer-import-target"><span>{tr("جدول الوجهة", "Target table")}</span><strong>{language === "ar" ? targetTable.labelAr : targetTable.labelEn}</strong><code className="mono">{targetTable.name}</code></div>
            <div className="transfer-flow-grid" style={{ marginTop: 14 }}>
              <div className="transfer-field"><label htmlFor="transfer-file-table">{tr("جدول المصدر في الملف", "Source table in file")}</label><select id="transfer-file-table" value={fileTableName} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => { rememberCurrentMapping(); clearWorkflow(); setFileTableName(event.target.value); }}>
                {file.tables.map((table) => <option key={table.name} value={table.name}>{table.name} · {table.rows.length} {tr("صف", "rows")}</option>)}
              </select></div>
              <div className="transfer-field"><label>{tr("تنسيق الملف", "File format")}</label><div className="transfer-file-type">{fileName.split(".").pop()?.toUpperCase() || tr("ملف", "File")}</div></div>
            </div>
            {selectedFileTable && <div style={{ marginTop: 14 }}>
              <div className="panel-head transfer-mapping-heading"><div><strong>{tr("ربط الأعمدة", "Column mapping")}</strong><small className="cell-sub">{tr("تم اقتراح المطابقة الدقيقة غير الملتبسة فقط؛ الحقل الفارغ يتجاوز العمود.", "Only exact, unambiguous matches are suggested; an empty target skips the column.")}</small></div></div>
              <div className="transfer-mapping-list">
                {selectedFileTable.headers.map((header) => <div className="transfer-mapping-row" key={header}>
                  <code>{header}</code><ArrowLeftRight className="transfer-map-arrow" size={15} />
                  <select aria-label={`${tr("وجهة العمود", "Column target")} ${header}`} value={mappingColumns[header] || ""} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => { clearWorkflow(); setMappingColumns((current) => ({ ...current, [header]: event.target.value })); }}>
                    <option value="">{tr("تجاوز هذا العمود", "Skip this column")}</option>
                    {targetTable.columns.filter((column) => column.writable && !column.generated).map((column) => {
                      const foreignNumeric = file.source === "external" && targetTable.relations.some((relation) => relation.columns.includes(column.name)) && /int|numeric|serial|bigint/i.test(column.type);
                      const localIdConfirmationNeeded = foreignNumeric && !confirmLocalIds;
                      return <option key={column.name} value={column.name} disabled={localIdConfirmationNeeded}>{language === "ar" ? column.labelAr : column.labelEn} · {column.name}{localIdConfirmationNeeded ? ` — ${tr("يتطلب تأكيد المعرّفات المحلية", "requires local-ID confirmation")}` : ""}</option>;
                    })}
                  </select>
                </div>)}
              </div>
              <div className="transfer-flow-grid" style={{ marginTop: 12 }}>
                <div className="transfer-field"><label htmlFor="transfer-key">{tr("مفتاح مطابقة السجلات الموجودة", "Existing-row match key")}</label>
                  <select id="transfer-key" value={JSON.stringify(matchKey)} disabled={!targetTable.keys.length || busy !== "" || Boolean(pendingApply.current)} onChange={(event) => { clearWorkflow(); setMatchKey(JSON.parse(event.target.value) as string[]); }}>
                    {targetTable.keys.map((key) => <option key={key.join("|")} value={JSON.stringify(key)}>{key.join(" + ")}</option>)}
                    {!targetTable.keys.length && <option value="[]">{tr("بدون مفتاح فريد", "No unique key")}</option>}
                  </select>
                  <small>{targetTable.keys.length ? tr("تُطابق السجلات الموجودة بهذا المفتاح؛ يمكن ترك المعرّفات المولّدة تلقائياً فارغة للصفوف الجديدة.", "This key matches existing rows; autogenerated IDs may be omitted for new rows.") : tr("هذا الجدول للإدراج فقط لأن ليس له مفتاح فريد؛ يمكن ترك المعرّفات المولّدة تلقائياً فارغة للصفوف الجديدة.", "This table is insert-only because it has no unique key; autogenerated IDs may be omitted for new rows.")}</small>
                </div>
                <div className="transfer-field"><label>{tr("السماح بمسح قيمة صراحةً", "Explicitly allow clearing values")}</label>
                  <div className="transfer-null-box">{targetTable.columns.filter((column) => column.writable && column.nullable && !column.generated).map((column) => <label className="transfer-null-option" key={column.name}>
                    <input type="checkbox" checked={nullColumns.includes(column.name)} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => { clearWorkflow(); setNullColumns((current) => event.target.checked ? [...current, column.name] : current.filter((name) => name !== column.name)); }} />
                    {language === "ar" ? column.labelAr : column.labelEn} <code>{column.name}</code>
                  </label>)}</div>
                  <small>{tr("القيم الفارغة تتجاوز افتراضياً؛ المسح ممكن فقط للأعمدة المختارة هنا.", "Blank values are skipped by default; clearing is possible only for columns selected here.")}</small>
                </div>
              </div>
              <div className="transfer-template-row">
                <select aria-label={tr("القوالب المتوافقة", "Compatible templates")} value={selectedTemplate} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => setSelectedTemplate(event.target.value)}>
                  <option value="">{tr("استخدام قالب محفوظ…", "Use a saved template…")}</option>
                  {compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                <button type="button" className="btn btn-muted" onClick={useTemplate} disabled={!selectedTemplate || busy !== "" || Boolean(pendingApply.current)}><ChevronDown size={15} />{tr("تطبيق القالب", "Apply template")}</button>
                <input aria-label={tr("اسم القالب", "Template name")} placeholder={tr("اسم القالب", "Template name")} value={templateName} disabled={busy !== "" || Boolean(pendingApply.current)} onChange={(event) => setTemplateName(event.target.value)} />
                <button type="button" className="btn btn-muted" onClick={() => void saveTemplate()} disabled={!templateName.trim() || busy !== "" || Boolean(pendingApply.current)}><Save size={15} />{tr("حفظ الربط", "Save mapping")}</button>
                <button type="button" className="btn btn-primary" onClick={() => {
                  rememberCurrentMapping();
                  const mapping = currentMapping();
                  if (mapping) void createPreview(mapping);
                }} disabled={!targetTable || !selectedFileTable || (file.source === "external" && !confirmLocalIds) || busy !== "" || Boolean(pendingApply.current)}>
                  <FileSpreadsheet size={16} />{busy === "preview" ? tr("جارٍ إعداد المعاينة…", "Preparing preview…") : tr("معاينة الاستيراد", "Preview import")}
                </button>
              </div>
            </div>}
          </div>
        </section>}

        {preview && <section className="panel transfer-section" aria-live="polite">
          <div className="panel-head"><div><div className="eyebrow">{preview.kind === "restore" ? tr("معاينة الاستعادة", "RESTORE PREVIEW") : tr("قبل التطبيق", "REVIEW BEFORE APPLY")}</div><h3>{tr("مراجعة الصفوف والتغييرات", "Review rows and changes")}</h3><p>{tr("انتهاء المعاينة:", "Preview expires:")} {dateLabel(preview.expiresAt, language)} · <code className="mono">{preview.id}</code></p></div><button type="button" className="btn btn-muted" onClick={() => { if (pendingApply.current) return; setPreview(null); setApprovals({}); setConfirmAdminGrants(false); }} disabled={busy !== "" || Boolean(pendingApply.current)}><X size={15} />{tr("إغلاق", "Close")}</button></div>
          {(() => { const c = counts(preview.rows); return <div className="transfer-preview-summary">
            <strong>{numberLabel(preview.rows.length, language)} {tr("صف", "rows")}</strong>
            <span className="transfer-status transfer-status--new">{tr("جديد", "New")} · {numberLabel(c.new, language)}</span>
            <span className="transfer-status transfer-status--existing">{tr("موجود", "Existing")} · {numberLabel(c.existing, language)}</span>
            <span className="transfer-status transfer-status--conflict">{tr("تعارض", "Conflict")} · {numberLabel(c.conflict, language)}</span>
            <span className="transfer-status transfer-status--invalid">{tr("غير صالح", "Invalid")} · {numberLabel(c.invalid, language)}</span>
            {preview.kind === "restore" && <span className="transfer-chip transfer-chip--muted">{tr("إدراجات محتفظ بها", "Retained inserts")}: {numberLabel(preview.retainedInserts || 0, language)}</span>}
          </div>; })()}
          {(preview.rows.some((row) => row.status === "invalid" || row.status === "conflict")) && <div className="transfer-callout" style={{ margin: 12 }}><AlertTriangle size={16} /><span>{tr("يوجد تعارض أو صف غير صالح؛ يمنع التطبيق بالكامل حتى إنشاء معاينة سليمة.", "A conflict or invalid row blocks the entire apply until a clean preview is created.")}</span></div>}
          <div className="transfer-preview-list">
            {preview.rows.map((row) => {
              const selected = approvals[row.index] || [];
              const isBlocked = row.status === "invalid" || row.status === "conflict";
              const rowChanges = row.status === "new" ? Object.entries(row.values).map(([column, value]) => ({ column, old: null, new: value })) : row.changes;
              return <article key={`${row.table}-${row.index}`} className="transfer-preview-row">
                <div className="transfer-preview-row__head">
                  <strong><code className="mono">{row.table}</code> · {tr("صف", "Row")} {numberLabel(row.index + 1, language)}</strong>
                  <span className={`transfer-status transfer-status--${row.status}`}>{statusLabel(row.status)}</span>
                  {!isBlocked && row.status === "new" && <small>{tr("يُضاف عند تأكيد السجلات الجديدة", "Added when new additions are confirmed")}</small>}
                </div>
                {rowChanges.length > 0 && <div className="transfer-diffs">
                  {rowChanges.map((diff) => <div className="transfer-diff" key={diff.column}>
                    {row.status === "existing" && !isBlocked ? <label className="transfer-row-approval"><input type="checkbox" checked={selected.includes(diff.column)} onChange={(event) => toggleApproval(row, diff.column, event.target.checked)} />{tr("تطبيق", "Apply")}</label> : <strong>{language === "ar" ? targetTable?.columns.find((column) => column.name === diff.column)?.labelAr || diff.column : targetTable?.columns.find((column) => column.name === diff.column)?.labelEn || diff.column}</strong>}
                    <code>{diff.column}</code>
                    <div className="transfer-diff__value">{diff.old === null ? tr("— لا قيمة سابقة —", "— no previous value —") : diff.old}</div>
                    <div className="transfer-diff__value transfer-diff__value--new">{diff.new === null ? tr("NULL", "NULL") : diff.new}</div>
                  </div>)}
                </div>}
                {row.errors.length > 0 && <ul className="transfer-row-errors">{row.errors.map((item, index) => {
                  const message = knownErrorMessage(item.message, tr);
                  return <li key={`${item.column}-${index}`}><code>{item.column}</code>: {message || tr("تعذر التحقق من هذه القيمة", "This value could not be validated")} <details><summary>{tr("تفاصيل فنية", "Technical details")}</summary><code dir="ltr">{item.message || "ROW_VALIDATION_ERROR"}</code></details></li>;
                })}</ul>}
              </article>;
            })}
            {preview.rows.length === 0 && <div className="transfer-empty"><strong>{tr("لا توجد صفوف للمعاينة", "No rows to preview")}</strong>{tr("لم يتضمن الملف صفوفاً قابلة للعرض.", "The file contained no rows to display.")}</div>}
          </div>
          {preview.rows.some((row) => row.status === "new") && <label className="check-row" style={{ margin: "0 14px 12px" }}>
            <input type="checkbox" disabled={busy==="apply"||uncertain} checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
            <strong>{tr("أوافق صراحةً على إدراج جميع الصفوف الجديدة في هذه المعاينة", "I explicitly approve inserting all new rows in this preview")}</strong>
          </label>}
          {preview.requiresAdminConfirmation && <label className="check-row transfer-admin-confirm">
            <input type="checkbox" disabled={busy==="apply"||uncertain} checked={confirmAdminGrants} onChange={(event) => setConfirmAdminGrants(event.target.checked)} />
            <span><strong>{tr("أؤكد صراحةً مراجعة تغييرات صلاحيات المسؤول والموافقة عليها", "I explicitly approve the reviewed administrator access changes")}</strong><small>{tr("قد تمنح هذه المعاينة صلاحيات مسؤول أو تزيل وصول المسؤول الحالي؛ تحقق من كل تغيير قبل المتابعة.", "This preview may grant administrator access or remove the current administrator’s access; review every change before proceeding.")}</small></span>
          </label>}
          <div className="transfer-section-body transfer-inline">
            {uncertain&&<p role="alert">{tr("تعذر تأكيد النتيجة. إعادة المحاولة ترسل نفس العملية دون تكرارها.", "Result not confirmed. Retry sends the exact same operation without duplication.")}</p>}
            <button type="button" className="btn btn-primary" onClick={() => void applyPreview()} disabled={busy !== "" || preview.rows.some((row) => row.status === "invalid" || row.status === "conflict") || (preview.rows.some((row) => row.status === "new") && !confirmNew) || (preview.requiresAdminConfirmation && !confirmAdminGrants) || (!preview.rows.some((row) => row.status === "new") && !preview.rows.some((row) => (approvals[row.index]?.length || 0) > 0))}>
              <CheckCircle2 size={16} />{busy === "apply" ? tr("جارٍ التطبيق…", "Applying…") : tr("تطبيق الموافقات المحددة", "Apply selected approvals")}
            </button>
            <span className="muted-text">{tr("سيتم تطبيق التغييرات المحددة فقط. لا تتضمن الاستعادة حذف الإدراجات اللاحقة.", "Only selected changes are applied. Restore never deletes later inserts.")}</span>
          </div>
        </section>}

        <section className="panel transfer-section">
          <div className="panel-head"><div><div className="eyebrow">{tr("سجل العمليات المحمي", "PROTECTED OPERATION LOG")}</div><h3>{tr("العمليات والنسخ الاحتياطية", "Operations and backups")}</h3><p>{tr("التنزيل محمي ويتاح وفق مدة الاحتفاظ المعروضة أعلاه.", "Downloads are protected and available within the retention period shown above.")}</p></div><Clock3 size={20} color="var(--teal)" /></div>
          {busy === "load" && !operations.length ? <div className="transfer-loading"><div className="skeleton" /><div className="skeleton" /></div> : operations.length ? <div className="transfer-operations">
            {operations.map((operation) => <article className="transfer-operation" key={operation.id}>
              <div className="transfer-operation-main"><strong>{operationKind(operation.kind)} · <code className="mono">{operation.id}</code></strong>
                <div className="transfer-operation-meta"><span>{dateLabel(operation.createdAt, language)}</span><span className="tag neutral">{operationStatus(operation.status)}</span>
                  {operation.counts.inserted !== undefined && <span>{tr("مدرج", "Inserted")} {numberLabel(operation.counts.inserted, language)}</span>}
                  {operation.counts.updated !== undefined && <span>{tr("محدّث", "Updated")} {numberLabel(operation.counts.updated, language)}</span>}
                  {operation.counts.rows !== undefined && <span>{tr("صف", "Rows")} {numberLabel(operation.counts.rows, language)}</span>}
                  {operation.backup && <span className="transfer-chip"><FileArchive size={12} />{tr("نسخة احتياطية", "Backup")}</span>}
                </div>
              </div>
              <div className="transfer-toolbar">
                <button type="button" className="btn btn-muted" onClick={async () => { setBusy(`report-${operation.id}`); setError(null); try { await downloadResponse(`/api/data-transfer/operations/${encodeURIComponent(operation.id)}`, `operation-${operation.id}.json`); } catch (e) { setError(localError(e, tr)); } finally { setBusy(""); } }} disabled={busy !== ""}><FileText size={15} />{tr("تنزيل التقرير", "Download report")}</button>
                {operation.backup && <button type="button" className="btn btn-muted" onClick={async () => { setBusy(`backup-${operation.id}`); setError(null); try { await downloadResponse(`/api/data-transfer/backups/${encodeURIComponent(operation.id)}`, `backup-${operation.id}.json`); } catch (e) { setError(localError(e, tr)); } finally { setBusy(""); } }} disabled={busy !== ""}><Download size={15} />{tr("تنزيل النسخة", "Download backup")}</button>}
                 {operation.backup && <button type="button" className="btn btn-danger" onClick={() => void previewRestore(operation)} disabled={busy !== "" || Boolean(pendingApply.current)}><RotateCcw size={15} />{busy === `restore-${operation.id}` ? tr("جارٍ تجهيز الاستعادة…", "Preparing restore…") : tr("معاينة الاستعادة", "Preview restore")}</button>}
              </div>
            </article>)}
          </div> : <div className="transfer-empty"><strong>{tr("لا توجد عمليات مسجلة", "No recorded operations")}</strong>{tr("ستظهر عمليات النقل والنسخ الاحتياطية هنا بعد استخدامها.", "Transfer operations and backups will appear here when available.")}</div>}
        </section>
      </>}
    </div>
  );
}
