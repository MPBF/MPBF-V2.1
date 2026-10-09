---
name: Zod empty-string coercion on optional fields
description: Why optional z.coerce.date()/z.coerce.number() fields 400 on blank form input, and the fix pattern.
---

# Optional `z.coerce.*` fields break on empty strings from forms

HTML form fields submit `""` (empty string) for cleared/optional inputs, never
`undefined`/`null`. `z.coerce.date("")` → `new Date("")` → Invalid Date → fails.
`z.coerce.number("")` → `Number("")` → `0` → fails `positive()`/`min(1)`.
`.optional().nullable()` does NOT save you, because `""` is a present string, so
the coercion runs before optional/nullable can short-circuit.

**Symptom:** every create returns HTTP 400 ("Invalid date" / "must be >= N"), so
records can never be added and tables stay empty — looks like "no records AND
can't add" even though reads and permissions are fine.

**Fix:** preprocess blanks to absent before coercion:
```ts
const blankToNull = (v) => (v === "" || v == null ? null : v);
const blankToUndefined = (v) => (v === "" || v == null ? undefined : v);
// nullable column: z.preprocess(blankToNull, z.coerce.date().nullable()).optional()
// optional w/ DB default: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional())
```
Use `blankToNull` for nullable columns (store null); `blankToUndefined` for
columns with a NOT NULL + DB default (omit so the default applies). Valid and
out-of-range values still validate/reject correctly.

**How to apply:** audit any `createInsertSchema(...).extend({...})` for optional
`z.coerce.date()`/`z.coerce.number()` fields whose forms can submit "". Metadata
fields set server-side from auth (e.g. *_by ids) are lower risk since clients
don't send them blank.
