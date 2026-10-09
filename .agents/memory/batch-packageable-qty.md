---
name: Batch packageable quantity resolution
description: net_quantity_kg is never persisted; how to derive the quantity used for batch/packaging labels.
---

# Packageable quantity for batch labels

`production_orders.net_quantity_kg` is never written by the app — it stays `0`
even for fully completed orders. Only `produced_quantity_kg` (sum of roll
weights, updated as rolls are produced/cut) and `final_quantity_kg` hold real
values; `quantity_kg` is the ordered amount.

**Why:** batch/packaging label count = `ceil(packageableKg / packagingUnitWeight)`
(last unit shows the remainder). If you trust `net_quantity_kg` directly you get
0 labels and nothing prints — this was a real bug.

**How to apply:** resolve the packageable weight as the first positive of
`net_quantity_kg -> produced_quantity_kg -> final_quantity_kg -> quantity_kg`
(see `resolvePackageableKg` in storage). Use that everywhere batch label/
traceability data is built, never raw `net_quantity_kg`.

## Labels print for in-progress orders, not just completed

Batch-label data generation is intentionally NOT gated on completion: workers
print packaging labels while packing, so operator boards (film/cutting) show
the label button on active orders and the data endpoint serves them using the
produced-so-far weight from `resolvePackageableKg`.

**Why:** the operator-board feeds only ever contain in-progress orders; a
completion-only guard made the buttons unreachable/4xx. The batch number is
generated on first print and is idempotent, so printing early is safe.

**How to apply:** the completion policy lives in the UI button gating, not the
backend. Today's Production / management surfaces gate the *button* on
done/completed; operator boards do not. Don't re-add a completion guard inside
the shared label-data path or you break mid-production printing.
