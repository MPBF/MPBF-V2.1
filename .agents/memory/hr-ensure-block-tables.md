---
name: HR schema drift on existing databases
description: A declared HR table may be absent on an existing database; fix with a narrow migration after inspecting the live schema.
---

# Schema-only HR tables can be missing on existing databases

The current application does not run a startup ensure-block or auto-sync its full
schema. A table defined in the ORM can therefore be absent from an existing
database, with Drizzle reporting only the failed SELECT rather than the root
Postgres `42P01` missing-relation error.

**Why:** The shift definition table was declared in the ORM but absent in the
connected database; both shift administration and employee self-service queries
failed repeatedly. The previous memory about a required startup ensure-block
described an earlier code version and is no longer valid.

**How to apply:** Check `information_schema.columns` on the database used by the
running app before assuming that a declared table exists. If the database has
other schema drift, avoid forcing a whole-schema push for one missing table.
Prefer a reviewed, additive migration on development; do not add startup DDL
to repair production. Follow the applicable database publishing flow.
