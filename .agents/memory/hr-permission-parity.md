---
name: HR sub-feature permission parity
description: Frontend permission gating for HR tabs must mirror the exact backend route middleware permission sets.
---

# HR sub-feature permission parity

When gating UI actions inside the per-employee HR file tabs, the frontend permission
flags must match the **exact** permission set each backend route accepts — not a
generic HR-only set.

**Why:** Most HR routes accept the HR perms (`manage_hr`/`add_hr`/`edit_hr`/`delete_hr`),
but the **training** routes additionally accept training-specific perms
(`view_training`/`manage_training`). A shared "canAdd/canDelete = HR perms only" hook
silently denies the training UI to users who legitimately hold only training perms,
creating a UI/API authorization mismatch (architect-flagged as a FAIL).

**How to apply:** In the HR tabs perms hook, expose distinct training flags
(`canAddTraining`, `canDeleteTraining`) that include `manage_training` (and HR
fallbacks) and use those only in the Training tab. Any new HR sub-feature with its
own backend permission set needs its own matching frontend flag — don't reuse the
generic HR flags blindly.
