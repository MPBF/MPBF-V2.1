# Released orders visible to film operators

## Approved outcome

The user selected: «يظهر جاهزاً في الفيلم، والعامل يبدأه».
Releasing an order remains a readiness action, not the start of manufacturing.
The film board shows eligible released production orders before execution starts.
The operator explicitly starts each production order from that board.

## Eligibility and authorization

A ready order must have an executable parent (`for_production` or `in_production`),
a pending child whose own `production_orders.previous_status` field is null,
empty or `pending` (the existing historical-order guard), no batch number, no
execution start, and a positive finite planned target. Historical, paused,
cancelled, completed, delivered and archived orders must not become executable.
Existing active film orders continue to display until film closes.

Film workers with `operate_film` may use the existing start endpoint; managers
with `manage_production` retain access. Other operators and read-only users
cannot start orders. This grant authorizes only the existing pending-to-film
start operation, not management, queue assignment or editing.

## Behavior and boundaries

Reuse the transactional start operation, request idempotency and parent-before-child
locks. Start freezes the product snapshot, creates execution, activates the
child and changes the parent to `in_production`, exactly as management start does.
No manufacturing rolls, machine assignments or received stock are created by start.
Concurrent start attempts must not create duplicate execution; existing conflict
handling refreshes the board without presenting a duplicate start as successful.

Ready cards show planned quantity and a localized readiness label and start button.
They do not show weight-entry, roll submission, final-roll or film-close controls
until execution has started. Read-only users can view ready cards without a start
button. Disable start while a write is in flight and use the existing retry handling.
Keep running orders and their existing draft inputs, machine choice, and actions intact.

## Verification

- Pure eligibility tests cover new, historical, started, inactive-parent and invalid-target cases.
- Backend tests cover film start, manager start, rejected roles, invalid state,
  and start replay/concurrency using the existing isolated production suite.
- Fixture browser tests cover Arabic/English, phone/tablet/desktop,
  ready visibility, permission gating, one request on double click, transition
  to running, failed start and no write on loading a ready order.
- Type check, relevant Jest checks, restart and inspect workflow logs.

The separately requested public order-print QR is independent of this change;
ordinary authentication must not be removed while fixing film readiness.
