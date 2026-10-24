# Fixed warehouse hall receipt destination

Approved: production hall is one physical source, finished-goods hall is one
physical destination. Receiving must not require creating or selecting
sublocations, even when no storage-location records exist.

New UI requests omit location_id. The server creates or reuses the fixed
finished hall within the same authorized receipt transaction. An advisory lock
serializes provisioning; order locks, quantity conservation, packing validation
and idempotency stay unchanged. Existing location payloads are accepted for
backward compatibility but cannot choose another destination. Already committed
requests still replay their saved historical result.

The existing location table remains for foreign-key and historical compatibility.
No stock is merged, renamed, reassigned or deleted. The fixed site's English or
Arabic hall name identifies it; the legacy location-management endpoint cannot
rename or disable that site. No additional schema migration or automatic
startup DDL is required.

Remove sublocation creation/editing controls and receipt location selectors.
Retain historical record labels and actual unit balances. Verify empty-location
receiving, single destination, concurrent provisioning, rollback, legacy stock
preservation, permissions, both languages and phone/tablet/desktop layouts.
