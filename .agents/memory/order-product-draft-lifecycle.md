---
name: Order product draft lifecycle
description: Why reusing the customer-product editor inside orders must preserve deferred, atomic product creation.
---

New products entered during order registration or editing remain drafts until the entire order is saved. Reusing the customer-product editor does not mean saving a standalone product immediately.

**Why:** The form-parity request changed the editor, not the existing order cancellation semantics. Early product persistence would leave unwanted customer products behind when an order is cancelled or fails validation.

**How to apply:** Keep product editing and warning confirmation local to the order draft. Create the order's new products and production lines together in its database transaction, and retain drafts when a save fails so the user can correct and retry.

Customer creation from the customer-product picker's “Add new customer” action is intentionally independent: save the customer immediately, select it, and retain it even if the user later cancels the product.

**Why:** The user explicitly chose immediate, independent customer saving rather than saving the customer together with the product.
**How to apply:** Reuse the customer form without redirecting or clearing the product draft. Cancelling the nested customer form leaves the prior customer selection unchanged. Do not delete an already-created customer when the product is cancelled. This exception does not change deferred product creation inside an order or allow replacing a fixed order customer.