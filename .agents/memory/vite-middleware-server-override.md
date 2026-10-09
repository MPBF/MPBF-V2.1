---
name: Vite middleware server-config override
description: server/vite.ts replaces the entire `server` block from vite.config.ts — watch.ignored must be duplicated there.
---
The dev server creates Vite via `createViteServer({ ...viteConfig, server: serverOptions })` in `server/vite.ts`. That `server:` replaces the whole `server` section from `vite.config.ts`, so options like `watch.ignored`, `fs`, `hmr.overlay` set in vite.config.ts are silently dropped in dev.

**Why:** ENOSPC file-watcher floods persisted despite correct `watch.ignored` in vite.config.ts, because the middleware-mode serverOptions omitted them; watching `.config`/`.local`/`node_modules` exhausted inotify watchers (limit 65536).

**How to apply:** Any watch/fs/hmr server option needed in dev must be added to `serverOptions` in `server/vite.ts`, not only vite.config.ts. The mockup sandbox uses `usePolling` and its own ignore list.
