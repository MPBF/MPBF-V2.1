import type { AttendanceAuditEvent, AttendanceAuditGroup } from "./hr-audit-grouping";
import { resolveCorrectionTimes, type CorrectionAction } from "./hr-correction-time";

export type BulkCorrectionTimes = Record<CorrectionAction, string>;
const actions: CorrectionAction[] = ["check_in", "break_start", "break_end", "check_out"];

/** Replace all four times, binding IDs and local dates independently for every selected shift. */
export function buildBulkCorrections<T extends AttendanceAuditEvent & { updated_at: string }, E>(
  groups: AttendanceAuditGroup<T, E>[], times: BulkCorrectionTimes,
) {
  if (!groups.length || groups.length > 100) throw new Error("حدد من سجل واحد إلى 100 سجل.");
  if (actions.some((action) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(times[action]))) {
    throw new Error("أكمل الأوقات الأربعة للتصحيح الجماعي.");
  }
  return groups.map((group) => {
    if (actions.some((action) => group.events.filter((entry) => entry.action === action).length > 1)) {
      throw new Error(`يتطلب السجل بتاريخ ${group.shift_date} مراجعة الحركات المكررة.`);
    }
    const rows = actions.map((action) => {
      const original = group.events.find((entry) => entry.action === action);
      return { action, time: times[action], ...(original ? { id: original.id } : {}) };
    });
    const resolved = resolveCorrectionTimes(rows, group.shift_date, group.events);
    return {
      session_id: group.events[0]?.session_id ?? null,
      user_id: group.user_id,
      shift_date: group.shift_date,
      expected_events: group.events.map(({ id, updated_at }) => ({ id, updated_at })),
      events: rows.map(({ action, id }) => ({ ...(id ? { id } : {}), action, occurred_at: resolved[action]! })),
    };
  });
}
