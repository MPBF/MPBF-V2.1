---
name: Bulk order deletion policy
description: User-approved all-or-nothing behavior for destructive bulk order actions.
---

Bulk deletion of customer orders must be all-or-nothing, not a series of independently committed deletions with partial success.

**Why:** The user explicitly chose «عملية واحدة (موصى به)» after being told that deletion is permanent and removes associated production data, and that any failed deletion must leave every selected order untouched.

**How to apply:** Preserve this policy when changing bulk deletion, its confirmation, or its failure handling. Do not replace it with best-effort deletion without asking the user.
