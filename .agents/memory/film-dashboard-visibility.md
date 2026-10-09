---
name: Film operator dashboard visibility
description: Why film-operator order visibility must key on production_stage, not just the film_completed flag.
---

# Film operator dashboard visibility

The film operator dashboard query (`getActiveProductionOrdersForOperator`) must filter on `production_stage = 'film'`, not only on `film_completed=false AND is_final_roll_created=false`.

**Why:** `film_completed` and `is_final_roll_created` are set ONLY by the "Final Roll" (رول نهائي) button. Regular rolls never set them, even when the produced weight reaches the target. Meanwhile `production_stage` auto-advances (in `updateProductionOrderCompletionPercentages`) to `printing`/`cutting`/`done` once roll weights reach the target. So orders that hit full quantity via regular rolls linger forever in the film dashboard unless the stage filter is applied. This had stuck 14 live orders at once.

**How to apply:** Any film-operator-specific listing should include `production_stage = 'film'`. Do NOT apply this to `/api/production/active-by-machine/:machineId` — that endpoint is shared by film/printing/cutting dashboards (keyed by machine) and is intentionally cross-stage. `production_stage` is NOT NULL DEFAULT 'film', so new orders with no rolls stay visible.

## Printing & cutting operator queues are roll-based, not stage-gated

The printing (`getActivePrintingRollsForOperator`) and cutting (`getActiveCuttingRollsForOperator`) queues key off ROLL `stage` + the product's `is_printed` flag, NOT `production_stage`. Printing shows `stage='film' AND is_printed=true`; cutting shows `stage='printing' OR (stage='film' AND is_printed=false)`. So a non-printed product's rolls appear in cutting from the moment they're created in film (parallel processing, not a strict film→printing→cutting pipeline). This means an order can be in the film panel AND the cutting panel at once, and once film completes it simply stays in cutting.

**Why:** A user reported a completed non-printed order "didn't appear" in cutting after leaving the film panel — it was actually present but buried at the bottom of a ~69-order list. These queues order newest-first (`ORDER BY po.id DESC, r.roll_seq`) so recently completed/active orders surface at the top; JS grouping uses a `Map` so SQL order is preserved. If a non-printed order is expected in printing, the fix is the product's `is_printed` flag (data), not code.
