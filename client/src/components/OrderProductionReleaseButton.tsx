import { Factory } from "lucide-react";
import { useRef, useState } from "react";
import { canReleaseOrderToProduction } from "../../../shared/order-production-release";
import { releaseOrderToProduction } from "../lib/order-production-release";
import { translate, translateError } from "../i18n";
import "./OrderProductionReleaseButton.css";

export default function OrderProductionReleaseButton({ id, status, enabled, onReleased }: {
  id: number; status: unknown; enabled: boolean; onReleased: () => void;
}) {
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const savingRef = useRef(false);
  if (!enabled || !canReleaseOrderToProduction(status)) return null;
  const release = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await releaseOrderToProduction(id, status);
      onReleased();
    } catch (cause) {
      setError(translateError(cause instanceof Error ? cause.message : "تعذر تحويل الطلب إلى الإنتاج."));
    } finally { savingRef.current = false; setSaving(false); }
  };
  return <span className="order-release-action">
    <button type="button" className="btn btn-muted order-release-button" disabled={saving} onClick={() => void release()}>
      <Factory size={16} aria-hidden="true"/>{translate(saving ? "جارٍ التحويل…" : "تحويل للإنتاج")}
    </button>
    {error && <span className="order-release-error" role="alert">{error}</span>}
  </span>;
}