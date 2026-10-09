# Shared order workspace

Approved user scope: replace the Orders list release button with actions for
release to production, pause, and cancel; select orders for bulk actions and
manual folder moves. Four fixed folders: new, production, urgent, archive.
The user chose team-shared membership. These folders never change lifecycle
status and lifecycle changes never change folder membership.

Default view remains All. Unassigned orders belong to New irrespective of
status; explain this clearly. Folder filtering and search happen on the server
before pagination. Readers can view folders; only manage_orders/admin can
change states or move membership. No new permissions or automatic grants.
Each order has exactly one effective folder. Membership has order_id as its
primary key; moving to New stores an explicit New row.

Bulk requests carry expected statuses or expected folders, reject duplicate
IDs, and affect at most 100 explicitly selected orders. Lock orders ascending
and apply each bulk request atomically; a stale/ineligible/missing order means
no changes to any selected order. Already-target states are safe retries.
Validate all locked current values before writes. Already-target pause/cancel
and folder values succeed without writes regardless of the older expected
source. Release also accepts already-ready/in-production states without
regressing them. Any other current/expected mismatch aborts the whole batch.
Release preserves its existing eligibility and genuine-execution checks.
Pause/cancel apply only to waiting/on_hold/for_production/in_production/paused;
completed, delivered, archived or cancelled orders cannot be reopened.
Only parent order status/previous_status change; quantities, production-order
states, executions, rolls and warehouse balances remain untouched.

Show per-row and selected-order menus, explicit selection count and select-all
for the current page only. Clear selection when changing search/page/folder.
Show a confirmation describing pause/cancel effects before submission, with
strong cancellation warning. Folder actions say they change display only.
Keep the existing details release button, viewing, printing and editing.

Persist membership in a separate FK-constrained table via a reviewed additive
development migration; no production migration or publish. Verify roles,
transaction rollback/concurrency, independent status/membership, pagination,
mobile/tablet/desktop and Arabic/English with isolated fixtures.

Implementation order: shared contracts and migration; transactional service and
routes/list join; frontend workspace controls; unit/integration/browser checks.