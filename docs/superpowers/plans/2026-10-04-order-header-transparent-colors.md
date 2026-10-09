# Implementation plan

Approved spec: ../specs/2026-10-04-order-header-transparent-colors-design.md.

1. Add a pure transparent-master-batch detector and one accessible SVG swatch.
   Recognize transparent values/names and preserve solid-white/missing cases.
   Keep color data, IDs and labels unchanged; test detection separately.
2. Replace existing swatches in generic lists/edit previews, customer profile,
   customer-product chooser, order details and print sheet. Preserve each
   surface's existing size and color-label behavior.
3. Delegate only print-header presentation to the design worker, preserving all
   table content, signatures, private QR payload and print pagination rules.
4. Extend existing isolated browser fixture checks for header dimensions and
   alignment, striped-vs-white SVGs, definition/edit/selector/profile surfaces.
   Intercept all APIs; never sign in as a real user or mutate business data.
5. Type-check and run relevant tests; restart the existing workflow once;
   inspect logs/public preview and run browser/PDF tests. Inspect a rendered
   PDF page for header/pattern legibility and long-order page boundaries.