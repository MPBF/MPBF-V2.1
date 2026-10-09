---
name: Vite @/ alias resolution fragility
description: Why @/ imports can break the dev server after lockfile/dep changes, and the convention to follow.
---

# Vite "@/" alias breaks dep optimization after lockfile changes

The dev server (server/vite.ts loads ../vite.config which defines `@` -> client/src)
can fail to start with:
`The following dependencies are imported but could not be resolved: @/components/ui/... Are they installed?`
triggered by `[vite] Re-optimizing dependencies because lockfile has changed`.

When it happens the esbuild dep scanner reports unresolved `@/` imports in WAVES
(fix one file, the next batch surfaces), which looks file-specific but is really the
`@/` alias not resolving during optimizeDeps.

## Convention / fix
This codebase overwhelmingly uses RELATIVE imports; only a few files used `@/`.
**Use relative imports** (`../ui/button`, `../../lib/queryClient`) in client code, not `@/`.
`@shared` and `@assets` aliases are fine and widely used — only `@/` is the problem.

**Why:** the `@/` alias is configured but proves fragile under Vite dep
re-optimization after dependency/lockfile churn (e.g. post-merge dependency refresh);
relative paths always resolve.

**How to apply:** if the dev server dies with unresolved `@/...` deps, convert the
offending files' `@/` imports to relative. `@/` = client/src/, so from
client/src/components/<dir>/ use `../../`, from client/src/<dir>/ use `../`.
