---
name: Printing cylinder units
description: Legacy cylinder display units and frozen production snapshot compatibility.
---

Printing cylinders in saved products and frozen execution snapshots may include
an inch mark. Interpret these as inch measurements when checking machine limits;
do not rewrite historical product snapshots merely to normalize their display.
Do not use permissive prefix parsing that would accept arbitrary trailing text
or silently convert centimetres.

**Why:** real execution snapshots contained inch-marked cylinder values, while
machine capabilities were numeric inches. Comparing the entire display string
as a number incorrectly rejected otherwise eligible printing work.

**How to apply:** preserve the original stored value, compare a strictly
interpreted measurement with the machine's actual limits, and retain width,
color-count and active-stage safeguards. Unknown/missing dimensions remain
invalid when the machine has corresponding limits.
