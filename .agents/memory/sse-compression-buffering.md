---
name: SSE vs gzip compression
description: Why real-time SSE events silently never reach browsers when compression middleware is on
---
The rule: any SSE endpoint must be excluded from the express `compression()` middleware (by path and by `text/event-stream` content-type in the filter).

**Why:** compression buffers output until enough bytes accumulate, so individual SSE events are never flushed to browsers (which send `Accept-Encoding: gzip`). Debugging is misleading: `curl` receives events fine (no gzip), server logs show connections and sends, and DB rows are correct — only the browser sees nothing.

**How to apply:** if a real-time toast/badge "never arrives" in the browser but curl on the stream works, check the compression filter first. Also remember in-app notifications with `type: "system"` are filtered out of the global toast listener and both bells — use `type: "push"` for user-visible in-app notifications.
