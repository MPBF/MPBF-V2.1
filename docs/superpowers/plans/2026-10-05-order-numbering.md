# Order-numbering implementation

1. Centralize format/sequence helpers and mixed legacy/new maximum query.
2. Apply allocation under existing transaction locks to both order creation
   routes, new lines during editing, and direct new-format child creation.
3. Preserve legacy numbers and explicit legacy direct-create identifiers.
4. Verify helpers and create/edit routes, synthetic PostgreSQL allocation and
   concurrency, types, workflow startup, and public preview.
