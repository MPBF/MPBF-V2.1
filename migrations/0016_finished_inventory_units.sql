BEGIN;
ALTER TABLE factory_receipt_items ADD COLUMN IF NOT EXISTS line_number integer;
ALTER TABLE factory_receipt_items ADD COLUMN IF NOT EXISTS packing jsonb;
-- Remove only the old one-order/location-per-voucher restriction. Multiple
-- units/packing specifications now legitimately share that pair.
DO $$
DECLARE old_constraint record;
BEGIN
  FOR old_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='factory_receipt_items'::regclass AND contype='u'
      AND conkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid='factory_receipt_items'::regclass AND attname='receipt_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='factory_receipt_items'::regclass AND attname='production_order_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='factory_receipt_items'::regclass AND attname='location_id')
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE factory_receipt_items DROP CONSTRAINT %I',old_constraint.conname);
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='factory_receipt_items'::regclass AND conname='factory_receipt_items_line_check') THEN
    ALTER TABLE factory_receipt_items ADD CONSTRAINT factory_receipt_items_line_check CHECK(line_number IS NULL OR line_number>0);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='factory_receipt_items'::regclass AND conname='factory_receipt_items_packing_check') THEN
    ALTER TABLE factory_receipt_items ADD CONSTRAINT factory_receipt_items_packing_check CHECK(
      packing IS NULL OR (
        packing->>'unit' IN ('kg','packet','roll','piece')
        AND packing->>'method' IN ('unit_weight','piece_weight')
        AND (packing->>'quantity')::numeric>0
      )
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS factory_receipt_items_line_unique ON factory_receipt_items(receipt_id,line_number);
CREATE TABLE IF NOT EXISTS factory_inventory_units (
  id serial PRIMARY KEY,
  inventory_id integer NOT NULL REFERENCES factory_inventory(id) ON DELETE CASCADE,
  packing_key varchar(150) NOT NULL,
  specification jsonb NOT NULL,
  unit_quantity numeric(22,4) NOT NULL CHECK(unit_quantity>=0),
  quantity_kg numeric(14,2) NOT NULL CHECK(quantity_kg>=0),
  CONSTRAINT factory_inventory_units_specification_check CHECK(
    specification->>'unit' IN ('kg','packet','roll','piece')
    AND specification->>'method' IN ('unit_weight','piece_weight')
  ),
  CONSTRAINT factory_inventory_units_count_check CHECK(
    specification->>'unit'='kg' OR unit_quantity=trunc(unit_quantity)
  ),
  UNIQUE(inventory_id,packing_key)
);
-- No historical quantities or packaging are inferred or rewritten.
COMMIT;
