-- Development-only, destructive schema cleanup, reviewed and applied on
-- September 29, 2026. This file records the explicit change; it is not run
-- by the application. Do not apply it to a published database without a
-- separate data-impact review and authorization.
-- Keep orders, production_orders, planned quantities, and order statuses.
BEGIN;
DROP TABLE public.rolls RESTRICT;
ALTER TABLE public.production_orders
  DROP COLUMN produced_quantity_kg,
  DROP COLUMN printed_quantity_kg,
  DROP COLUMN net_quantity_kg,
  DROP COLUMN waste_quantity_kg,
  DROP COLUMN film_completion_percentage,
  DROP COLUMN printing_completion_percentage,
  DROP COLUMN cutting_completion_percentage,
  DROP COLUMN assigned_machine_id,
  DROP COLUMN assigned_operator_id,
  DROP COLUMN production_start_time,
  DROP COLUMN production_end_time,
  DROP COLUMN production_time_minutes,
  DROP COLUMN film_completed,
  DROP COLUMN printing_completed,
  DROP COLUMN cutting_completed,
  DROP COLUMN is_final_roll_created,
  DROP COLUMN warehouse_received_kg,
  DROP COLUMN warehouse_delivered_kg,
  DROP COLUMN production_stage;
COMMIT;