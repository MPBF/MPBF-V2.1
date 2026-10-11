BEGIN;
-- No backfill: historical unlabeled mixes must remain unidentified.
ALTER TABLE factory_mixes ADD COLUMN IF NOT EXISTS screw varchar(1);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'factory_mixes'::regclass AND conname = 'factory_mixes_screw_check'
  ) THEN
    ALTER TABLE factory_mixes ADD CONSTRAINT factory_mixes_screw_check
      CHECK (screw IS NULL OR screw IN ('A','B'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS factory_mixes_machine_screw_latest_idx
  ON factory_mixes(machine_id, screw, id DESC);
COMMIT;
