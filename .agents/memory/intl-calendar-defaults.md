---
name: Intl calendar defaults
description: Distinguishing calendar choice from Latin digit formatting in localized date tests.
---

`ar-SA-u-nu-latn` selects Latin digits but still uses the locale's default Hijri calendar. It does not request Gregorian dates.

**Why:** A browser assertion hardcoded a Gregorian date while the Arabic interface correctly followed its existing Saudi-locale formatter. An English/server-context test did not expose the difference.

**How to apply:** Specify the intended language and calendar context in date tests. Verify the Riyadh accounting day independently of how that day is represented. Do not silently change the shared calendar policy during unrelated display work; use an explicit Gregorian calendar only when that policy has been approved.