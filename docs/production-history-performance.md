# Production work feeds and searchable history

For the focused, approval-gated comparison of archive search alternatives, see
[نتائج قياس البحث في تاريخ الإنتاج](production-history-search-research.md).

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
No new production indexes or persisted aggregate tables were added. Whether they
are justified remains a measurement question, not a constant-time guarantee.

## Bounded read telemetry

`server/production/read-performance.ts` observes authorized `state()` and
`history()` service reads without changing their payloads or queries. The history
module supplies only booleans describing search/filter/cursor presence, never
their values. JSON events named `production_read` go to stdout for samples and
stderr for warnings. They contain only:

- Fixed operation/view, success/failure, and the three history booleans.
- Service elapsed milliseconds, pool wait milliseconds, summed query
  milliseconds and query count (including transaction control).
- UTF-8 JSON bytes **before compression**, plus slow/large/sample flags and the
  number of suppressed warnings since the previous warning in that channel.

There are no customer names, user/order/machine/location IDs, search strings,
SQL, parameters, URLs, dates, exception messages, payloads or stack traces in
these events. Authorization/validation failures occur before measurement.
This does not change other application logging.

Elapsed time covers connection acquisition through read-only transaction commit
and release, plus telemetry serialization when measured. It is not browser
latency, network transfer time, compressed bytes, or HTTP time-to-last-byte.
Pool wait helps distinguish connection pressure from database work. Connection
failure is logged without its message; monitoring failures do not affect the
original result or exception.

Configuration is read once at process startup; restart after changing these
non-secret environment settings. This change does not set any environment values
or change production configuration.

| Variable | Default | Accepted values |
| --- | ---: | --- |
| `PRODUCTION_READ_METRICS_ENABLED` | enabled | `false` disables all instrumentation |
| `PRODUCTION_READ_METRICS_SAMPLE_RATE` | `0.01` | 0–1; 0 disables routine samples, not slow/error warnings |
| `PRODUCTION_READ_METRICS_SLOW_MS` | `1000` | 1–3,600,000 milliseconds |
| `PRODUCTION_READ_METRICS_LARGE_BYTES` | `262144` | 1–1,073,741,824 bytes |
| `PRODUCTION_READ_METRICS_INTERVAL_MS` | `60000` | 1,000–3,600,000 milliseconds |

Blank, non-finite and out-of-range numeric values use documented defaults.
These are initial warning thresholds, not production SLAs. Start with the
defaults and adjust against representative operation, view and search flags.
For temporary complete size sampling use sample rate 1; interval caps still
apply.

Every read has a cheap duration measurement. Size is computed only on an
eligible routine sample or an eligible slow/error warning, avoiding a second
JSON serialization on every poll. **Large but fast unsampled responses are not
guaranteed to trigger warnings.** Sampled sizes are exact, not estimated. There
is no background archive scan or additional database query.

Sampling/serialization and warning emission are bounded independently per
operation/view per process. Each of 7 state views and 5 history kinds can emit
at most one routine sample and one warning per interval (24 events per default
minute per process). Repeated slow/errors increment a suppression counter
without serialization. Large responses also consume the sampling slot, so a
large response cannot cause repeated JSON sizing when its warning is throttled.
Booleans do not create additional buckets; no unbounded ID-keyed cache or timer
is used. Multiple server processes each have their own cap.

Warnings are structured log signals, not external notifications or durable
metrics. Filter `event=production_read`, then group by operation/view/search:

1. High `pool_ms`: investigate connection saturation before query changes.
2. High `query_ms`, especially management/hall: inspect full-source ready and
   received aggregation and actual-quantity joins.
3. Search-only slow history: compare selective, broad and no-search plans;
   paging bounds output, not necessarily rows scanned.
4. Large samples: inspect expected active-work/whole-voucher size without
   truncating work feeds, voucher lines or database totals.

## Read-only plan diagnostics

The `--large` isolated runner now also measures broad order/voucher search and
uses `scripts/production-read-plans.ts` to run the **actual service SQL** with
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in the service's
`REPEATABLE READ READ ONLY` transaction. This happens only in the disposable
local fixture, after the existing full-source totals/old-unreceived assertions.
The runner rejects `--large` without `--local`. The diagnostic wrapper imposes
a transaction-local 30-second statement timeout.

It covers management, receiving hall, warehouse, plain order history, selective
order search and broad order/voucher searches. Output records only scenario,
query sequence, planning/execution time, node/relation type, row/loop counts and
buffer/temp block counts. SQL, parameters and plan predicates are not printed.
Plans deliberately execute reads twice (EXPLAIN ANALYZE and the original read),
so their timings must not be treated as normal telemetry or benchmark samples.
The exact SQL is intercepted from service execution rather than copied into a
potentially stale diagnostic query.

