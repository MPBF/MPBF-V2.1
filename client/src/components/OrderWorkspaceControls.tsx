import { useState, type ReactNode } from "react";
import { Check, ChevronDown, MoreHorizontal, MoveRight } from "lucide-react";
import { canApplyOrderAction, type OrderDisplayFolder, type OrderWorkspaceAction } from "../../../shared/order-workspace";
import { ORDER_FOLDER_KEYS, ORDER_FOLDER_LABELS } from "../lib/order-workspace";
import { translate } from "../i18n";
import "./OrderWorkspaceControls.css";

export type WorkspaceOrder = { id: number; status: string; display_folder?: OrderDisplayFolder };
type Props = {
  rows: WorkspaceOrder[];
  folder: OrderDisplayFolder | "all";
  counts: Record<OrderDisplayFolder, number>;
  selected: number[];
  canManage: boolean;
  canDelete?: boolean;
  busy?: boolean;
  error?: string;
  searchControl?: ReactNode;
  onFolderChange: (folder: OrderDisplayFolder | "all") => void;
  onSelectPage: (checked: boolean) => void;
  onClear: () => void;
  onAction: (action: OrderWorkspaceAction, items: { id: number; expected_status: string }[]) => Promise<void>;
  onMove: (folder: OrderDisplayFolder, items: { id: number; expected_folder: OrderDisplayFolder }[]) => Promise<void>;
  onDelete?: (items: { id: number; expected_status: string }[]) => Promise<void>;
};

const confirmAction = (action: OrderWorkspaceAction, count: number) => {
  if (action === "release") return true;
  const message = action === "pause"
    ? "سيؤدي الإيقاف المؤقت إلى وقف تنفيذ الطلب، دون حذف الطلب أو أوامر الإنتاج المرتبطة به."
    : "تحذير: الإلغاء يوقف التنفيذ ولا يحذف الطلب، لكنه إجراء تشغيلي لا يمكن التراجع عنه من هذه القائمة.";
  return window.confirm(`${translate(action === "pause" ? "تأكيد الإيقاف المؤقت؟" : "تأكيد إلغاء الطلب؟")}\n\n${translate(message)}\n\n${count}`);
};

function available(rows: WorkspaceOrder[], action: OrderWorkspaceAction) {
  return rows.filter((row) => canApplyOrderAction(row.status, action));
}

