# Factory production — approved task design

Implements the user-approved factory-roll-production-system task, within the existing authenticated application. Category overrun snapshots and historical planned quantities remain unchanged.

## State and transitions
Execution has a per-production-order record, frozen product route/specifications, start time, film closure and completion time. Existing orders without execution remain explicitly historical/unrecorded.
Identify plastic-roll products from the Arabic or English item name, not category alone. Freeze this route and the product specifications when explicitly starting an executable pending order.

| Product | Film roll | Printing | Cutting |
|---|---|---|---|
| Printed bag | film | printing (printed, ready to cut) | done |
| Unprinted bag | film (ready to cut) | not applicable | done |
| Printed plastic roll | film | done | not applicable |
| Unprinted plastic roll | done | not applicable | not applicable |

Inline printing uses the verified linked active printer and applies the printing transition during film creation. Completion always requires explicit film closure and all rolls done. The final-roll transaction may close below target; an explicit close-existing-rolls action avoids a fictitious extra roll when the target is already reached. No film creation may exceed the already-increased planned target. Order status, production-order status, execution stage and individual roll stage remain separate.
The final-roll action records that roll and closes film atomically. No additional rolls are accepted after film closure. Closing existing rolls requires actual recorded rolls. Film weight must be positive and records the actual machine, actor, server time and optional production minutes. Printing and cutting each record their actual machine, actor and server time once; repeated transitions are rejected. Cutting net weight must be positive and no greater than film weight; the server computes waste from their difference. Each roll can print or cut while film remains open for its order.
The server allocates each roll's sequential number within its production order. It generates the roll's QR image on demand through an authenticated, permission-checked endpoint; scanning opens that roll's in-system record and requires sign-in and authorization. The server also validates inline printing's printed-product eligibility and derives the active printer from its film-machine link itself, rejecting client-supplied stage or printer overrides. Optional production duration is recorded in minutes when entered.

Completed manufacture allocates a unique batch number and checks all production orders of the customer order before marking that parent complete. Neither planned quantity alone nor warehouse receipt completes manufacture.

## Manual distribution
Authorized management starts executable production orders and manually assigns them to eligible active machines, independently for film, printing and cutting. An order can occupy several stage queues. Queue positions are normalized and reordered atomically, with stale positions rejected. Operators see the chosen machine's queue priorities, may change their actual machine choice, and each roll retains its real execution machine. Planned queue assignment must never replace those actual roll fields.
Each printing/cutting operator's worklist is built from rolls actually eligible for that stage, independently of the order-level execution stage. A whole-order transition must never hide eligible individual rolls.

## Persistence and concurrency
Add independent execution, roll, per-stage machine queue, storage-location, receipt/header/items, inventory balance, movement and operation-idempotency tables. No destructive migration or historical backfill. Balance identity includes customer-product, production order/lot and location, not generic item alone.

Every production write locks the parent customer order before production orders (ascending IDs), then dependent records; receipt writes use the same order. Sequence allocation, transitions, aggregates and final closure share one transaction connection. Actor-scoped idempotency keys bind to canonical validated operation inputs, returning the original result for a replay and rejecting changed payloads. Database foreign keys and an execution-aware production-order trigger protect started orders across all CRUD paths.
Queue writes take a per-stage advisory lock before parent/order locks to serialize rank changes and keep lock ordering consistent.

## Warehouse and quantities
Ready weight is done-roll net cutting weight for bags and film weight for plastic-roll products. Receivable = ready minus immutable receipt item totals. Receipts never complete manufacture. Each receipt atomically creates all items and movements and updates the matching balance; concurrent over-receipt and partial commits are prohibited. Packaging uses exact decimal arithmetic: roll grams × rolls/unit × units ÷ 1000, allowing 2% plus 0.01 kg rounding tolerance. Weights use hundredths of kg, stored as decimal strings.
The entered receipt kilograms remain authoritative; optional packaging only validates against that quantity and never replaces it. The hall shows ready-but-unreceived output even during ongoing film production, hides an order when its current ready quantity has been received, and shows it again when subsequent rolls become ready.

Every saved voucher retains its unique number, date, actor and notes. Every item retains production order, frozen customer-product/item identity, storage location, received kilograms and optional packaging. Display all saved items individually, including partial multi-order receipts.

## UI, access and errors
Provide management, film, printing, cutting, hall, warehouse and authenticated QR roll-detail routes under the existing shell. New operation permissions are explicitly grantable in the existing role tree; no automatic grants. Read-only users cannot mutate. Each response exposes only the modules the actor can access. Active machines are type-normalized; paused/cancelled/archived customer orders prevent production mutations.
Administrator access is determined by the `admin` permission, never a role number. Management does not implicitly grant film, printing, cutting or receiving operation rights. Navigation exposes only permitted views, including direct entry for operator-only and warehouse-only users.

Use focused responsive components and localized interface/error strings, real API-backed states, explicit errors/retry, durable per-operator machine selection with Change available, and stable operation keys when retrying uncertain saves. Do not blindly retry writes with new keys. The existing order print remains planned-only and private.
Preserve that print's one planned total, planned-only quantity column, Arabic/English item names only, independent notes and prior pagination fixes. Do not add actual totals or public roll/order sharing. Order-details messaging must distinguish its planned-only values from actual execution available in the separate authorized module.

## Verification
Unit/state-transition and isolated PostgreSQL integration checks cover all four routes, inline, below/exact-target closure, snapshots, concurrent sequences, retries, rollback, partial/multi-item receipt, balances, reopening hall availability, permission boundaries and protected edits/deletes. Browser fixture tests cover both languages, actual operations and read-only/operator/warehouse roles at phone/tablet/desktop. Existing order/print regression tests, type checks, translations, build and running-app screenshot remain required. No business-data fixtures or auth bypass shipped.