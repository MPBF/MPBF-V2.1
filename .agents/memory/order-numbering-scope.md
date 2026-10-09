---
name: Order-numbering scope
description: New orders restart at O0001 with JO01/R01 children; historical identifiers remain unchanged.
---

The user requested `O0001`, `O0001-JO01`, and `O0001-JO01-R01` for new
customer orders only. They chose «البدء من O0001 مع منع تكرار الأرقام»,
not continuation of the historical numeric maximum. Production orders restart
at JO01 per parent order; rolls restart at R01 per production order.
Existing orders and new children/rolls attached to historical orders retain
their previous numbering conventions.

**Why:** the user explicitly approved starting a new series while preserving
existing records and preventing duplicate identifiers.

**How to apply:** retain legacy identifiers in history, screens and printing.
Do not migrate or replace them with display-only aliases during future numbering
changes without separate approval.

Do not reuse a successfully assigned new-series order number after its order
is deleted. A failed order creation must not consume its reservation.

**Why:** these numbers identify printed production and roll documents; reusing
one can associate an old label with a different order.

**How to apply:** retain numbering reservations independently of business-data
deletion, and commit them atomically with successful order creation.

The customer-order form shows a read-only preview of the next available
number. Opening or cancelling the form must not reserve or consume a number.
The save transaction remains authoritative, so another user's intervening
save can change the final assigned number.

**Why:** displaying a number should not create order records or consume
identifiers for abandoned drafts.

**How to apply:** do not turn number previews into reservations without
separate approval; retain concurrency-safe allocation at save time.
