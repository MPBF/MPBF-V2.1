---
name: Unfinished Git merges
description: Why conflict markers can recur after a successful local app fix
---

When resolving a workspace merge that broke the app, verify both the working tree and Git's unmerged index. Once all merged code passes checks and preview, finish the in-progress merge rather than stopping after staging.

**Why:** A prior repair passed TypeScript, build, and preview but the merge was left unfinished. Later workspace sync reintroduced conflict markers, and an additional merge also included duplicate declarations in a non-conflict file. A running dev server alone did not mean the repository state was stable.

**How to apply:** Check for unmerged entries and an active merge; inspect new staged files for accidental duplication, then resolve all conflicts, verify the app, and complete the merge if the staged set is understood. Do not commit unrelated user work outside the merge.