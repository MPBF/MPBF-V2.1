# Category percentage in new production orders

## Approved scope

The user approved applying the category's production overrun percentage to **new production orders only**. Existing production orders must not be backfilled or re-rated.

## Calculation and persistence

- Resolve the product's own `category_id` inside the existing creation transaction.
- Snapshot the category's saved percentage into the new production order's `overrun_percentage`.
- Compute `final_quantity_kg = quantity_kg * (1 + overrun_percentage / 100)` using the existing two-decimal planning helper.
- Derive both fields on the server; client-supplied planned quantities or percentages must not override the category.
- Products without a category (or standalone orders without a product) use 0%. A referenced product/category that is missing is an error, not a silent fallback.

## Coverage

Apply the shared calculation to all three creation paths:

1. Production lines created with a new customer order.
2. New production lines appended while editing an existing customer order.
3. Direct production-order creation.

New product drafts must be resolved after their transactional insertion, so their chosen category is used.

Existing line edits continue to use the percentage already saved with that production order. Editing a category must not rewrite older orders. Existing quantity edit restrictions and product/customer authorization remain unchanged.

## Interface and validation

The existing production-order list and details already show the persisted final quantity and saved percentage; no new interface is needed.

Test all four allowed percentages, rounding, unclassified products, missing references, server authority, draft products, all creation paths, and preservation of existing orders after category changes. Use isolated test data only; do not create or update actual business records.