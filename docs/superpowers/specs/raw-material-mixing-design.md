# Approved raw-material mixing

- A Production and Operation tab named خلط مواد الخام is available to film
  operators with working record permissions, not just read access.
- A mix records actual positive kilograms of each distinct material, the
  destination film machine, the authenticated actor and server timestamp.
- Saving a mix directly deducts raw inventory. Negative raw balances are
  allowed and shown as warnings, never a reason to reject a valid mix.
- The mix and its stock deductions commit atomically. Retrying the same
  request must return the same mix, without another deduction.
- A mix must NOT generate an issue voucher or a production receipt voucher.
  Its internal stock audit record is not a voucher.
- Add a raw-material catalog/balance page to Warehouse so authorized
  inventory managers can establish material codes and opening balances.
  Film operation permission does not confer catalog management authority.
- Preserve the existing production/finished receiving workflows. The wider
  four-hall voucher and customer-delivery cycle is a separate extension,
  not an implied side effect of logging a mix.
- New tables are additive. Apply only in development; published database
  changes require independent approval.

## Checks

Test role access and stage bindings, duplicate materials, input validation,
precision, negative stock, concurrent deductions, transaction rollback,
request replay/conflict, pagination, responsive Arabic/English UI, and
recovery after an uncertain save response.
