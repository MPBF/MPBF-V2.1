---
name: Warehouse fixture parity
description: Verify cards against production-like paginated feeds, not only typed snapshot fixtures.
---
Warehouse browser fixtures must reproduce the distinction between the
initial dashboard snapshot and separately paginated collections. Verify
visible stock cards from the real collection endpoint while snapshot
collections remain empty.

**Why:** types and database tests passed while finished-stock cards remained
blank: the UI had bound to snapshot collections rather than paginated stock.
The integration browser check caught the mismatch.

**How to apply:** when changing warehouse views, test the complete
snapshot → paginated request → visible unit-count cards flow, including
historical kg-only records. Scope lazy-history assertions by collection;
primary stock loading must not be mistaken for eagerly opening optional
production history.
