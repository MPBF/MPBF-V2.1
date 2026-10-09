-- Additive only: no backfill, existing plans/history are unchanged.
BEGIN;
CREATE SEQUENCE IF NOT EXISTS factory_batch_number_seq;
CREATE TABLE IF NOT EXISTS factory_execution (
  production_order_id integer PRIMARY KEY REFERENCES production_orders(id) ON DELETE RESTRICT,
  customer_product_id integer NOT NULL REFERENCES customer_products(id) ON DELETE RESTRICT,
  item_id varchar(20) NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  product jsonb NOT NULL,
  is_printed boolean NOT NULL,
  is_roll_product boolean NOT NULL,
  started_by integer REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  film_closed_at timestamptz,
  film_closed_by integer REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  batch_number varchar(50) UNIQUE,
  stage varchar(20) NOT NULL DEFAULT 'film' CHECK (stage IN ('film','printing','cutting','completed')),
  UNIQUE(production_order_id, customer_product_id, item_id),
  CHECK ((film_closed_at IS NULL) = (film_closed_by IS NULL) OR film_closed_by IS NULL),
  CHECK (completed_at IS NULL OR film_closed_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS factory_rolls (
  id serial PRIMARY KEY,
  production_order_id integer NOT NULL REFERENCES factory_execution(production_order_id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  roll_number varchar(100) NOT NULL UNIQUE,
  weight_kg numeric(14,2) NOT NULL CHECK (weight_kg > 0),
  stage varchar(20) NOT NULL CHECK (stage IN ('film','printing','done')),
  film_machine_id varchar(20) NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  production_minutes integer CHECK (production_minutes > 0),
  is_last_roll boolean NOT NULL DEFAULT false,
  printing_machine_id varchar(20) REFERENCES machines(id) ON DELETE RESTRICT,
  printed_by integer REFERENCES users(id) ON DELETE SET NULL,
  printed_at timestamptz,
  cutting_machine_id varchar(20) REFERENCES machines(id) ON DELETE RESTRICT,
  cut_by integer REFERENCES users(id) ON DELETE SET NULL,
  cut_completed_at timestamptz,
  net_weight_kg numeric(14,2),
  waste_kg numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE(production_order_id, sequence),
  CHECK (net_weight_kg IS NULL OR net_weight_kg > 0 AND net_weight_kg <= weight_kg),
  CHECK (waste_kg >= 0 AND waste_kg <= weight_kg),
  CHECK (net_weight_kg IS NULL AND waste_kg = 0 OR net_weight_kg + waste_kg = weight_kg),
  CHECK ((printed_at IS NULL) = (printing_machine_id IS NULL)),
  CHECK ((cut_completed_at IS NULL) = (cutting_machine_id IS NULL)),
  CHECK ((cut_completed_at IS NULL) = (net_weight_kg IS NULL)),
  CHECK (printed_at IS NULL OR printed_at >= created_at),
  CHECK (cut_completed_at IS NULL OR cut_completed_at >= created_at),
  CHECK (cut_completed_at IS NULL OR printed_at IS NULL OR cut_completed_at >= printed_at)
);
CREATE INDEX IF NOT EXISTS factory_rolls_order_stage ON factory_rolls(production_order_id, stage);
CREATE TABLE IF NOT EXISTS factory_queues (
  id serial PRIMARY KEY,
  production_order_id integer NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  stage varchar(20) NOT NULL CHECK (stage IN ('film','printing','cutting')),
  machine_id varchar(20) NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(production_order_id, stage)
);
CREATE INDEX IF NOT EXISTS factory_queues_machine_position ON factory_queues(stage, machine_id, position, id);
CREATE TABLE IF NOT EXISTS factory_locations (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL CHECK (length(trim(name)) > 0),
  name_ar varchar(100) NOT NULL CHECK (length(trim(name_ar)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE(name), UNIQUE(name_ar)
);
CREATE TABLE IF NOT EXISTS factory_receipts (
  id serial PRIMARY KEY,
  voucher_number varchar(50) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  notes text
);
CREATE TABLE IF NOT EXISTS factory_receipt_items (
  id serial PRIMARY KEY,
  receipt_id integer NOT NULL REFERENCES factory_receipts(id) ON DELETE RESTRICT,
  production_order_id integer NOT NULL,
  customer_product_id integer NOT NULL,
  item_id varchar(20) NOT NULL,
  location_id integer NOT NULL REFERENCES factory_locations(id) ON DELETE RESTRICT,
  quantity_kg numeric(14,2) NOT NULL CHECK (quantity_kg > 0),
  packaging jsonb,
  FOREIGN KEY (production_order_id, customer_product_id, item_id)
    REFERENCES factory_execution(production_order_id, customer_product_id, item_id) ON DELETE RESTRICT,
  UNIQUE(receipt_id, production_order_id, location_id),
  UNIQUE(id, receipt_id)
);
CREATE INDEX IF NOT EXISTS factory_receipt_items_order ON factory_receipt_items(production_order_id);
CREATE TABLE IF NOT EXISTS factory_inventory (
  id serial PRIMARY KEY,
  production_order_id integer NOT NULL,
  customer_product_id integer NOT NULL,
  item_id varchar(20) NOT NULL,
  location_id integer NOT NULL REFERENCES factory_locations(id) ON DELETE RESTRICT,
  quantity_kg numeric(14,2) NOT NULL CHECK (quantity_kg >= 0),
  FOREIGN KEY (production_order_id, customer_product_id, item_id)
    REFERENCES factory_execution(production_order_id, customer_product_id, item_id) ON DELETE RESTRICT,
  UNIQUE(customer_product_id, production_order_id, location_id)
);
CREATE TABLE IF NOT EXISTS factory_movements (
  id serial PRIMARY KEY,
  receipt_id integer NOT NULL,
  receipt_item_id integer NOT NULL UNIQUE,
  quantity_kg numeric(14,2) NOT NULL CHECK (quantity_kg > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (receipt_item_id, receipt_id)
    REFERENCES factory_receipt_items(id, receipt_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS factory_operations (
  id serial PRIMARY KEY,
  actor_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  operation text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id, request_id)
);
-- Protect every CRUD route, including future routes. Execution is the authority.
CREATE OR REPLACE FUNCTION factory_protect_started_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution factory_execution%ROWTYPE;
BEGIN
  SELECT * INTO execution FROM factory_execution WHERE production_order_id = OLD.id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Factory execution records cannot be deleted' USING ERRCODE = 'P0011';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.customer_product_id IS DISTINCT FROM OLD.customer_product_id
     OR NEW.quantity_kg IS DISTINCT FROM OLD.quantity_kg
     OR NEW.final_quantity_kg IS DISTINCT FROM OLD.final_quantity_kg
     OR NEW.overrun_percentage IS DISTINCT FROM OLD.overrun_percentage
     OR NEW.production_order_number IS DISTINCT FROM OLD.production_order_number
     OR NEW.batch_number IS DISTINCT FROM execution.batch_number
     OR NEW.status IS DISTINCT FROM (CASE WHEN execution.completed_at IS NULL THEN 'active' ELSE 'completed' END)
  THEN
    RAISE EXCEPTION 'Started factory production must be updated through its execution records' USING ERRCODE = 'P0011';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS factory_started_order_guard ON production_orders;
CREATE TRIGGER factory_started_order_guard BEFORE UPDATE OR DELETE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION factory_protect_started_order();
CREATE OR REPLACE FUNCTION factory_protect_parent_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM production_orders p JOIN factory_execution e ON e.production_order_id=p.id WHERE p.order_id=OLD.id) THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.order_number IS DISTINCT FROM OLD.order_number
      OR NEW.status IN ('completed','delivered') AND EXISTS(
        SELECT 1 FROM production_orders WHERE order_id=OLD.id AND status NOT IN ('completed','cancelled','archived'))
    THEN
      RAISE EXCEPTION 'Started factory order identity or incomplete manufacture cannot be overridden' USING ERRCODE = 'P0011';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS factory_parent_order_guard ON orders;
CREATE TRIGGER factory_parent_order_guard BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION factory_protect_parent_order();
COMMIT;