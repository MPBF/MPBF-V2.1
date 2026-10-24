---
name: Warehouse keeper scope
description: User-approved two-page access for warehouse keepers while retaining warehouse work.
---

The warehouse keeper must see and access only «لوحة المستخدم» and «المستودع».
Keep warehouse work authority, not a read-only role. The restriction applies to
direct URLs as well as desktop/mobile navigation and administrator role previews.
Do not narrow unrelated roles.

**Why:** the user explicitly requested these two pages only and approved blocking
direct access while preserving operations inside the warehouse.

**How to apply:** separate warehouse permissions from general manufacturing
access. Preserve private roll QR links and warehouse bookmarks, which are
warehouse details rather than additional main pages. Test effective preview
permissions, not the original administrator's business privileges. A development
role correction does not update an independent published database.
