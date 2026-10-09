# Roll production actors implementation

Approved spec: ../specs/2026-10-05-roll-production-actors-design.md.

1. Extend the roll-detail type with three nullable, allowlisted actor identities.
   Join only those stored actor IDs in the authorized, read-only detail query.
   Keep write services, historical records, history feeds and labels unchanged.
2. Add a small bilingual name-formatting helper. Display creator, printer and
   cutter names with their recorded IDs and existing step times in roll detail.
   Handle missing names/steps and English fallbacks without guessing identities.
3. Remove the duplicate close-film button, its local handler and confirmation
   copy. Preserve final-roll registration, retry/draft recovery and backend API.
4. Verify distinct actors, inline printing, absent actors, privacy and immutability
   using isolated PostgreSQL fixtures; unit-test name fallback; exercise both
   languages at phone/tablet/desktop widths with intercepted browser fixtures.
5. Run type/regression checks, restart the existing workflow once, inspect logs
   and preview. No receiver tracking, warehouse edits, migrations or publication.
