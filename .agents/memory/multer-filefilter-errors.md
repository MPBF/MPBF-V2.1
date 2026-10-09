---
name: Multer fileFilter error handling
description: How to surface multer fileFilter/size-limit rejections as clean JSON 400s instead of unhandled errors.
---

When multer's `fileFilter` calls `cb(new Error(...))` or a `limits` cap (e.g. LIMIT_FILE_SIZE) trips, the error is thrown inside the multer middleware — *before* your async route handler runs — so a `try/catch` in the handler never sees it and it falls through to the global error handler (often a 500 or generic crash).

**Rule:** wrap the multer middleware in your own express middleware and pass an error callback:
```
(req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: mapMessage(err) });
    next();
  });
}
```
Map `err.message` (your custom fileFilter message) and `err.code === 'LIMIT_FILE_SIZE'` to user-facing (Arabic, in MPBF) messages.

**Why:** without this, an unsupported/oversized upload produces an opaque server error instead of an actionable validation message.
**How to apply:** any new multipart upload route — don't rely on the route's try/catch for filter/limit errors.
