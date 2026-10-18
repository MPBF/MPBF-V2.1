---
name: Theme defaults and lazy CSS
description: Why centralized theme defaults must remain chunk-scoped and lower-specificity than theme overrides.
---

# Theme defaults and lazy CSS

Keep the editable screen palette centralized without eagerly downloading every
feature's defaults. Defaults arriving with lazy CSS must have lower specificity
than a root theme override, regardless of navigation order.

**Why:** Shipping the whole registry at login breached the existing initial-load
budget even though feature selectors stayed lazy. Ordinary root defaults can
also override an earlier theme selector of equal specificity when a new chunk
arrives.

**How to apply:** Preserve chunk-scoped emission and consistent token naming
across chunks. Production compaction must not rename a CSS-only copy of a token
also referenced by JavaScript; such names are runtime interfaces, not private CSS.
Keep document ink, QR contrast, and physical product-color samples independent
of screen themes.
