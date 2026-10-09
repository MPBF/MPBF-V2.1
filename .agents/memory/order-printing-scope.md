---
name: Order viewing and printing scope
description: User-approved print presentation and the boundary between printing and public sharing.
---

Order viewing is a read-only modal inside Orders. The user chose «في تبويب مستقل» for the immediate print preview, with A4 landscape based on the supplied bilingual factory template.

**Why:** The user explicitly selected a separate preview tab rather than an automatic browser print dialog.

**How to apply:** Preserve the read-only view and standalone preview when extending these actions.

The user explicitly requested that the order-print QR open without system
login and selected the complete print copy, including customer contact data,
notes and employee names.

**Why:** the user chose «نسخة الطباعة كاملة» after being informed that anyone
holding the link could see these details.

**How to apply:** public access is scoped to the complete read-only print copy
through a hard-to-guess per-order link. Keep ordinary system pages and editing
APIs authenticated; do not expose the entire order database or extra fields
absent from the printed copy.

Public print links deliberately do not expire automatically.

**Why:** a printed QR must remain useful after the login session ends.
Changing the signing secret invalidates old links; changing already printed
QR images requires reprinting the paper.

**How to apply:** keep link stability when changing printing or authentication;
make any invalidation consequences explicit.

Avoid Vite's reserved `/public/` prefix for capability-bearing web pages.

**Why:** its public-directory warning logs the entire requested URL, including
the access capability. This can expose a private print link in development logs.

**How to apply:** use a non-reserved web-page prefix and no-referrer/no-store
headers; never log genuine capability URLs while verifying the feature.

For order printing, show one total of all linked production orders' planned quantities, planned quantity only in each quantity cell, and Arabic plus English item names only in the item cell.

**Why:** The user requested these three display restrictions and explicitly chose the sum of planned quantities rather than requested quantities.

**How to apply:** Keep this scoped to the order print sheet; it does not authorize changes to saved quantities or the order-details screen. The approved scope preserves the separate notes column and other print content.

The user confirmed integer rounding for all quantitative print fields,
including dimensions, thickness and cylinder, not only quantities.

**Why:** when asked explicitly whether measurements should be rounded, the user
answered «نعم، جميع القيم الرقمية بما فيها المقاسات والسلندر».

**How to apply:** preserve precise saved values and calculations; apply rounding
only to print display, never to identifiers, dates or free-text notes.

The print header keeps the Arabic factory name above the English name, both
centered beside the logo, even when the application is in English.

**Why:** the user explicitly requested and approved this bilingual factory
identity layout; it is an intentional exception to English-only UI fallbacks.

**How to apply:** preserve both factory names in header refinements rather
than switching the brand identity to only the current UI language.