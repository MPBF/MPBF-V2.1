# Customer order history

Approved scope: add a compact, read-only history below the customer-products
table, newest customer orders first. Group production-order lines under their
customer order and date. Show requested and actually produced kilos per
production order.

Actual production is output from the final manufacturing stage only. Orders
without such output show zero. For cut products use the sum of completed rolls'
net cutting weights. Roll products skip cutting: use completed roll weights,
after printing when printing is required. Partial final-stage output counts even
while the rest of the production order is unfinished. Do not add stages together
or subtract warehouse receipts, deliveries, or stock movements.

Implementation: a customer-scoped, permission-checked read endpoint with bounded
order pagination, decimal text at JSON boundaries, and one aggregate query.
No schema/index/data changes. A focused responsive component handles loading,
empty/error states, retry, additional pages and stale customer requests.

Verification: authorization and invalid inputs, real SQL against disposable
synthetic records, multiple production lines, every final-stage path, partial
completion, overproduction, decimal precision, customer isolation, pagination,
and Arabic/English phone/tablet/desktop behavior.
