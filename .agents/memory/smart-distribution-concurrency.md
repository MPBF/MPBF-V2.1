---
name: Smart distribution concurrency
description: Why machine-queue smart-distribution apply uses a per-stage advisory lock and not unique constraints.
---

Rule: The smart-distribution *apply* path (assigning unassigned backlog to machines for a
production stage) must run inside a single transaction that first acquires a stage-scoped
`pg_advisory_xact_lock(hashtext('smart_distribute_' || stage))`, and must read both the
unassigned backlog and `MAX(queue_position)` *inside* that locked transaction (not before it).

**Why:** Preview and apply share one pure compute function. If apply computes the backlog and
positions before/outside the transaction, two concurrent applies for the same stage both see the
same unassigned orders and the same max position, then both insert — producing duplicate order
assignments and colliding queue positions. The advisory lock serializes appliers per stage so the
second waits for the first to commit and then recomputes against fresh committed state.

**How to apply:** Acquire the advisory lock as the first statement in the transaction, then call the
compute function, then read positions, then insert — all within the same `db.transaction`. Reads via
the pooled `db` connection inside the lock are fine because appliers are serialized.

Do NOT add a global unique index on `machine_queues.production_order_id`: an order legitimately
appears in queues for multiple stages at once (queues are filtered by machine type per stage), so a
global uniqueness constraint would break multi-stage queueing.

The bulk "clear distribution" (إلغاء الفرز) path that unassigns ALL machines of a stage at once must
reuse the EXACT same per-stage advisory lock key (`hashtext('smart_distribute_' || stage)`) inside its
own transaction. **Why:** a clear and a distribute-apply for the same stage must serialize, or a clear
could delete rows an in-flight apply is mid-insert against (or vice versa). Reusing the identical key
makes them mutually exclusive per stage. Stages target machines by type set (`getStageInfo().machineTypes`
via `machineTypeMatchSql`), not a stage column, so the delete filters on machine type, not on stage.
