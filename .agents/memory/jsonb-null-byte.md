---
name: PostgreSQL jsonb rejects null bytes
description: \u0000 cannot be stored in jsonb; avoid null-byte separators
---

Never build strings containing `\u0000` (null byte) that get stored into a jsonb column — PostgreSQL errors `22P05: \u0000 cannot be converted to text`.

**Why:** A source-signature string used `\u0000` as a field separator and was stored in `display_slides.content` (jsonb); every save failed. Fixed by switching to a printable separator (`|::SEP::|`).

**How to apply:** When a signature/composite string is persisted to jsonb, use a printable delimiter. If the same signature is computed on both frontend and backend for equality (staleness) checks, the delimiter MUST be identical on both sides or comparisons always mismatch.
