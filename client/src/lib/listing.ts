import { translate } from "../i18n";

export const LIST_PAGE_SIZE = 200;

export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = LIST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset, pageSize);
    if (!Array.isArray(page)) throw new Error(translate("تعذر تحميل قائمة البيانات"));
    if (page.length > pageSize) throw new Error(translate("أعاد الخادم صفحة أكبر من الحد المطلوب"));
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
  }
}

export function createLatestRequestGate() {
  let currentRequest = 0;

  return {
    begin() {
      currentRequest += 1;
      return currentRequest;
    },
    isCurrent(request: number) {
      return request === currentRequest;
    },
    invalidate() {
      currentRequest += 1;
    },
  };
}

type LatestRequestHandlers<T> = {
  onSuccess: (value: T) => void;
  onError: (error: Error) => void;
  onSettled?: () => void;
};

export async function runLatestRequest<T>(
  gate: ReturnType<typeof createLatestRequestGate>,
  request: number,
  operation: Promise<T>,
  handlers: LatestRequestHandlers<T>,
): Promise<void> {
  try {
    const value = await operation;
    if (gate.isCurrent(request)) handlers.onSuccess(value);
  } catch (error) {
    if (gate.isCurrent(request)) {
      handlers.onError(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    if (gate.isCurrent(request)) handlers.onSettled?.();
  }
}