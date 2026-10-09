---
name: Backup restore — savepoints & generated columns
description: Rules for the DB backup restore path in server/storage.ts
---
- A failed INSERT inside the single restore transaction aborts it ("current transaction is aborted") and every following row spams the same warning; each row insert must be wrapped in a SAVEPOINT / ROLLBACK TO SAVEPOINT.
- Backups dump GENERATED ALWAYS columns (e.g. customer_products.universal_thickness); restore must strip them per table via information_schema `is_generated = 'ALWAYS'` or every row fails with "cannot insert a non-DEFAULT value".
- Log only the first real error per table plus a failed-row count — not one warning per row.
- JS arrays in backup rows must be passed as-is to pg for real ARRAY columns ("malformed array literal" if JSON.stringify'd) but JSON.stringify'd for jsonb columns — check data_type='ARRAY' in information_schema per table.
- Backups strip user passwords; restore must snapshot `users.password` before DELETE and re-apply after insert (only where NULL) or every login is wiped. Verified end-to-end 2026-08-04 via `scripts/test-backup-restore.ts` (full-cycle, 0 failed rows, counts match) and `scripts/test-restore-savepoints.ts` (mixed good/bad rows, savepoint continuity).

**Why:** A restore once "completed" while inserting almost nothing, emitting 500+ identical aborted-transaction warnings that hid the real cause.
**How to apply:** Any new bulk-insert/restore/import path that runs inside one transaction needs per-row savepoints and must exclude generated columns.
