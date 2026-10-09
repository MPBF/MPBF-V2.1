---
name: Plastic-roll products skip cutting
description: How HD/LD plastic-roll products bypass the cutting stage and the timestamp-constraint gotcha when finishing a roll at insert time.
---

# Plastic-roll products skip the cutting stage

Plastic-roll products (items such as "رولات بلاستيك HD"/"HD Plastic Roll",
"رولات بلاستيك LD", and "PLASTIC ROLL-1") are finished rolls, not bags, so they
NEVER pass through the cutting board.

- Detection is by ITEM NAME, never category or item_id: SQL
  `i.name ILIKE '%plastic roll%' OR i.name_ar LIKE '%رولات بلاستيك%'`, JS helper
  `isRollProductName(nameEn, nameAr)` in server/storage.ts.
  **Why:** categories CAT08/CAT09 also hold bags that DO need cutting, so a
  category match would wrongly skip cutting for bags; name-based also auto-covers
  future "رولات بلاستيك *"/"plastic roll" items without code edits.
- Workflow: non-printed roll product → film → done (finished the moment the film
  roll is produced). Printed roll product → film → printing → done (finished once
  printed). Both then flow to the production hall (صالة الانتاج). Never cutting.
- A roll reaches stage `done` at the roll level (createRollWithTiming for
  non-printed/inline-printed; markRollAsPrinted for printed). The ORDER's
  production_stage is derived in updateProductionOrderCompletionPercentages /
  backfillProductionOrderStages with a roll-order branch:
  `done` only when filmDone AND every roll is done; else `printing` if filmDone;
  else `film`.
  **Why the filmDone gate matters:** non-printed roll rolls are `done` the instant
  they are created, so `doneRolls===totalRolls` is true after the very first roll.
  Without gating `done` on filmDone (film_completed OR produced≥target), a barely
  started order would jump to `done`/completed and leave the film board early.
- completeCutting never runs for these orders, so status='completed' is set inside
  the percentage-recompute path (and a startup reconciliation mirrors it for
  historical orders — runtime+backfill status parity must be kept in lockstep).

# Gotcha: cut_completed_at >= created_at CHECK when finishing a roll at insert

rolls has CHECK `cut_completed_at IS NULL OR cut_completed_at >= created_at` and
`created_at` is `notNull().defaultNow()`. If you stamp `cut_completed_at = new
Date()` in JS and let `created_at` default, the DB `now()` at insert lands a hair
LATER than the JS timestamp → constraint violation, insert rejected.
**How to apply:** when an insert needs a pre-stamped cut_completed_at/printed_at,
also pin `created_at` (and roll_created_at) to the SAME JS Date so the chain
`created_at ≤ printed_at ≤ cut_completed_at` holds with equality. Updates
(markRollAsPrinted) are safe because created_at already lies in the past.
## Ready-for-receipt weight is the single source of truth (not cut weight)
- Roll products are never cut, so any "ready / remaining to receive" math must use a roll-aware ready weight: roll product => produced (done) roll weight; everything else => done cut weight. Apply this identically in the production-hall view AND in finished-goods receipt voucher validation.
- **Why:** roll rolls migrated to 'done' by startup reconciliation carry cut_weight_total_kg=0 (only freshly created rolls get it = weight_kg). Cut-weight-based remaining then reports "already fully received" and blocks receiving, while the UI still shows a receivable quantity. Keeping both surfaces on the ready-weight formula prevents that mismatch.

## Parent-order auto-completion must cover all PO-completion paths
- An order should flip in_production -> completed once ALL its production orders are completed. This rule must fire from every path that completes a production order, not only the production-order PATCH route. Roll products skip cutting and reach 'completed' via film-progress/recompute and cutting-completion paths, so those paths must also trigger the parent-order check or the order stays stuck at in_production.
- **Why:** the original auto-complete lived only in the routes PATCH handler; roll-product POs never go through it, so their parent orders never auto-completed (e.g. an order with a single done roll-product PO stayed in_production). Centralize the check (load order_id, require all siblings completed, only update when order is still in_production) and call it from each completion path; guard the UPDATE with status='in_production' to avoid a read-then-write race.
