# Production work feeds and searchable history

## Scope and safety

Work feeds no longer deliver the whole production archive. The requested view
selects management, film, printing, cutting, receiving hall, warehouse, or roll
metadata. History opens only on demand, with 50 records per page (API maximum:
100), descending ID cursors, search, status, Riyadh date ranges, order and
storage-location filters where applicable.

The current work feed is not paginated. Completed manufacturing with unreceived
output remains available in management and the hall, independently of whether
its order appears on a history page. Printing and cutting remain roll-driven
while film is open; stage queues remain independent. Historical plans without
execution remain searchable but are not treated as measured production.

All per-order quantities and roll counts use the full source tables. Warehouse
counts and total stock weight also come from the database, never from the
visible archive page. Filtering vouchers selects matching vouchers, not matching
lines: each returned voucher still contains every receipt item and its product,
order, location, quantity and packaging identifiers.

No application database migrations, published-database changes or business-record
deletions were performed. The volume fixture runs exclusively in a temporary
local PostgreSQL cluster on loopback, separate from the app database. Large
fixtures are explicitly rejected unless the integration runner uses `--local`.

## Reproducing verification

```sh
npm run check
npm run build
npm test -- --runTestsByPath tests/factory-production.test.ts
bash scripts/test-production-history-isolated.sh
bash scripts/test-production-history-isolated.sh --large
# With the development application running:
node scripts/check-factory-production.cjs
```

The isolated runner finds installed PostgreSQL binaries, or accepts `PG_BIN`.
It creates a throwaway database and fixture schema, executes real production
services and HTTP routes, then stops and removes its own cluster. It never
uses the application's database for `--local` fixture operations.

Browser verification intercepts all API calls with synthetic responses. It
does not authenticate as a real user, modify production records or disable
application authentication. A public preview screenshot shows the sign-in
screen; the real signed-in UI was not verified with an actual account.

## Large fixture measurements — 2026-10-04

PostgreSQL 16, local loopback connection. Synthetic archive:
100,000 completed orders, 300,000 completed rolls, 100,000 vouchers and their
inventory/movement entries, plus the lifecycle fixtures and a boundary order
with 121 rolls and more than 60 receipts while film remains open.

Seventy old completed orders retain partial unreceived balances outside the
newest history page. Assertions confirm all seventy remain receivable. The
boundary order confirms ready **22.00 kg**, received **15.00 kg**, remaining
**7.00 kg**, even though each roll/voucher page contains at most fifty records.

Measurements include query execution, driver transfer and JSON serialization.
The comparison is a representative unbounded snapshot using equivalent order,
roll, voucher, inventory and movement projections and the same transaction
isolation, not an exact replay of an old deployed build. Small metadata arrays
are omitted from the unbounded baseline. Baseline/work-state medians use three
samples; the other medians use five.

| Request | Median elapsed | JSON bytes |
| --- | ---: | ---: |
| Unbounded archive snapshot | 10,489 ms | 422,546,348 |
| Management work state | 715 ms | 59,752 |
| Film work state | 61 ms | 7,663 |
| Warehouse summary | 18 ms | 352 |
| Order history page | 4 ms | 35,327 |
| Voucher history page | 2 ms | 18,677 |
| Roll history page | 4 ms | 51,727 |
| Order substring search | 286 ms | 7,787 |

Management response size decreased by more than **99.98%** and its local elapsed
time decreased by about **93%**. Workload-dependent SQL aggregation and broad
substring searches still grow with source-table cardinality; these are not
constant-time guarantees. Results are local measurements, not production SLAs.
No new production indexes or persisted aggregate tables are needed for this change.

## Functional checks

- Typecheck and production build pass. The build reports its existing bundle-size
  warning; it does not fail.
- Thirteen production routing/quantity unit assertions pass.
- Seventeen PostgreSQL lifecycle/concurrency scenarios pass after merging the
  concurrent-safe order-release test, plus dedicated archive
  pagination, permission, date, search and full-source quantity checks.
- Pagination reaches every fixture record without duplicate IDs. Invalid cursors,
  limits, dates and inappropriate filters are rejected by HTTP validation.
- Every voucher item is retained when matching only one order or location.
- Lost-response replay, queue reordering, ongoing film progression, partial
  receiving, actor permissions and frozen execution snapshots remain verified.
- 139 browser assertions pass with isolated API fixtures, including archive
  opening, next/previous pages, cursor reset on search, stable totals and retry.
- Collapsed and expanded production/warehouse histories fit 390, 768 and
  1,440-pixel viewports in Arabic and English without runtime exceptions.