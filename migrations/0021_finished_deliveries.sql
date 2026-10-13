BEGIN;
CREATE TABLE IF NOT EXISTS factory_deliveries (
  id serial PRIMARY KEY, voucher_number varchar(50) NOT NULL UNIQUE,
  customer_id varchar(20) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name text NOT NULL, customer_name_ar text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by integer REFERENCES users(id) ON DELETE SET NULL, notes text
);
CREATE TABLE IF NOT EXISTS factory_delivery_items (
  id serial PRIMARY KEY, delivery_id integer NOT NULL REFERENCES factory_deliveries(id) ON DELETE RESTRICT,
  inventory_id integer NOT NULL REFERENCES factory_inventory(id) ON DELETE RESTRICT,
  production_order_id integer NOT NULL REFERENCES factory_execution(production_order_id) ON DELETE RESTRICT,
  production_order_number varchar(50) NOT NULL, item_id varchar(20) NOT NULL,
  product jsonb NOT NULL, quantity_kg numeric(14,2) NOT NULL CHECK(quantity_kg>0),
  UNIQUE(delivery_id,inventory_id)
);
CREATE TABLE IF NOT EXISTS factory_delivery_movements (
  id serial PRIMARY KEY, delivery_item_id integer NOT NULL UNIQUE REFERENCES factory_delivery_items(id) ON DELETE RESTRICT,
  inventory_id integer NOT NULL REFERENCES factory_inventory(id) ON DELETE RESTRICT,
  quantity_kg numeric(14,2) NOT NULL CHECK(quantity_kg>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS factory_delivery_items_inventory ON factory_delivery_items(inventory_id,id);
CREATE INDEX IF NOT EXISTS factory_delivery_movements_inventory ON factory_delivery_movements(inventory_id,id);
CREATE INDEX IF NOT EXISTS factory_deliveries_customer ON factory_deliveries(customer_id,id);
COMMIT;
