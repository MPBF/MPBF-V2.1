# Finished-goods receipt identity

Approved by the user for the form, local/saved preview and A4 printing:
each production-order line displays its customer and item name. The receiver is
the account recorded as the receipt creator, never the person currently viewing
or printing it. Unsaved drafts explicitly label the intended receiver as unsaved.
Use frozen execution names for saved rows; unknown historical names stay blank
or show a dash rather than being guessed from current orders.

Add a compact header with the configured factory logo, Arabic/English names and
only configured address/contact/tax details. Expose just these fields to existing
receipt/finished-warehouse grants, not general settings administration. Preserve
kg-only receiving, server date/number, permissions and transactional accounting.
No database migration or existing-row edits are required.

Separately, the user requests the raw-mixing actions Add material, Add note and
Record mix on one phone row. Preserve disabled states, validation and real action
handlers. Verify readable touch targets and no overflow in both languages.
