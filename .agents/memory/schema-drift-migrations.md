---
name: Schema drift migrations
description: Safely applying a narrow additive schema change when the project's drizzle push is non-interactive.
---

When `drizzle-kit push` requests interactive schema-conflict resolution in a non-interactive session, do not use `--force` merely to apply one reviewed additive change.

**Why:** Existing schema drift can make a forced whole-schema diff apply unrelated, potentially destructive changes.

**How to apply:** Keep a checked-in idempotent migration for the specific change, execute only that reviewed statement through the configured database connection, then verify the resulting column constraints and that existing rows retain the intended default.

When introducing or relying on a database field or technical table, supplement isolated/intercepted fixtures with live, read-only metadata readiness checks against the application's actual development connection. For authentication-user fields, also verify normal account resolution without reporting account details or credentials.

**Why:** Fixtures previously passed despite a missing live user column; separately, isolated backup tests passed while all of the tool's technical tables were absent from the connected development database. A migration file in Git is not evidence it was applied.

**How to apply:** Confirm connected-schema readiness before declaring database-dependent features complete, and account lookup for auth-adjacent work. Apply only the reviewed development migration; production changes require independent approval and the supported production update flow. Do not disguise missing prerequisites as a transient storage outage.