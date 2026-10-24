import { translateError } from "../i18n";

/** Shared transport for the HR pages; retain their existing response/error contract. */
export const hrApi = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api/hr${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateError(body.message || "تعذر تنفيذ الطلب"));
  return body as T;
};
