# Order print summary implementation plan

Based on the user-approved order-print-summary spec.

1. Simplify the print sheet total, quantity cells, and bilingual item-name cells; preserve other print content and APIs.
2. Update the print disclaimer to describe planned-only quantities.
3. Extend isolated browser assertions for multiple rows, missing products/item names, zero quantities, both languages, and empty orders.
4. Run type/translation checks, relevant tests, and build; restart once, inspect responsive fixture previews and native A4/multipage output, and confirm the running application.