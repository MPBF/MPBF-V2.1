import { useId } from "react";
import { localizedName, translate } from "../i18n";
import { isTransparentMasterBatch, type MasterBatchColor } from "../lib/master-batch-color";
import "./MasterBatchSwatch.css";

type Props = { color?: MasterBatchColor | null; size?: number; className?: string; label?: string };

export default function MasterBatchSwatch({ color, size = 24, className = "", label }: Props) {
  const id = `master-batch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const transparent = isTransparentMasterBatch(color);
  const hex = typeof color?.color_hex === "string" && color.color_hex.trim() ? color.color_hex.trim() : "#ffffff";
  const title = label || localizedName(
    typeof color?.name_ar === "string" ? color.name_ar : undefined,
    typeof color?.name === "string" ? color.name : undefined,
    translate(transparent ? "شفاف" : "عينة اللون"),
  );
  return <svg className={`master-batch-swatch ${className}`.trim()} width={size} height={size}
    viewBox="0 0 32 32" role="img" aria-label={title} data-transparent={transparent ? "true" : "false"}>
    <title>{title}</title>
    {transparent && <defs><pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#ffffff" />
      <path d="M 0 0 L 0 6" stroke="#000000" strokeWidth="1.5" />
    </pattern></defs>}
    <circle cx="16" cy="16" r="15" fill={transparent ? `url(#${id})` : hex} stroke="#687872" strokeWidth="1" />
  </svg>;
}