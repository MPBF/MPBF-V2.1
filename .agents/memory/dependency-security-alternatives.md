---
name: Dependency security alternatives
description: Why this project uses a bounded braces fork and ExcelJS rather than audit exclusions.
---

Prefer functional removal or mitigation over suppressing dependency findings when upstream metadata or maintenance prevents a normal upgrade.

**Why:** Upstream braces had no depth-guard release, while the maintained vendor SheetJS release still triggered advisories written against the abandoned npm package. Aliasing SheetJS merely to change scanner identity would conceal the issue rather than simplify the dependency graph.

**How to apply:** Keep the exact depth-guarded braces fork until upstream offers an equivalent verified fix; preserve hostile-nesting and normal-pattern tests through real consumers. Attendance exports use the existing ExcelJS dependency, not another SheetJS alias. Installed editor extensions are not application packages; editing their manifest does not patch bundled code.
