# Order and production-order numbering

Approved scope: apply the new numbering only to newly created customer orders;
never rename existing orders, production orders, rolls, receipts, or print links.

- New customer orders use `O` followed by at least five decimal digits.
- Continue the highest numeric sequence across both legacy digit-only numbers
  and new `O` numbers. Ignore unrelated imported/custom numbering series.
- Each new order's production lines use its full number plus `-JO01`, `-JO02`,
  etc. The line sequence starts at one for each customer order.
- Adding lines to a new-format order continues its existing `JO` sequence,
  without renaming surviving lines. Adding lines to a legacy order keeps its
  existing legacy numbering convention.
- Apply customer numbering to both order-creation endpoints. Generate canonical
  production numbers for new-format parents even on direct production creation.
  Preserve explicit legacy production numbers on the legacy direct-create API.
- Retain transactional order-allocation locks, parent locks for child allocation,
  uniqueness constraints, atomic product/order creation, and edit protections.
- Never truncate identifiers or wrap sequences. Expand beyond five/two digits
  when necessary and fail explicitly if a complete number exceeds 50 characters.
- Existing screens, searches, print pages, and roll labels read saved identifiers;
  no display-only replacement or data migration is needed.

Verification: helper tests, create/edit API regression tests, direct-creation
coverage, PostgreSQL mixed-sequence allocation and concurrency checks on synthetic
data only, TypeScript check, workflow startup, and unauthenticated preview check.