export function OrderSelectionBox({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="order-row-select"><input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

export function OrderRowActionMenu({ row, enabled, onAction }: { row: WorkspaceOrder; enabled: boolean; onAction: (action: OrderWorkspaceAction, items: { id: number; expected_status: string }[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const perform = async (action: OrderWorkspaceAction) => {
    if (!enabled || !canApplyOrderAction(row.status, action) || !confirmAction(action, 1)) return;
    await onAction(action, [{ id: row.id, expected_status: row.status }]);
    setOpen(false);
  };
  return <details className="order-row-menu" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="btn btn-plain" aria-label={translate("إجراء على الطلب")} title={translate("إجراء على الطلب")}><MoreHorizontal size={17} /><ChevronDown size={13} /></summary>
    <div className="order-row-menu__items" role="group" aria-label={translate("إجراء على الطلب")}>
      <button type="button" disabled={!enabled || !canApplyOrderAction(row.status, "release")} onClick={() => void perform("release")}>{translate("إطلاق للإنتاج")}</button>
      <button type="button" disabled={!enabled || !canApplyOrderAction(row.status, "pause")} onClick={() => void perform("pause")}>{translate("إيقاف مؤقت")}</button>
      <button type="button" className="danger-action" disabled={!enabled || !canApplyOrderAction(row.status, "cancel")} onClick={() => void perform("cancel")}>{translate("إلغاء الطلب")}</button>
    </div>
  </details>;
}

export default function OrderWorkspaceControls(props: Props) {
  const [target, setTarget] = useState<OrderDisplayFolder>("production");
  const selectedRows = props.rows.filter((row) => props.selected.includes(row.id));
  const pageSelected = props.rows.length > 0 && props.rows.every((row) => props.selected.includes(row.id));
  const overLimit = props.selected.length > 100;
  const runAction = async (action: OrderWorkspaceAction) => {
    const eligible = available(selectedRows, action);
    if (!eligible.length || eligible.length !== selectedRows.length || !confirmAction(action, eligible.length)) return;
    await props.onAction(action, selectedRows.map((row) => ({ id: row.id, expected_status: row.status })));
  };
  const move = async () => {
    if (!selectedRows.length) return;
    await props.onMove(target, selectedRows.map((row) => ({ id: row.id, expected_folder: row.display_folder || "new" })));
  };
  const remove = async () => {
    if (!props.canDelete || !props.onDelete || props.busy || overLimit || !selectedRows.length
      || selectedRows.length !== props.selected.length) return;
    const warning = "تأكيد حذف الطلبات المحددة نهائيًا؟ سيتم حذف جميع أوامر الإنتاج والرولات والاستلامات وحركات وأرصدة المخزون المرتبطة بها. الاستلامات المشتركة ستحتفظ ببنود الطلبات الأخرى. لا يمكن التراجع عن هذا الحذف. إذا تعذر حذف أي طلب فلن يُحذف أي منها.";
    if (!window.confirm(`${translate(warning)}\n\n${translate("عدد الطلبات المحددة")}: ${selectedRows.length}`)) return;
    await props.onDelete(selectedRows.map((row) => ({ id: row.id, expected_status: row.status })));
  };
  return <div className="order-workspace">
    <div className="order-workspace__filters">
      <nav className="order-workspace__folders" aria-label={translate("مجلدات العرض المشتركة")}>
      <button type="button" className="order-workspace__folder" aria-current={props.folder === "all" ? "page" : undefined} onClick={() => props.onFolderChange("all")}>{translate("الكل")}<span className="order-workspace__count">{props.counts.new + props.counts.production + props.counts.urgent + props.counts.archive}</span></button>
      {ORDER_FOLDER_KEYS.map((key) => <button type="button" key={key} className="order-workspace__folder" aria-current={props.folder === key ? "page" : undefined} onClick={() => props.onFolderChange(key)}>{translate(ORDER_FOLDER_LABELS[key])}<span className="order-workspace__count">{props.counts[key]}</span></button>)}
      </nav>
      {props.searchControl}
    </div>
    <p className="order-workspace__note">{translate("الطلبات غير المعيّنة تظهر في مجلد جديد افتراضياً. المجلدات لا تغيّر حالة الطلب.")}</p>
    {props.canManage && props.selected.length > 0 && <div className="order-workspace__toolbar">
      <label className="order-workspace__selection"><input type="checkbox" checked={pageSelected} onChange={(event) => props.onSelectPage(event.target.checked)} aria-label={translate("حدد الصفحة الحالية")} />{translate("حدد الصفحة الحالية")}<span className="order-workspace__selection-count">{props.selected.length}</span><span>{translate("طلبات محددة")}</span></label>
      {props.selected.length > 0 && <button className="btn btn-muted" type="button" onClick={props.onClear}>{translate("إلغاء التحديد")}</button>}
      <select aria-label={translate("نقل إلى مجلد")} value={target} onChange={(event) => setTarget(event.target.value as OrderDisplayFolder)} disabled={props.busy || props.selected.length === 0}>
        {ORDER_FOLDER_KEYS.map((key) => <option key={key} value={key}>{translate(ORDER_FOLDER_LABELS[key])}</option>)}
      </select>
      <button className="btn btn-muted" type="button" disabled={props.busy || props.selected.length === 0 || overLimit} onClick={() => void move()}><MoveRight size={15} />{translate("نقل الطلبات المحددة")}</button>
      <details className="order-row-menu">
        <summary className="btn btn-primary"><Check size={15} />{translate("إجراءات جماعية")}<ChevronDown size={13} /></summary>
        <div className="order-row-menu__items" role="group" aria-label={translate("إجراءات جماعية")}>
          <button type="button" disabled={props.busy || overLimit || !selectedRows.length || available(selectedRows, "release").length !== selectedRows.length} onClick={() => void runAction("release")}>{translate("إطلاق للإنتاج")}</button>
          <button type="button" disabled={props.busy || overLimit || !selectedRows.length || available(selectedRows, "pause").length !== selectedRows.length} onClick={() => void runAction("pause")}>{translate("إيقاف مؤقت")}</button>
          <button type="button" className="danger-action" disabled={props.busy || overLimit || !selectedRows.length || available(selectedRows, "cancel").length !== selectedRows.length} onClick={() => void runAction("cancel")}>{translate("إلغاء الطلب")}</button>
          {props.canDelete && props.onDelete && <button type="button" className="danger-action" disabled={props.busy || overLimit || !selectedRows.length || selectedRows.length !== props.selected.length} onClick={() => void remove()}>{translate("حذف الطلبات المحددة")}</button>}
        </div>
      </details>
    </div>}
    {props.canManage && overLimit && <p className="order-workspace__error" role="status">{translate("لا يمكن تنفيذ إجراء على أكثر من 100 طلب في العملية الواحدة.")}</p>}
    {props.error && <div className="error order-workspace__error" role="alert">{props.error}</div>}
  </div>;
}