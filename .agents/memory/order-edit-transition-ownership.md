---
name: Order edit transition ownership
description: Why legacy editor status snapshots remain accepted but have no write authority.
---

Order editing must not own status transitions. Keep dedicated transition actions independent, and allow editors opened before a compatibility change to save notes without restoring their old status snapshot.

**Why:** The user explicitly requires a waiting order released by another user to retain its new state and production work when the original editor saves notes. Rejecting every legacy editor payload would prevent that save; trusting its snapshot would undo the release.

**How to apply:** When tightening the edit contract, preserve compatibility for already-open editors without granting their status snapshots write authority. Keep item-version conflict checks and started-production protections; do not apply this restriction to dedicated transition actions.
