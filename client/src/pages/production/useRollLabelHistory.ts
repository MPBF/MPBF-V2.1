import { useEffect, useState } from "react";
import type { ProductionHistoryPage } from "../../../../shared/production";
import { productionApi } from "../../lib/production-api";

// Label discovery is independent of active work boards. Keep only one bounded
// page in memory; selected IDs are owned by the control and survive paging.
export function useRollLabelHistory(enabled: boolean, refresh: unknown, language: string) {
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const before = cursors[cursors.length - 1];
  const [page, setPage] = useState<ProductionHistoryPage<"rolls"> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true); setPage(null); setError("");
    productionApi.labelPage({ search: search || undefined, before, limit: 50 })
      .then(result => { if (alive) setPage(result); })
      .catch(cause => {
        if (alive) setError(cause instanceof Error ? cause.message :
          language === "en" ? "Rolls could not be loaded." : "تعذر تحميل الرولات.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled, search, before, attempt, refresh, language]);
  return {
    page, loading, error, pageNumber: cursors.length,
    retry: () => setAttempt(value => value + 1),
    search: (value: string) => {
      setPage(null); setLoading(true);
      setSearch(value.trim()); setCursors([undefined]); setAttempt(value => value + 1);
    },
    previous: () => {
      setPage(null); setLoading(true);
      setCursors(value => value.length > 1 ? value.slice(0, -1) : value);
    },
    next: () => {
      if (page?.next != null) {
        const cursor = page.next;
        setPage(null); setLoading(true);
        setCursors(value => [...value, cursor]);
      }
    },
  };
}