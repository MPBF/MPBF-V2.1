---
name: Mechanical split of giant storage/routes files
description: How server/storage.ts and server/routes.ts were split with zero behavior change; rules to keep the structure working.
---

## Storage (server/storage/)
Chain-of-inheritance: `core.ts` holds cache helpers, `IStorage`, and `StorageBase` (fields + protected helpers, with declaration merge `interface StorageBase extends IStorage {}`). Fragments each `class XStorage extends <prev>` + `interface XStorage extends IStorage {}` in chain users→orders→production→machines→hr→maintenance→quality→warehouse→mixing→notifications→system→misc; `index.ts` exports `DatabaseStorage`/`storage`; `server/storage.ts` is a re-export shim.

**Why:** dual interface-extension requires IStorage declarations to be *textually identical* to implementation signatures (TS2320); a sync script rewrote 138 declarations to match.

**How to apply:** new storage method → add impl to the domain class AND the identical signature to `IStorage` in core.ts. Never declare the same method in two fragments (silent override). Static refs use `StorageBase.<const>`.

## Routes (server/routes/)
`server/routes.ts` is an orchestrator: declares fn-body values, `Object.assign(ctx, {...})`, then awaits `register<Domain>Routes(app, ctx)` per domain. Module-level helpers live in `server/routes/shared.ts`. Mutable state: body `let`s became `ctx.<name>` property writes; module-level `let notificationManager` became exported `notificationManagerHolder.value` (ESM exported lets can't be reassigned from importers; destructured copies break reassignment).

**How to apply:** new endpoint goes in the matching domain file; keep specific paths before `/:id` within a file; segment files must destructure only const/fn names from ctx, access mutable ones as `ctx.x`; dynamic import paths in segments are `../<module>` (one level deeper).

## Client pages
Pages live in `client/src/pages/<feature>/`; routing/lazy imports in App.tsx; shared root components in `components/shared/`. When moving files, fix relative imports by resolving against the OLD location, and remember page→page relative imports too.
