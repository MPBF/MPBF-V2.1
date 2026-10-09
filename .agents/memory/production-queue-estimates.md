---
name: Production queue finish estimates
description: How the Production Queues board estimates per-machine finish time/date
---

# Production queue finish estimates (getProductionQueueBoard)

The per-machine finish estimate must reflect three real inputs, not flat assumptions:

- **Shift hours** come from `company_profile.working_hours_per_day` (fallback 20 only when unset). Do NOT reintroduce a hardcoded HOURS_PER_DAY.
- **Throughput is size-appropriate per order**, not one blended machine rate. `machineRateForWidth()` picks small/medium/large capacity from the product `width` (cm) via thresholds (small `<30`, large `>=60`, else medium), falling back to the medium/average rate when width or that capacity is missing. estimatedHours is summed per order.
- **Machine status gates the finish date**: only `status='active'` machines get a `projectedFinish`; maintenance/down still report work hours/days but `projectedFinish=null` and `stats.available=false`.

**Why:** width->size cutoffs are constants because no configurable size-bucket table exists (calibrated to data: width 10-125cm, median ~36). Maintenance has no stored return date on machines, so it is treated as "not producing now" rather than offset by a return date.

**How to apply:** if adding maintenance-return-date offsets or configurable size cutoffs, update `machineRateForWidth` / the availability block in `server/storage.ts` and keep `stats.available`/`hoursPerDay` in the payload (consumed by `client/src/pages/ProductionQueues.tsx`).
