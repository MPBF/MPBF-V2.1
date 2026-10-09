---
name: Roll creation transaction & lock ordering
description: Why roll-create paths must share one transaction and a single lock order; avoids an undetectable hang.
---

# Roll creation: transactions and lock ordering

## Rule
All roll-creation work for a production order (overrun check, sequence lookup, INSERT, advisory lock) must run on **one** transaction/connection, and every code path must acquire locks in the same order: **advisory lock first, then the production_orders row lock**.

`storage.createRollWithTiming(data, existingTx?)` reuses a caller-supplied transaction when given one. The route that already holds the row lock passes its `tx`. The completion-percentage recalculation (`updateProductionOrderCompletionPercentages`, which UPDATEs the same row) must run **after** that transaction commits, and its failure must be caught (the roll is already committed — never turn it into a 500).

## Why
A route opened a transaction, did `SELECT ... FOR UPDATE` on the production_orders row, then called a storage function that opened a **separate** pooled transaction to INSERT the roll. The INSERT needs an FK KEY-SHARE lock on the same row the outer transaction held FOR UPDATE. The outer transaction was waiting at the app level (ClientRead) for the inner call to return, so Postgres could not see a lock cycle and **did not** raise "deadlock detected" — the request hung forever and the user saw "roll creation fails". Mixed lock order across the final-roll vs normal-roll paths is the same class of trap (that one usually surfaces as DB-detected 40P01 under concurrency).

## How to apply
When one DB operation calls another and both touch the same rows, thread the transaction through — never let the inner op grab a fresh connection while the outer holds a conflicting row lock. Keep advisory-then-row-lock order identical across sibling endpoints.
