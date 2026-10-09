---
name: Manager roll reassignment concurrency
description: Safe concurrency/data-integrity rules for the manager Roll Management edit path (machine + production-order reassignment).
---

Managers can correct a roll's machine and/or move it to another production order (which auto-renumbers the roll to `{po_number}-R{seq:003}`). The edit path must:

- `SELECT ... FOR UPDATE` the roll row at the start of the transaction. **Why:** two concurrent manager edits of the same roll can otherwise both read a stale `production_order_id`, so the second writer recomputes the wrong source PO and leaves completion metrics stale for the real previous PO.
- Acquire `pg_advisory_xact_lock(1003, newPoId)` before computing `MAX(roll_seq)+1` for the destination PO — **the same lock key/namespace used by roll-creation paths**, or seq allocation races duplicate roll numbers.
- Collect the set of affected POs (old + new) and call `updateProductionOrderCompletionPercentages(poId)` for each **after** the outer txn commits — that helper opens its own transaction, so calling it inside would nest/hang.
- Never clear `film_machine_id` (NOT NULL); guard against empty.
- Write an audit row per changed field (machine fields, `production_order_id`, `roll_number`) into `roll_edit_logs` with old/new value + readable label + changing user.

**How to apply:** any future code that mutates a roll's PO assignment or stage machines from an admin/manager surface must follow these same locking + recompute rules.
