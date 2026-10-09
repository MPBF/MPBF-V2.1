type NumericDisplayValue = string | number | null | undefined;

/** Display only: Latin digits, grouped thousands, up to two meaningful decimals. */
export function formatNumber(value: NumericDisplayValue): string {
  return formatNumericValue(value, 2);
}

/** Integer presentation only; never use the output as an input or saved value. */
export function formatWholeNumber(value: NumericDisplayValue): string {
  return formatNumericValue(value, 0);
}

function formatNumericValue(value: NumericDisplayValue, maximumFractionDigits: number): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(numeric)
    : "—";
}