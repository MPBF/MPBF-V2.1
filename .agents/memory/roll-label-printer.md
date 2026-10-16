---
name: Factory roll-label printer
description: The user's approved hardware and printing approach for roll identification.
---

The user specified “zebra” and “4"X6"” for roll labels, then approved
portrait labels printed through the browser, one roll per page.

**Why:** this was explicitly selected by the user, not inferred from the
existing A4 customer-order print.

**How to apply:** preserve this hardware target for roll-label work.
Do not replace it with A4 sheets, a smaller thermal stock, or direct
Zebra/ZPL integration without separate approval. Browser printing cannot
automatically choose the printer or confirm that hardware fed a label.

The user confirmed the printer as “ZDesigner ZD230-203dpi ZPL”, with
Windows 11 and a network connection (Ethernet or Wi-Fi), and explicitly
selected “أبقي الطباعة من المتصفح فقط” when offered local integration.

**Why:** the user declined local direct printing after being asked for
independent approval.

**How to apply:** keep browser printing as the approved approach for this
setup. Do not install a local bridge or send ZPL directly without a new
explicit request and approval. Physical output still needs verification
on the real printer; software-side success alone is not evidence.

Keep batch label discovery independent of active production work lists and
preserve access for users already permitted to view roll details.

**Why:** restricting work feeds to unfinished rolls removed completed rolls
from batch selection, and hall/warehouse feeds can legitimately contain no
rolls. General production-history permissions are narrower than existing
roll-label permissions.

**How to apply:** use bounded, searchable pages for label discovery, preserve
selection across pages, and re-fetch selected records before preview. Do not
restore unbounded archive downloads or broaden unrelated history access.

The roll label's product identity is the Arabic customer name, then the English
customer name beneath it, then the item name and size description. Do not
restore the production-order row in place of this block.

**Why:** the user explicitly requested this identity layout for roll-label
preview, replacing the production-order line.

**How to apply:** keep preview and printed labels consistent while preserving
the roll identifier, weight, QR, and approved 4 × 6 inch page.

Center both customer-name lines and the item–size line. Immediately below
weight, show the recorded account usernames for film, printing, and cutting,
one line per stage. An unrecorded stage shows a dash, not the current viewer.

**Why:** the user explicitly requested centered customer/product identity and
the three stage-user lines below weight.

**How to apply:** preserve the original recorded actors and shared preview/print
layout; adding actor rows must not clip the footer or make the QR unreadable.