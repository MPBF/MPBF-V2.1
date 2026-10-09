# Order-print pagination verification

Run: `node scripts/check-order-actions.cjs`

All API requests were intercepted with isolated fixtures. No real user login,
database writes, or production order data were used.

Result: **402 browser/PDF checks passed** and TypeScript checking passed.

All PDFs use A4 landscape with the existing 7 mm margins. Both languages passed
the following row-count matrix:

| Production rows | Arabic pages | English pages |
| ---: | ---: | ---: |
| 0 | 1 | 1 |
| 1 | 1 | 1 |
| 2 | 1 | 1 |
| 5 | 2 | 2 |
| 6 | 2 | 2 |
| 7 | 2 | 2 |
| 8 | 2 | 2 |
| 9 | 2 | 2 |
| 12 | 3 | 3 |
| 20 | 4 | 4 |
| 37 | 6 | 6 |
| 38 | 6 | 6 |
| 39 | 7 | 7 |

The original 38-row regression now prints six pages, rather than seven, in both
languages. The final page contains rows 33–38, all three signatures, the creator
name, and the generation stamp. Rendered final-page evidence:

- `a4-signatures-multipage-ar.png`
- `a4-signatures-multipage-en.png`

The PDF checks confirm:

- Every production row appears exactly once and in order.
- Every page containing production rows includes the repeated table header and
  one complete quantity cell per row.
- All three signature titles and the sole generation stamp share the last page.
- The generation time follows the signatures and stays inside the page margin.
- Every page is nonempty and A4 landscape.

For a 39-row order, the signatures and generation stamp move together to page
seven when they cannot fit after the last row. This is intentional: the complete
signature block stays intact, and no page contains only the stamp. See
`a4-closing-39-en.png`.

Preview checks also cover 390, 768, and 1280 px widths, both localized signature
title sets, all three signature lines, and the existing protected view/print
actions. The normal app screenshot shows the sign-in page; signed-in verification
was performed with browser-intercepted fixtures, not a real authenticated session.