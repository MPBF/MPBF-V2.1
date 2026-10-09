# Initial-load size and regression checks

Measured with the same `npm run build` command before and after deferring
feature imports. Sizes below use Vite's decimal kB reporting.

| Initial asset | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Main JavaScript | 803.86 kB | 493.21 kB | 38.6% |
| Main JavaScript, gzip | 233.21 kB | 151.41 kB | 35.1% |
| Initial CSS | 139.11 kB | 33.55 kB | 75.9% |
| Initial CSS, gzip | 27.33 kB | 8.00 kB | 70.7% |

This measures asset size, not elapsed page-load time on a particular device.
The initial JS + CSS transfer after gzip is 159.41 kB instead of 260.54 kB
(38.8% less). Feature chunks still download when their corresponding pages
or dialogs are opened.

## Behavior and constraints

- Personal dashboard, HR, factory production, print views, order controls,
  and customer/order/product dialogs are deferred.
- Excel (`xlsx`) and PDF (`html2canvas` + `jspdf`) already used dynamic imports
  in the attendance report. They remain behind their export actions; exporter
  behavior was not replaced.
- SheetJS remains 500.06 kB (161.71 kB gzip). The build still warns about that
  **on-demand** chunk. The main entry is now below 500 kB. No warning threshold,
  dependency, or build configuration was changed to hide the warning.
- Suspense supplies translated loading feedback. A failed chunk displays an
  explicit error and a reload action, clearing React.lazy's rejected import
  cache. Navigation and print permission checks remain unchanged.

## Verification

```sh
npm run build
npm run check
npm run i18n:check
node scripts/check-deferred-loading.cjs
```

## Enforced initial-load budget

`scripts/initial-load-budget.json` stores reviewed baseline sizes and explicit
ceilings in **bytes** (decimal kB, not KiB). The small allowance accommodates
routine fixes without permitting another feature page to enter the initial bundle:

| All initially requested assets | Baseline | Ceiling |
| --- | ---: | ---: |
| JavaScript, uncompressed | 493.21 kB | 510.00 kB |
| JavaScript, gzip | 151.41 kB | 156.00 kB |
| CSS, uncompressed | 33.55 kB | 35.00 kB |
| CSS, gzip | 8.00 kB | 8.40 kB |
| JavaScript + CSS, gzip | 159.41 kB | 164.40 kB |

These are **aggregate** initial-file budgets, not just a limit on the largest
file. Splitting an eager dependency into another initially imported or preloaded
chunk does not evade the check. `check-initial-load-budget.cjs` starts at the
production `index.html`, follows static JS imports/re-exports and local CSS
imports, and includes HTML preload/modulepreload/prefetch requests. Dynamic
imports are excluded from this graph; their presence alone is not initial loading.
Missing assets, unknown initial asset types and unbudgeted external scripts fail
explicitly. The parser uses Acorn already installed with the build tooling.

The browser check then compares the actual cold-cache login JS/CSS requests
against that graph, in Arabic and English, including 1.5 seconds of idle time.
Any extra chunk fails, regardless of its filename or size: new pages, renamed
report libraries, and eager calls to `import()` cannot silently escape the graph
check. An incomplete capture fails too. Login network filenames are printed in
the output. Font-provider CSS, fonts, images, HTML and API responses are outside
this **application JS/CSS** budget; it is not a total-page or elapsed-time budget.
Gzip sizes are measured per emitted file using Node gzip, independent of whether
the disposable fixture server itself enables HTTP compression.

The approved validation `initial-load` runs the following sequence from a fresh
build, without editing `package.json`, Vite or any protected build settings:

```sh
node --test tests/initial-load-budget.test.cjs
npm run build
node scripts/check-initial-load-budget.cjs
node scripts/check-deferred-loading.cjs
```

Node, installed project dependencies, Chromium (`CHROMIUM_PATH` can override
`which chromium`) and Poppler's `pdfinfo`/`pdftotext` are required for the complete
browser/export regression suite. No database or account secrets are needed.
Tests prove that a large deferred SheetJS-like chunk passes, but the same chunk
fails when statically imported or preloaded, and check each budget boundary.
Keep the existing real XLSX/PDF export assertions: Vite's 500 kB warning for a
deferred exporter is not a budget failure. On failure, defer the new feature or
reduce initial dependencies; any intentional ceiling change needs separate
review and a new measured baseline, not automatic adjustment.

The deferred-loading script serves the **production build** from a disposable
HTTP server with synthetic API responses. It never connects to the application
database or signs in to a real account. It verifies Arabic/English navigation,
initial network isolation, lazy loading feedback, real XLSX downloads and
values, PDF export, attendance print HTML, private/public order printing,
read-only/forbidden print permissions, and chunk-failure recovery.

Existing browser regression suites also passed against the running development
workflow, with every application API intercepted:

```sh
node scripts/check-language-flags.cjs   # 172 checks
node scripts/check-order-actions.cjs   # 442 checks, including paginated PDFs
```

These existing scripts write fixture screenshots/PDFs under `screenshots/`;
do not include regenerated binaries as source changes. The normal unsigned
preview was also checked visually. Signed-in behavior was verified using the
isolated browser fixtures, not a real user session.
