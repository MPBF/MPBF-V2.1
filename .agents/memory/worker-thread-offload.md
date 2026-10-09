---
name: Worker-thread offload for CPU-heavy parsing
description: How to offload CPU work (pdf-parse/mammoth) off the main event loop in this ESM+tsx+esbuild server.
---

Offload CPU-heavy work (e.g. manual/PDF/DOCX text extraction) to a Node worker
thread using **inline eval source** (`new Worker(srcString, { eval: true })`),
NOT a separate `.ts`/`.js` worker file.

**Why:** This server is ESM (`"type":"module"`), runs in dev via `tsx server/index.ts`
and builds prod via `esbuild --bundle` to `dist/index.js`. A separate worker file
referenced by `new URL('./worker.ts', import.meta.url)` breaks in prod because
esbuild does not copy a runtime-URL worker file into `dist/`, and `package.json`
build scripts are off-limits to edit. Inline eval source is embedded in the bundle
so it ships correctly in both dev and prod.

**How to apply:**
- Inside the eval string, get `parentPort`/`workerData` via `await import("node:worker_threads")`
  (works regardless of eval module-type ambiguity), wrap logic in an async IIFE
  (no top-level await), and dynamic-`import()` the heavy packages.
- Pass the buffer as a standalone `ArrayBuffer` (`buf.buffer.slice(byteOffset, byteOffset+byteLength)`)
  in `workerData` + `transferList` to avoid a structured-clone copy on the main thread;
  reconstruct with `Buffer.from(workerData.buffer)` in the worker.
- Enforce timeouts on the main thread with `setTimeout` + `worker.terminate()`
  (terminating frees the parser/native resources); guard with a `settled` flag and
  handle `message`/`error`/`exit(code!==0)`.
- Verified inline eval workers can `import("pdf-parse")` and `import("mammoth")` and
  parse a real PDF under Node 24 in this repo.
