---
name: Operator machine selection
description: Confirmed interaction rules for machine pickers on worker production dashboards.
---

**Rule:** A machine selected from a worker dashboard is saved immediately. The
picker must leave edit mode, confirm the selected machine, and keep the
“Change” action available so the operator can select another machine later.
Machine names are the visible labels; IDs remain internal selection values,
never visible substitutes for a machine name.

**Why:** The user confirmed immediate saving with continued ability to change.
Leaving the picker in edit mode made a successful local selection appear not
to work.

**How to apply:** Use this behavior consistently for film, printing, and
cutting operator machine selectors. The selected ID remains the value sent to
production endpoints.

On mobile, place the page title, icon-only refresh, and machine-change control
in the same top row. Show the selected machine name inside the change button,
without its code or a separate operating-machine label/chip.

**Why:** the user requested this arrangement to reduce page height and avoid
duplicating the machine name.

**How to apply:** preserve this compact arrangement consistently for film,
printing, and cutting without changing immediate selection persistence.