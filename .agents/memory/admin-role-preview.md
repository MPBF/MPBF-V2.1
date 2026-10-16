---
name: Administrator role testing
description: User-approved full-permission, session-only role testing and its authority boundaries.
---

Only the real account with an explicit database-backed `admin` permission may
temporarily test another role. The user chose full permissions, including
real additions, updates and deletions, rather than a read-only simulation.
Keep the account identity, saved role and account-wide restrictions unchanged.

**Why:** the user wants to verify other roles without changing their own account,
and explicitly chose full permissions after being warned about real data writes.

**How to apply:** apply the selected grants on both server and frontend. Original
admin authority is reserved for listing/switching test roles and restoration,
never for ordinary business actions while testing. Reset loaded UI state on
switch/restore and notify other tabs sharing the session.

Re-check the real account's admin grant and the selected role on each request.
A deleted test role must fail closed with no effective grants while retaining
restoration for a still-authorized original admin. If the original account loses
admin, remove testing authority instead of trusting saved grant snapshots.

**Why:** silently restoring admin when a test role disappears could make a
business action run with broader permissions than the user intended. Stored
admin snapshots would permit access after actual revocation.

**How to apply:** preserve these boundaries when adding role controls, caching,
or account restrictions. Always keep the original-role option reachable inside
the role chooser, even while testing a role with no permissions.

The role chooser is the only restoration control; do not add a separate
“العودة إلى دوري الأصلي” button.

**Why:** the user explicitly requested removing the separate button and keeping
restoration within the role-selection list.
