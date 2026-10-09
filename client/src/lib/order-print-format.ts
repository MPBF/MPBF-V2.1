import { formatNumber } from "./format-number";

/** Print-only rounding. Never pass these display strings back into calculations. */
export function printNumberText(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "—";
  if (typeof value === "string" && value.trim() === "") return "—";
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  // Half away from zero, including negative historical adjustments.
  const rounded = Math.sign(numeric) * Math.round(Math.abs(numeric));
  return formatNumber(rounded === 0 ? 0 : rounded);
}

/** Round quantitative tokens, retaining dimension separators and annotations. */
export function printDimensionText(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "—";
  const text = String(value).trim();
  const tokens = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g;
  if (!tokens.test(text)) return "—";
  tokens.lastIndex = 0;
  return text.replace(tokens, token => printNumberText(token));
}