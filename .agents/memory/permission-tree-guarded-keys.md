---
name: Permission tree guarded keys
description: Why parent-node cascade selection in the roles tree editor must exclude superuser keys like `admin`.
---

# Permission tree guarded keys

The roles editor presents the flat `PermissionKey` set as a hierarchy
(`PERMISSION_TREE` in `shared/permissions.ts`). Parent-node checkboxes cascade by
selecting every descendant key returned from `collectTreeKeys(node)`.

**Rule:** superuser/elevated keys (currently just `admin`, listed in
`GUARDED_PERMISSION_KEYS`) must be excluded from cascade selection and from
"select all". `collectTreeKeys` drops guarded keys by default; pass
`includeGuarded=true` only for validation/auditing. Granting a guarded key must
be an explicit, individually-confirmed action in the UI.

**Why:** `admin` bypasses every `hasPermission` check. If it sits inside a module
subtree, toggling the parent module (or "select all") silently creates a
full-superuser role — an accidental privilege-escalation path flagged in code
review. The flat enforcement model (`requirePermission`, `ROUTE_PERMISSIONS`,
`hasPermission`) is unchanged; the tree is additive metadata only.

**How to apply:** when adding any new elevated/bypass permission to the tree, add
its key to `GUARDED_PERMISSION_KEYS`. Keep `validatePermissionTree()` green (every
key appears exactly once; it walks `node.keys` directly so guarded keys still
count). Consider server-side defense-in-depth on `/api/roles` requiring admin to
grant admin if accidental escalation resurfaces.
