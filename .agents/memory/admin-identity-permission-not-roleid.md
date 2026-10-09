---
name: Admin identity = "admin" permission, not role_id
description: How to identify an admin/superuser in backend authz checks; role_id is not a reliable admin signal.
---

# Admin is the "admin" permission, never a hardcoded role_id

Backend authorization that wants to allow "admins" must check
`req.user.permissions?.includes("admin")`, **not** `req.user.role_id === <n>`.

**Why:** role_id numbers do not map to "admin" the way you'd guess. In this DB,
`role_id 1` = "Management User" (NOT an admin, lacks the `admin` permission),
while `role_id 10` = "Administrator" (carries the `admin` super-permission). Several
quick-notes routes historically gated on `role_id !== 1`, so genuine admins
(role 10) were denied with a silent 403 while the frontend (which correctly checks
`permissions.includes("admin")`) still showed the action button. Result: button
appears, click does nothing.

**How to apply:**
- For any "creator or admin" rule, use:
  `record.created_by !== req.user!.id && !req.user!.permissions?.includes("admin")` → 403.
- Keep frontend button visibility and backend enforcement on the SAME rule
  (`created_by === me || permissions.includes("admin")`). A mismatch = silent 403.
- The codebase convention is already `permissions.includes("admin")` (e.g. the
  isAdmin checks in routes.ts). Don't reintroduce `role_id` literals for admin.
- Mutations that can 403 (delete/markRead/update) MUST have an `onError` toast, or
  authz denials look like "nothing happened".

## Wildcard delegation boundary

Treat `*` as ordinary-permission coverage, not administrator identity. Only an explicit `admin` actor may delegate `admin` or `*`, including by assigning or modifying a role or account that carries either grant.

**Why:** Blocking wildcard access at admin-only routes is insufficient if the same actor can create an admin role and assign it to another account. Ordinary wildcard delegation must remain available without permitting this escalation.

**How to apply:** Check direct authorization and indirect role/account delegation together. Regression tests must cover role creation, user assignment, edits of already-privileged accounts, and the final admin-only action, while retaining delegation of ordinary permissions.
