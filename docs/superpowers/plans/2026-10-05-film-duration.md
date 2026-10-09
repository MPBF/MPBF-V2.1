# Film duration implementation

Approved spec: ../specs/2026-10-05-film-order-machine-duration-design.md.

1. Add a typed order/machine summary and separate roll-detail contract.
2. Aggregate all roll timestamps per order/machine in the existing indexed
   order projection; reuse the grouped query for one roll-detail lookup.
   Preserve repeatable-read authorization, weights and warehouse totals.
3. Remove manual minutes from the strict request, shared input and insertion.
   Do not migrate or update historical data.
4. Replace manual UI with a shared bilingual, responsive aggregate summary
   in film cards, order facts/history and individual roll detail. Keep draft
   recovery and idempotency intact.
5. Add disposable database scenarios for grouping, empty/single/equal-time
   groups, overnight spans, processed/received rolls, pagination, unchanged
   history and manual-field rejection. Exercise real browser fixtures at
   phone/tablet/desktop in both languages, recording and recovery paths.
6. Run scoped regression tests and type checks, restart the existing workflow,
   inspect logs and preview. No production writes or publication.
