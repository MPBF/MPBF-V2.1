# Customer profile product ordering

The user approved sorting products alphabetically by category name in the customer profile only.

- Sort a copy of the profile's loaded product list, preferring the Arabic category name and falling back to its English name.
- Use Arabic-aware alphabetical comparison. Keep each category's products adjacent; category IDs break ties between identical names.
- Preserve the existing order of products within each category.
- Use three ordered sections in the same list: named categories alphabetically first; associated but unnamed categories next (grouped by category ID); unclassified products last, preserving their relative order. Unclassified means no category association.
- Number the displayed rows after sorting. Desktop and mobile use the same sorted list.
- Apply sorting after every profile reload, including after saving a product.
- This is client-side display sorting only. No database writes or schema changes are permitted. Do not change product/category data, API ordering, other product lists, permissions, or layouts.

Verify alphabetical ordering, fallback names, duplicate category names, empty lists, unnamed categories, stable ordering, and no input mutation. Check the profile on phone, tablet, and desktop with isolated browser fixtures.