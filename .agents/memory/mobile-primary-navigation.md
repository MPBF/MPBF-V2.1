---
name: Mobile primary navigation
description: The user's chosen way to reach all authorized main pages from the phone bottom bar.
---

When the bottom bar cannot fit all authorized main pages, provide “المزيد”
with access to all of them; do not silently discard pages to cap the bar.

**Why:** the user reported missing main pages on mobile and explicitly chose
a More button showing all pages.

**How to apply:** preserve permission filtering in both quick links and More.
Navigation availability must change with the effective tested role, rather
than retaining the original administrator's business-page access.
