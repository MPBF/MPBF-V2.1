-- Only add category metadata; do not change production quantities or old fields.
BEGIN;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS overrun_percentage integer NOT NULL DEFAULT 0
  CONSTRAINT categories_overrun_percentage_allowed
  CHECK (overrun_percentage IN (0, 5, 10, 20));

COMMIT;