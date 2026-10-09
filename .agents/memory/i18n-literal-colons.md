---
name: Literal-colon translation labels
description: i18next can hide single-word labels ending in a colon while multi-word labels still appear.
---

Treat natural-language labels with literal colons as whole translation keys,
not namespace-qualified keys.

**Why:** actual PDF inspection exposed blank date/delivery headings. With
i18next's default namespace separator, single-word Arabic keys ending in a
colon can resolve to an empty key, while phrases containing spaces still work.
Layout checks alone do not catch this.

**How to apply:** pass `nsSeparator: false` for literal-colon lookups unless
the application's global configuration disables namespace parsing. Check
label text in both Arabic and English, not only its bounding box.