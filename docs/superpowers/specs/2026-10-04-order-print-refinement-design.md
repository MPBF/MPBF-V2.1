# Order print refinements

The user approved centering the item column, rounding **all quantitative fields
including dimensions, thickness and cylinder** to the nearest integer, enlarging
the color circle and removing its supplier name, and widening the customer name
cell while making the drawer cell narrower.

Scope: only the existing authenticated, standalone A4 landscape order print
sheet and its preview. Keep both item names, color name/code/print colors,
separate notes, signatures, QR protection and planned-only quantities.
Identifiers, phone numbers, dates, timestamps and free-text notes are not
measurements and must remain unchanged.

Round individual measurements and each row's planned quantity only for display;
total is the rounded original
sum of planned quantities, not the sum of rounded rows. Numeric segments of
size captions and cylinder dimensions are rounded while preserving separators
and units. Stored quantitative values use ungrouped Latin digits with a decimal
point; preview language does not change input parsing. Half values round away
from zero. Composite captions preserve separators, units and annotations while
rounding each valid decimal token; a caption with no numeric tokens shows a
dash. Partially annotated captions retain their nonnumeric text rather than
guessing new measurements. Missing/nonfinite/invalid scalar numeric values
remain dashes. Do not change shared
order-details formatting, saved values, calculations, APIs or database schema.

Implementation: a print-only numeric helper; targeted edits to OrderPrintSheet
and its existing CSS. Keep the color circle within its table column, and
rebalance the fixed overview widths without losing any fields.

Verification: helper unit tests, type/i18n checks, fixture-only Chromium tests
at phone/tablet/desktop widths, Arabic and English print PDFs including
multi-page boundary cases. Inspect a rendered PDF. No real account or order
mutations, no publishing, and no changes to roll-label templates.