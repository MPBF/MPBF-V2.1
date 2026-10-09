# Simplify order print quantities and item names

## Approved direction

The user requests three changes to the order print sheet and chose the sum of planned quantities for its single total.

1. **Total:** Display one quantity: the sum of `final_quantity_kg` across every linked production order, using the existing exact-decimal `totals.planned_kg`. Do not show the requested total or a second amount.
2. **Quantity column:** Each production-order row displays only its planned `final_quantity_kg` and kilogram unit. Remove requested quantity, overrun percentage, unit count, and package-weight annotations from this column. This applies even if the linked product is unavailable.
3. **Item column:** Display the linked item's Arabic name and English name on separate lines, regardless of the interface language. Remove the item/category code, production-order number, statuses, batch number, and creation date from this cell. Do not substitute category names for missing item names. A missing language value displays a neutral dash; a missing product/item displays neutral placeholders.

## Scope boundaries

- Preserve the standalone authenticated A4 landscape preview, navigation, print action, and existing layout.
- Preserve the separate notes column, order notes, other product specifications, signatures, and branding.
- Do not modify saved quantities, products, production statuses, permissions, authentication, database schema, API response shape, or the order details modal.
- Retain existing grouped number formatting; the total is zero for an order with no production rows.

## Verification

- Verify multiple production orders with different requested and planned quantities: the sheet total equals the sum of all planned values, including rows with different statuses.
- Verify the quantity cell contains only the planned amount and unit, including missing-product rows and zero quantities.
- Verify both item names appear in both interface languages and extra item metadata is absent.
- Verify missing-item/name behavior and preservation of separate notes.
- Extend isolated browser checks with synthetic API fixtures, including responsive previews and actual A4 landscape/multipage print rendering; do not write business data.
- Run type checking, relevant automated tests, and build. Inspect the running app and state the fixture-based authenticated verification limitation.