---
name: Order product draft lifecycle
description: Product and customer creation inside orders is independent; cancelling an order must preserve records already saved explicitly.
---

New products defined inside customer-order registration are saved immediately to the customer's products when “Add to order” is pressed. Add the saved product to the order by its identifier.

**Why:** The user explicitly changed the previous deferred-product policy: “اريد عند تعريف منتج جديد ان يتم حفظه فورا الى منتجات العميل بمجرد الضغط على زر اضافة الى الطلب”.

**How to apply:** Validate and confirm warnings before saving the product; only add it to the order after a successful save. Preserve the editor on failure. Cancelling or failing the order must not delete the saved product, and retrying order submission must reference it rather than create a duplicate. Merely opening or cancelling the product editor must not save it. Preserve legacy atomic new_product API compatibility unless separately requested to remove it.

Customer creation from the customer-product picker's “Add new customer” action is intentionally independent: save the customer immediately, select it, and retain it even if the user later cancels the product.

**Why:** The user explicitly chose immediate, independent customer saving rather than saving the customer together with the product. When asked about “Save and continue,” the user confirmed navigation to the new customer's profile applies only to creation from the Customers page; creation inside the product form must keep that form open.
**How to apply:** Reuse the customer form without redirecting or clearing the product form. Cancelling the nested customer form leaves the prior customer selection unchanged. Do not delete an already-created customer when the product is cancelled, or allow replacing a fixed order customer.