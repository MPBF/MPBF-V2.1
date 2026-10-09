---
name: Schema drift migrations
description: Safely applying a narrow additive schema change when the project's drizzle push is non-interactive.
---

When `drizzle-kit push` requests interactive schema-conflict resolution in a non-interactive session, do not use `--force` merely to apply one reviewed additive change.

**Why:** Existing schema drift can make a forced whole-schema diff apply unrelated, potentially destructive changes.

**How to apply:** Keep a checked-in idempotent migration for the specific change, execute only that reviewed statement through the configured database connection, then verify the resulting column constraints and that existing rows retain the intended default.

When introducing or relying on an authentication-user field, supplement intercepted UI fixtures with a live, read-only account-resolution check that reports only success/failure, not account details or credentials.

**Why:** Fixture-based language tests passed while a required user column was absent from the live development schema. Whole-user queries then failed both login and existing-session resolution, even though the visible language controls worked.

**How to apply:** Confirm the live schema and normal account lookup before declaring authentication-adjacent work complete. Apply only the reviewed development migration; production schema changes must follow the project's supported publish flow.