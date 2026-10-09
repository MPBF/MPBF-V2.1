---
name: users.id FK columns are integer
description: FK columns referencing users.id must be integer in schema; live DB is the ground truth, not migrations/schema.ts
---

# users.id foreign-key column types

`users.id` is `serial` (integer). **Every** foreign-key column referencing `users.id` in the live PostgreSQL DB is `integer` — verified via `information_schema` (join table_constraints → key_column_usage → constraint_column_usage where referenced table=users, column=id).

**Rule:** any column in `shared/schema.ts` that `.references(() => users.id)` must be declared `integer(...)`, never `varchar(...)`. A `varchar` declaration on such a column is a latent bug.

**Why:** several HR/settings tables had these FK columns mis-declared as `varchar(20)` while the actual DB column was `integer`. The mismatch was invisible at runtime because the pg driver coerces, but it (a) is type-incorrect and (b) let server code wrap the id in `String(...)` for `eq()` filters and inserts, which only compiled because the column type lied.

**How to apply:**
- When adding/auditing a FK to users, declare it `integer`. When you flip a column's declared type, run `tsc` — it surfaces every `String(userId)` / string-cast that was silently relying on the wrong type. Replace those with `Number(userId)`.
- Watch for casts hidden behind `updateData: any = {}` objects — `tsc` won't catch those; grep the field names for `String(`.
- Trust the live DB over `migrations/schema.ts` (an introspection snapshot that can be stale) and over the app schema. Query `information_schema` to confirm real column types before mass-editing.
- No drizzle-kit migration is triggered by fixing the declaration: auto-push only runs on an empty/new DB, and the DB columns are already integer.
