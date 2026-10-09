---
name: Ordered patch contexts
description: The patch tool matches successive contexts forward, so same-file edits must follow source order.
---

Order same-file patch contexts from the beginning of the file toward the end.

**Why:** exact matching excerpts still failed when a later-file change came
before an earlier-file change in the same patch. Ascending context order applied
those same edits successfully.

**How to apply:** sort same-file edits by source order or use independent
ordered file updates; do not mistake this failure for stale source content.

A failed multi-file patch can still leave earlier successful file updates
applied; do not treat the batch as atomic.

**Why:** the tool applied earlier file updates before rejecting a later context.

**How to apply:** inspect the reported per-file results and the current diff,
then retry only unapplied changes.