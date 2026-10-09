---
name: Order product draft lifecycle
description: Why reusing the customer-product editor inside orders must preserve deferred, atomic product creation.
---

New products entered during order registration or editing remain drafts until the entire order is saved. Reusing the customer-product editor does not mean saving a standalone product immediately.

**Why:** The form-parity request changed the editor, not the existing order cancellation semantics. Early product persistence would leave unwanted customer products behind when an order is cancelled or fails validation.

**How to apply:** Keep product editing and warning confirmation local to the order draft. Create the order's new products and production lines together in its database transaction, and retain drafts when a save fails so the user can correct and retry.