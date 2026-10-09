BEGIN;
CREATE TABLE IF NOT EXISTS factory_raw_materials (
  id serial PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  name_ar varchar(120) NOT NULL,
  quantity_kg numeric(18,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS factory_mixes (
  id serial PRIMARY KEY,
  machine_id varchar(20) NOT NULL REFERENCES machines(id),
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  notes text,
  total_kg numeric(18,2) NOT NULL CHECK (total_kg > 0)
);
CREATE TABLE IF NOT EXISTS factory_mix_items (
  id serial PRIMARY KEY,
  mix_id integer NOT NULL REFERENCES factory_mixes(id),
  material_id integer NOT NULL REFERENCES factory_raw_materials(id),
  quantity_kg numeric(18,2) NOT NULL CHECK (quantity_kg > 0),
  UNIQUE(mix_id,material_id)
);
-- This is an audit ledger, not an issue/receipt voucher.
-- Deliberately no nonnegative constraint on raw balances.
CREATE TABLE IF NOT EXISTS factory_raw_movements (
  id serial PRIMARY KEY,
  material_id integer NOT NULL REFERENCES factory_raw_materials(id),
  mix_id integer REFERENCES factory_mixes(id),
  kind varchar(20) NOT NULL CHECK (kind IN ('opening','mixing')),
  quantity_kg numeric(18,2) NOT NULL,
  balance_after_kg numeric(18,2) NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind='mixing' AND mix_id IS NOT NULL AND quantity_kg < 0) OR
         (kind='opening' AND mix_id IS NULL AND quantity_kg >= 0)),
  UNIQUE(mix_id,material_id)
);
CREATE INDEX IF NOT EXISTS factory_mix_items_material_idx ON factory_mix_items(material_id,mix_id);
CREATE INDEX IF NOT EXISTS factory_raw_movements_material_idx ON factory_raw_movements(material_id,id DESC);
CREATE INDEX IF NOT EXISTS factory_mixes_actor_idx ON factory_mixes(created_by,id DESC);
COMMIT;
