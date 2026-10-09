BEGIN;
-- Preserve historical mixes and balances. Only linked catalogue items are
-- selectable for new operations; no historical identity is guessed from names.
ALTER TABLE factory_raw_materials
  ADD COLUMN IF NOT EXISTS item_id varchar(20) REFERENCES items(id);
CREATE UNIQUE INDEX IF NOT EXISTS factory_raw_materials_item_id_unique
  ON factory_raw_materials(item_id);
CREATE TABLE IF NOT EXISTS factory_raw_vouchers (
  id serial PRIMARY KEY,
  kind varchar(20) NOT NULL CHECK (kind IN ('receipt','issue')),
  total_kg numeric(18,2) NOT NULL CHECK (total_kg > 0),
  notes text,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE factory_raw_movements
  ADD COLUMN IF NOT EXISTS voucher_id integer REFERENCES factory_raw_vouchers(id);
ALTER TABLE factory_raw_movements DROP CONSTRAINT IF EXISTS factory_raw_movements_kind_check;
ALTER TABLE factory_raw_movements DROP CONSTRAINT IF EXISTS factory_raw_movements_check;
ALTER TABLE factory_raw_movements ADD CONSTRAINT factory_raw_movements_kind_check
  CHECK (kind IN ('opening','mixing','receipt','issue'));
ALTER TABLE factory_raw_movements ADD CONSTRAINT factory_raw_movements_check CHECK (
  (kind='mixing' AND mix_id IS NOT NULL AND voucher_id IS NULL AND quantity_kg<0)
  OR (kind='opening' AND mix_id IS NULL AND voucher_id IS NULL AND quantity_kg>=0)
  OR (kind='receipt' AND mix_id IS NULL AND voucher_id IS NOT NULL AND quantity_kg>0)
  OR (kind='issue' AND mix_id IS NULL AND voucher_id IS NOT NULL AND quantity_kg<0)
);
CREATE UNIQUE INDEX IF NOT EXISTS factory_raw_movements_voucher_material_unique
  ON factory_raw_movements(voucher_id,material_id);
COMMIT;
