BEGIN;
ALTER TABLE factory_mixes
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id);
-- A correction is not a warehouse voucher. Retain the original mixing debit,
-- and append its exact signed stock delta plus the before/after mix snapshots.
CREATE TABLE IF NOT EXISTS factory_mix_revisions (
  mix_id integer NOT NULL REFERENCES factory_mixes(id),
  revision integer NOT NULL CHECK (revision>0),
  action varchar(10) NOT NULL CHECK (action IN ('edit','delete')),
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(mix_id,revision)
);
CREATE TABLE IF NOT EXISTS factory_mix_stock_adjustments (
  mix_id integer NOT NULL,
  revision integer NOT NULL,
  material_id integer NOT NULL REFERENCES factory_raw_materials(id),
  quantity_kg numeric(18,2) NOT NULL CHECK (quantity_kg<>0),
  balance_after_kg numeric(18,2) NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(mix_id,revision,material_id),
  FOREIGN KEY(mix_id,revision) REFERENCES factory_mix_revisions(mix_id,revision)
);
CREATE INDEX IF NOT EXISTS factory_mix_stock_adjustments_material
  ON factory_mix_stock_adjustments(material_id,created_at DESC);
COMMIT;
