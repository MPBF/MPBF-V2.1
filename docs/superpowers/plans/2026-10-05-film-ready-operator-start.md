# Film readiness implementation

1. Define and test shared pending-order start eligibility.
2. Permit film operators to use the existing transactional start endpoint;
   preserve all existing locks, validation and management access.
3. Reuse the eligibility rule for management start buttons and film ready cards.
4. Add ready-card start UI with existing idempotent write/retry handling;
   never render execution controls before start.
5. Extend isolated service and fixture browser checks; run types, tests and
   inspect the running preview before delivering.