```sh
bash scripts/test-production-history-isolated.sh --large > /tmp/production-history-local.log 2>&1
# Synthetic fixture output only; no app database access:
grep '"diagnostic":"production_read_plan"' /tmp/production-history-local.log
```

Any investigation against the published database must be a separately
authorized read-only exercise. `EXPLAIN ANALYZE` still consumes database
resources: prefer plain `EXPLAIN (FORMAT JSON)` there, and approve a timeout and
off-peak window before executing measured plans. Never run the fixture loader
against a business database. No new index, aggregate table, data rewrite,
production migration or replacement of exact totals with paginated values is
authorized by this task. Further optimization requires independent approval and
must preserve old partially received orders and all-source quantities.

## Verification notes for telemetry changes — 2026-10-16

- Typecheck and build pass; focused performance/privacy, production lifecycle,
  label and machine-capability unit suites pass.
- Initial-load byte budget passes (160.94 kB gzip). The broader deferred-loading
  validator initially exposed two harness issues: a navigation-time null body,
  and an outdated three-column receipt assertion. The wait now tolerates the
  missing body until the new document is ready, and the receipt check asserts
  all five current kg-only column names exactly (not merely their count).
  No client component or receipt-print layout was changed.
- Development workflow starts cleanly. Public preview renders the sign-in
  screen; signed-in UI was not visually verified. These changes are server-side
  only, with no authentication bypass.
- The local fixture runner needed parity repairs before measuring: original
  thickness, existing delivery migration, the current original-thickness error
  assertion, disjoint archive IDs and the actual provisioned hall location.
  No application database was migrated. Integration also caught an inventory
  projection joining the product before declaring its production-order alias;
  join order was corrected without changing projected fields or totals.

### Large fixture rerun and decisions

The repaired isolated runner completed successfully with 100,000 synthetic
completed orders, 300,000 rolls and 100,000 vouchers, plus current lifecycle
fixtures. All 70 old partially received orders remained in management/hall.
The boundary order retained 121 rolls, ready 22 kg, received 15 kg, remaining
7 kg despite 50-record archive pages. Database totals matched work-state totals.
All subsequent duration, actor, frozen-spec and kg-receiving checks passed.

| Request | Median elapsed | UTF-8 JSON bytes |
| --- | ---: | ---: |
| Unbounded comparison | 14,709 ms | 494,445,070 |
| Management work state | 493 ms | 94,842 |
| Film work state | 67 ms | 163,104 |
| Warehouse summary | 13 ms | 454 |
| Order history page | 5 ms | 50,927 |
| Voucher history page | 2 ms | 30,727 |
| Roll history page | 4 ms | 56,877 |
| Selective order substring search | 217 ms | 1,039 |
| Broad order substring search | 5 ms | 50,927 |
| Broad voucher substring search | 117 ms | 30,105 |

These include service execution and JSON serialization, using three samples for
comparison/management and five for the other reads. Fixtures and projections
have evolved since the earlier run; this is not a controlled improvement
comparison to the 2026-10-04 numbers, nor a production SLA.

Read-only measured plans identified:

- Management's order-selection/projection query took **718.2 ms** under
  `EXPLAIN ANALYZE`; its ready/received scans visited **300,144 rolls**,
  **100,018 execution rows** and **100,067 receipt items**, with **3,710 temporary
  blocks written** at the root. Hall's equivalent took **563.9 ms** with 3,712
  temporary blocks. Small response size does not remove archive aggregation.
- Management's exact order/roll counts took **26.5 ms**, and its warehouse
  counts/stock sum **38.8 ms**. Those full-source totals were preserved.
- Plain order history took **1.6 ms**. Selective substring search took
  **298.5 ms**, scanning **100,026 production-order rows**. The broad order match
  took **1.8 ms** because the newest 50 already matched. Search cost depends on
  selectivity and where matches occur, not just whether text is present.
- Broad voucher search took **158.7 ms** and scanned roughly 100,000 production
  orders, executions and receipt items through its matching subquery. LIMIT on
  vouchers does not bound this search work.

**Decision:** retain current exact read semantics and use telemetry to detect
threshold breaches. The highest-value separately approved investigations are
ready/received aggregation (including temporary I/O) and archive search plans.
These measurements justify evaluating further optimization, but do not justify
an automatic index, cached total or production database change. Test any
candidate on the disposable fixture first and repeat correctness assertions.

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