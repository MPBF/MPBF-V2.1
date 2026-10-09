---
name: Production operator tabs
description: Operator-only stage visibility, with existing administrative navigation preserved.
---

Film operators see only Film; printing operators see only Printing; cutting
operators see only Cutting. General production read permission must not expose
other tabs to an operator. Multiple operational stage grants may expose those
explicitly granted stages.

**Why:** the user requested stage-specific operator tabs and approved
«نعم، تقييد المشغلين فقط» while keeping administrator and production-management
navigation unchanged.

**How to apply:** keep tab visibility, initial production landing page, direct
page access and management shortcuts consistent. Preserve existing administrator
and production-management grants. This is a page-navigation rule, not permission
to revoke unrelated backend grants or remove roll-record access.

Existing operator roles use legacy dashboard-read grants. Do not assume they
have newer operational grants, and do not rewrite stored role permissions or
silently turn dashboard reading into permission to record production.
A dashboard reader is not necessarily an operator: Sales can also read a stage.
Use the effective role's identity as well as its actual grants for legacy
operator navigation; preserve non-operator read access.

**Why:** the first restriction passed artificial operate-only fixtures but failed
for the real Film role. The user reported that Printing and Cutting still
appeared. Inspecting the actual role definitions exposed the mismatch.

**How to apply:** inspect current role definitions before diagnosing stage
visibility, and test their actual grant combinations with effective role
metadata, including role preview. Keep legacy read access read-only and verify
that Sales and production management are not accidentally treated as operators.
