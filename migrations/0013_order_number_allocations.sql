-- Additive only: no existing order, production order or roll is renumbered.
-- Reservations survive order deletion and roll back with failed order creation.
CREATE TABLE IF NOT EXISTS order_number_allocations (
  sequence numeric(44,0) PRIMARY KEY,
  order_number varchar(45) NOT NULL UNIQUE,
  CONSTRAINT order_number_allocation_positive CHECK (sequence > 0)
);
