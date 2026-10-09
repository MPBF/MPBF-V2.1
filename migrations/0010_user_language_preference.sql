BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language varchar(10);

COMMIT;