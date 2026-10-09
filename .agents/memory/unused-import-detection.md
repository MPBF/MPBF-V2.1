---
name: Unused-import detection via tsc
description: tsc --noUnusedLocals emits different codes; grepping only TS6133 misses whole unused import blocks
---
When sweeping for unused imports with `npx tsc --noEmit --noUnusedLocals`, watch ALL of:
- TS6133 — single named local/import unused
- TS6192 — ALL imports in an import declaration unused (one error for the whole statement, per-name TS6133 is NOT emitted)
- TS6196 — unused type-only import (e.g. `Request` in `import type { Express, Request }`)
- TS6198 — all destructured elements unused (e.g. copied `const {...} = ctx` blocks)

**Why:** a cleanup pass that only greps TS6133 looks "clean" while entire import blocks remain; a completion review caught exactly this twice.
**How to apply:** grep `TS61(33|92|96|98)` when validating import cleanups; the project tsconfig has noUnusedLocals off, so run it as an explicit flag.
