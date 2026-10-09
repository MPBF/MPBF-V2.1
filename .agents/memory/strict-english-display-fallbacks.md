---
name: Strict English display fallbacks
description: Prevent Arabic backend data or errors from leaking into the English interface.
---

In English mode, resolve display names from verified English-only values, then use a stable identifier or neutral localized placeholder. Do not fall back to Arabic names, generic coalesced name fields, unknown raw statuses, or Arabic backend error messages.

**Why:** Generic name fields and even fields labeled as English may be populated by SQL fallbacks to Arabic. A normal localization helper that prefers the requested language but falls back to the other language therefore makes the English interface partially Arabic. Persisting localized labels as filter keys also breaks selections after switching language.

**How to apply:** Keep API language fields semantically strict where possible. Sanitize dynamic display values at the UI boundary, use locale-independent IDs for selection and persistence, explicitly map statuses, and show localized neutral errors when a backend message is in the wrong language.

Keep localized display names separate from bilingual source objects used for editing or updating authentication state.

**Why:** Replacing an Arabic source name with its English display value can cause the English name to persist into user state and remain there when switching back to Arabic.

**How to apply:** Compute display labels independently. Pass the original bilingual user/entity object to preference updates and edit forms.