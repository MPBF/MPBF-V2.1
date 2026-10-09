---
name: Mixed item identifier prefixes
description: Why new item identifiers continue ITM despite existing ITEM-prefixed records.
---

New item identifiers should continue the ITM sequence; do not rename existing ITEM-prefixed identifiers simply to make the list look continuous. Sort identifiers by prefix, then by numeric suffix, so number boundaries sort naturally.

**Why:** The existing dataset has two identifier families, ITEM and ITM, with ITM being the larger/current sequence. Renaming identifiers would risk breaking references to existing items. A single globally continuous numeric order is not meaningful across these overlapping prefixes.

**How to apply:** When changing item creation or catalog ordering, preserve both families and allocate from the largest numeric ITM suffix under a transaction-scoped lock. If a unified ID scheme is requested later, first plan a reference-safe migration rather than relabeling rows in place.