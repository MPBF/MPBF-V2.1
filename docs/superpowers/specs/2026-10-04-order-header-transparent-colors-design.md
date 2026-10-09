# Order print header and transparent master-batch presentation

## User requirements

Improve the production-order print header typography. Enlarge the factory
logo slightly, keep the factory name beside it, with Arabic above English and
both names centered. Enlarge the QR code slightly.

Across the entire application, not just order printing, represent transparent
master-batch colors as white circles with black stripes.

## Proposed design

Retain the compact, single-row header and existing document information.
Allocate more width to the brand. Increase the contained, undistorted logo
from 64 to approximately 80 pixels and the QR from 74 to approximately
88 pixels. Center the Arabic/English brand text as a vertical group beside
the logo. Balance document title and order metadata typography, spacing and
alignment without modifying saved names, dates or quantities.

Keep the existing protected order QR destination, A4 landscape layout,
table dimensions, numeric rounding and signature/pagination behavior.
Enlargement must leave the encoded QR payload and destination unchanged.
Preserve authentication, authorization and order privacy; do not introduce
public links or expose order information.

Use one shared master-batch swatch component and detection helper everywhere
the application displays these colors: product lists, color definitions and
edit previews, customer-product selectors, order details and order printing.
Detect actual transparent values and transparent Arabic/English names;
ordinary white colors remain solid white. Preserve stored colors and labels.
Use a circular white fill with black diagonal stripes, an accessible label,
and SVG rendering so the pattern survives printing without background
graphics. No database changes, color remapping or changes to other UI colors.

## Verification

Unit-test transparent detection, including solid-white and missing-color
cases. Check all identified swatch surfaces and Arabic/English headers.
Verify mobile/tablet/desktop preview containment, enlarged logo and QR,
centered bilingual names, and real A4 PDFs with short/long orders.

## Implementation sequence

1. Shared transparent detection and swatch with focused tests.
2. Existing swatch integrations, without changing saved values.
3. Focused print-header layout and typography.
4. Type check, browser checks and actual PDF boundary verification.