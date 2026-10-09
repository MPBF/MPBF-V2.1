---
name: Jest workspace discovery
description: Installed skill packages affect Jest discovery and workspace verification costs.
---

Scope focused Jest runs to the tests directory instead of scanning the whole
workspace. Installed skills can contain duplicate package names.

**Why:** Root-wide discovery reported a `brainstorm-server` naming collision
between two installed skill copies and a focused run timed out. Whole-project
ts-jest analysis was also slow in this workspace; runtime regressions passed
with an isolated transform. Neither problem justified changing runtime code.

**How to apply:** Use scoped discovery during focused verification. If resource
limits require isolated transpilation, identify it as runtime-only verification
and keep type checking separate. Do not silently weaken the shared test setup.