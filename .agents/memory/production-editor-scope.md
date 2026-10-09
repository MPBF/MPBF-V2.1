---
name: Production editor scope
description: The quantity-only restriction is specifically for the Production Orders tab editor, not all production workflows.
---

The user requested: «نموذج تعديل امر الانتاج الموجود في تبويب اوامر الانتاج يجب ان يسمح بتغيير الكمية فقط». They chose a read-only view dialog inside the same tab.

**Why:** This is a restriction on that editing form. Other production workflows still need their existing status and transition operations; restricting a shared production API globally would exceed the request.

**How to apply:** Keep this form quantity-only, derive the final planned quantity on the server, and preserve protection for started, completed, or batched orders. Do not apply its field restriction to other operational workflows or to order creation.