---
name: Permission-scoped lookups
description: Keep reference selectors usable without granting management access to the referenced module.
---

Reference selectors and filters should obtain minimal label/identifier options under the owning module's read permission, rather than requiring management access to the referenced module.

**Why:** A user may legitimately read or manage items without managing categories. Testing with a fixture that also grants category management hides the resulting lookup denial and disabled filter.

**How to apply:** Prefer a narrow, paginated lookup with only the identifiers and labels needed by the selector. Preserve the referenced module's CRUD permissions. Test the least-privileged supported role, an administrator, and a denied role; browser API fixtures must enforce the relevant permission differences rather than always returning successful option lists.
