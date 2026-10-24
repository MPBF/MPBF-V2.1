# Production hall receipt voucher

The user approved a button that opens the existing receipt form in a modal,
instead of leaving the form expanded in the production hall.

## Approved scope

- Title: finished-goods receipt voucher.
- Source: production hall; destination: finished-goods hall.
- Select existing production orders and storage locations; display product,
  customer, available quantity and entered receipt quantity.
- Multiple receipt lines, optional packaging, notes and total kilograms.
- Display the actual server-issued voucher number and registration time after
  successful saving. Do not generate client-side document identities.
- Preserve partial receiving, permissions, stock validation and exact
  idempotent retries.
- Closing the modal must preserve the unsaved draft.
- Support keyboard focus containment and restoration, Arabic/English and
  phone/tablet/desktop layouts.

No printing, new warehouse workflows, backend changes or database migrations
are included. Verify using isolated browser API fixtures, never real stock
movements.
