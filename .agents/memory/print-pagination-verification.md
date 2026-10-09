---
name: Print pagination verification
description: Verify paginated browser PDFs rather than relying on continuous print-media layout checks.
---

For print-layout changes, inspect actual PDF page contents as well as the
continuous print-media DOM. Check repeated headers, complete ordered rows, and
the closing content on the final page across row counts near page boundaries.

**Why:** Correct computed break-avoid styles and unclipped signature titles still
passed while Chromium generated a trailing empty page. Ancestor fragmentation
can affect pagination even when the paper content visibly fits.

**How to apply:** Keep fixture-only browser tests separate from real accounts and
data. Extract text per PDF page to detect missing, duplicated, or orphaned content,
and visually render representative final pages. A page containing the complete
signature block is acceptable when it cannot fit with the last table row; a
stamp-only or entirely empty final page is not.

For fixed-size thermal labels, also test the longest allowed identifiers
together with optional fields, not just typical records. Arabic font line
metrics can make the QR/footer overflow even when the PDF has the correct
page count.

**Why:** typical Arabic and English roll labels passed real PDF pagination,
but maximum-length identifiers pushed the footer past the fixed paper edge.

**How to apply:** test the combined worst case and inspect both page contents
and content bounds. Never use hidden overflow as a substitute for fitting
the required identifiers, QR, and footer.