---
name: Production operator tabs
description: Operator-only stage visibility, with existing administrative navigation preserved.
---

Film operators see only Film; printing operators see only Printing; cutting
operators see only Cutting. General production read permission must not expose
other tabs to an operator. Multiple operational stage grants may expose those
explicitly granted stages.

Each of these three operator roles must have full operation authority for its
own board, not just dashboard reading. Preserve the separation between stages;
do not use administrator or general production-management grants to enable it.

**Why:** the user explicitly requested full Film-board permissions, then added
that Printing and Cutting operators must be able to work in their respective
pages.

**How to apply:** configure the actual saved roles with the corresponding
operational grant and test both allowed recording and denied other-stage actions.
Keep ordinary read-only viewers read-only. Published role-data changes need
separate approval; development role edits do not automatically update production.

**Why:** the user requested stage-specific operator tabs and approved
«نعم، تقييد المشغلين فقط» while keeping administrator and production-management
navigation unchanged.

**How to apply:** keep tab visibility, initial production landing page, direct
page access and management shortcuts consistent. Preserve existing administrator
and production-management grants. This is a page-navigation rule, not permission
to revoke unrelated backend grants or remove roll-record access.

Legacy operator roles were originally configured with dashboard-read grants.
Do not assume that every deployment has newer operational grants, and do not
silently turn dashboard reading into permission to record production.
A dashboard reader is not necessarily an operator: Sales can also read a stage.
Use a stable, explicit role-to-stage binding together with actual grants for
operator navigation; preserve non-operator read access. Display names may change
in either language and must never change a persisted stage binding. The selected
preview role supplies the binding, not the original administrator.

**Why:** the first restriction passed artificial operate-only fixtures but failed
for the real Film role. The user reported that Printing and Cutting still
appeared. Inspecting the actual role definitions exposed the mismatch. The user
also required that renaming a role never adds stages, with no fixed role numbers
and no automatic write grants.

**How to apply:** inspect current role definitions before diagnosing stage
visibility, and test their actual grant combinations with effective role
metadata, including role preview. Keep legacy read access read-only and verify
that Sales and production management are not accidentally treated as operators.

Keep refresh beside the page/tab title and the machine selection/change
controls at the top of the operator page, rather than a separate machine card.

**Why:** the user requested these moves to reduce the page's vertical length.

**How to apply:** preserve one live picker, immediate saved selection, a
continued Change action, and operational drafts when refreshing or moving the
controls. Keep the title and refresh in the same row on phones.
