---
name: Operator machine selection
description: Confirmed interaction rules for machine pickers on worker production dashboards.
---

**Rule:** A machine selected from a worker dashboard is saved immediately. The
picker must leave edit mode, confirm the selected machine, and keep the
“Change” action available so the operator can select another machine later.
Machine names are the visible labels; IDs remain internal fallbacks.

**Why:** The user confirmed immediate saving with continued ability to change.
Leaving the picker in edit mode made a successful local selection appear not
to work.

**How to apply:** Use this behavior consistently for film, printing, and
cutting operator machine selectors. The selected ID remains the value sent to
production endpoints.