-- Run once on each database. This is deliberately a single transaction:
-- retain the pre-rounding values, round each .5 UP, and enforce strict integers.
-- Production managed databases require running this in the production SQL editor
-- before publishing the matching application schema; never overwrite production
-- with development data.
BEGIN;

CREATE TABLE IF NOT EXISTS customer_products_whole_number_backup_20260930 AS
SELECT id, width, left_facing, right_facing, thickness,
       universal_thickness, bags_per_kilo
FROM customer_products
WHERE width <> trunc(width)
   OR left_facing <> trunc(left_facing)
   OR right_facing <> trunc(right_facing)
   OR thickness <> trunc(thickness)
   OR bags_per_kilo <> trunc(bags_per_kilo);

ALTER TABLE customer_products DROP COLUMN universal_thickness;

ALTER TABLE customer_products
  ALTER COLUMN width TYPE numeric USING ceil(width),
  ALTER COLUMN left_facing TYPE numeric USING ceil(left_facing),
  ALTER COLUMN right_facing TYPE numeric USING ceil(right_facing),
  ALTER COLUMN thickness TYPE numeric USING ceil(thickness),
  ALTER COLUMN bags_per_kilo TYPE numeric USING ceil(bags_per_kilo);

ALTER TABLE customer_products
  ADD COLUMN universal_thickness numeric GENERATED ALWAYS AS (
    CEIL(CASE
      WHEN (COALESCE(left_facing, 0) = 0 AND COALESCE(right_facing, 0) = 0)
        THEN thickness / 2 * 10
      WHEN (left_facing > 0 AND right_facing > 0)
        THEN thickness / 4 * 10
      ELSE thickness / 2 * 10
    END)
  ) STORED,
  ADD CONSTRAINT customer_products_width_whole CHECK (width IS NULL OR width = trunc(width)),
  ADD CONSTRAINT customer_products_left_facing_whole CHECK (left_facing IS NULL OR left_facing = trunc(left_facing)),
  ADD CONSTRAINT customer_products_right_facing_whole CHECK (right_facing IS NULL OR right_facing = trunc(right_facing)),
  ADD CONSTRAINT customer_products_thickness_whole CHECK (thickness IS NULL OR thickness = trunc(thickness)),
  ADD CONSTRAINT customer_products_universal_thickness_whole CHECK (universal_thickness IS NULL OR universal_thickness = trunc(universal_thickness)),
  ADD CONSTRAINT customer_products_bags_per_kilo_whole CHECK (bags_per_kilo IS NULL OR bags_per_kilo = trunc(bags_per_kilo));

COMMIT;