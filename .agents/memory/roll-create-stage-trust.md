---
name: Roll creation stage must be server-controlled
description: Why roll-create routes force stage='film' and strip client transition fields
---

# Roll creation must not trust client-supplied stage/transition fields

`insertRollSchema` (shared/schema.ts) accepts a client `stage` (validated only
against the enum film/printing/cutting/done) plus optional `printing_machine_id`,
`cutting_machine_id`, `printed_at`, `cut_completed_at`. Both roll-create routes
(`/api/rolls/create-with-timing`, `/api/rolls/create-final`) parse this schema and
spread the result into the insert.

**Rule:** roll creation must always start at `stage='film'`. The create routes run
`sanitizeRollCreateInput()` to strip those transition fields and force
`stage='film'`; only the server-side `resolveInlinePrintedFields()` helper may
advance a freshly-created roll to `stage='printing'` (inline-printed rolls on
combined extruder+printer machines).

**Why:** without sanitizing, any caller with `add_production`/`manage_production`/
`view_film_dashboard` could POST `stage:'printing'` (+ `printing_machine_id`)
directly and skip the printing queue entirely, bypassing the inline-printing
validation (machine must have `inline_printer_id`, product must be `is_printed`).
Caught in code review for the inline-printing feature.

**How to apply:** if you add another roll-create path, or new transition columns to
the rolls table, route the input through the same sanitizer (or a dedicated
create-only schema) and set transition state only from server-validated logic.

## Inline printing pairing facts
- Inline printers are stored as `type='printing'` (NOT `'printer'`); some older
  printers are `'Printer'`. Extruders are `'extruder'`. Name-match linking must be
  case-insensitive on type. The startup linker in server/index.ts links
  Extruder C/G/H -> Printer Inline C/G/H by name only when `inline_printer_id IS NULL`.
- Inline-printed rolls set `created_at` and `printed_at` to the SAME server
  timestamp to satisfy the rolls `printed_at >= created_at` CHECK.
