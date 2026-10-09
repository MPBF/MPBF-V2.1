---
name: Server-authoritative derived fields
description: Computed/derived DB columns must be omitted from insert/update schemas and recomputed in the storage layer, never trusted from the client.
---

# Server-authoritative derived fields

Any DB column that is *computed from other inputs* (e.g. bag weight / bags-per-kilo
derived from dimensions + thickness + density) must be:

1. **Omitted** from the `createInsertSchema(...).omit({...})` insert/update Zod schema
   so a client payload can never set it.
2. **Recomputed in the storage layer** on both create and update, and written via
   `{ ...data, ...computedMetrics }` so the server value always overrides anything
   the client tried to send.
3. For updates, **merge the existing row with the partial input before recomputing**
   so partial updates stay correct.

**Why:** A code review FAILED a derived-field feature specifically because the
concern was "server must recompute authoritative values and not trust client-provided
computed fields." Omission + server override is the control that satisfies this.

**How to apply:** When a frontend shows a live-computed read-only field, duplicate the
exact formula in the storage layer (single source of truth for the math) and keep the
frontend version display-only. If you add an idempotent backfill migration for legacy
rows, mirror the same formula in SQL and gate it on `<col> IS NULL` so reruns are no-ops.
For unit conversions, keep them identical on both sides (e.g. universal_thickness is in
microns; multiply by 1e-4 to get cm before the weight calc).
