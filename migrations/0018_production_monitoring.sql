BEGIN;
-- Wait for all pre-existing film/mix writers, then freeze IDs while new writers
-- are blocked. A rerun never moves the boundary, even if the clock changes.
LOCK TABLE factory_rolls, factory_mixes IN ACCESS EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS factory_mix_activation (
  id integer PRIMARY KEY CHECK (id=1),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_roll_id integer NOT NULL CHECK (last_roll_id>=0),
  last_mix_id integer NOT NULL CHECK (last_mix_id>=0)
);
INSERT INTO factory_mix_activation(id,last_roll_id,last_mix_id)
SELECT 1,COALESCE((SELECT max(id) FROM factory_rolls),0),COALESCE((SELECT max(id) FROM factory_mixes),0)
ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS factory_roll_mix_tracking (
  roll_id integer PRIMARY KEY REFERENCES factory_rolls(id),
  machine_id varchar(20) NOT NULL REFERENCES machines(id),
  weight_kg numeric(14,2) NOT NULL CHECK(weight_kg>0),
  uncovered_kg numeric(14,2) NOT NULL CHECK(uncovered_kg>=0 AND uncovered_kg<=weight_kg)
);
CREATE TABLE IF NOT EXISTS factory_mix_allocations (
  mix_id integer NOT NULL REFERENCES factory_mixes(id),
  roll_id integer NOT NULL REFERENCES factory_roll_mix_tracking(roll_id),
  allocated_kg numeric(14,2) NOT NULL CHECK(allocated_kg>0),
  PRIMARY KEY(mix_id,roll_id)
);
CREATE INDEX IF NOT EXISTS factory_mix_allocations_roll ON factory_mix_allocations(roll_id,mix_id);
CREATE INDEX IF NOT EXISTS factory_roll_mix_tracking_machine ON factory_roll_mix_tracking(machine_id,roll_id);
CREATE INDEX IF NOT EXISTS factory_mixes_fifo ON factory_mixes(machine_id,created_at,id);
CREATE INDEX IF NOT EXISTS factory_mixes_monitor_page ON factory_mixes(machine_id,id DESC);
-- Commit-time conservation permits allocation rows and the uncovered remainder
-- to be written in either order within the same film transaction.
CREATE OR REPLACE FUNCTION factory_check_mix_conservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_roll integer;
BEGIN
  target_roll := COALESCE(NEW.roll_id,OLD.roll_id);
  IF EXISTS (
    SELECT 1 FROM factory_roll_mix_tracking t JOIN factory_rolls r ON r.id=t.roll_id
    CROSS JOIN factory_mix_activation b
    WHERE t.roll_id=target_roll AND (
      t.roll_id<=b.last_roll_id OR t.machine_id<>r.film_machine_id OR t.weight_kg<>r.weight_kg OR
      t.weight_kg<>t.uncovered_kg+COALESCE((SELECT sum(allocated_kg) FROM factory_mix_allocations WHERE roll_id=t.roll_id),0))
  ) OR EXISTS (
    SELECT 1 FROM factory_mix_allocations a JOIN factory_mixes m ON m.id=a.mix_id
    JOIN factory_rolls r ON r.id=a.roll_id CROSS JOIN factory_mix_activation b
    WHERE a.roll_id=target_roll AND (m.id<=b.last_mix_id OR m.machine_id<>r.film_machine_id OR m.created_at>r.created_at OR
      m.total_kg<(SELECT sum(allocated_kg) FROM factory_mix_allocations WHERE mix_id=m.id))
  ) THEN
    RAISE EXCEPTION 'Invalid machine mix allocation or weight conservation' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS factory_mix_allocation_conservation ON factory_mix_allocations;
CREATE CONSTRAINT TRIGGER factory_mix_allocation_conservation AFTER INSERT OR UPDATE OR DELETE ON factory_mix_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION factory_check_mix_conservation();
DROP TRIGGER IF EXISTS factory_roll_mix_conservation ON factory_roll_mix_tracking;
CREATE CONSTRAINT TRIGGER factory_roll_mix_conservation AFTER INSERT OR UPDATE ON factory_roll_mix_tracking
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION factory_check_mix_conservation();
-- Immutable operation projection. Snapshot membership excludes late commits
-- even when they have an older timestamp or sequence than the first page.
CREATE TABLE IF NOT EXISTS factory_production_events (
  id bigserial PRIMARY KEY,
  roll_id integer NOT NULL REFERENCES factory_rolls(id),
  stage varchar(20) NOT NULL CHECK(stage IN ('film','printing','cutting')),
  registered_at timestamptz NOT NULL,
  machine_id varchar(20) NOT NULL REFERENCES machines(id),
  actor_id integer REFERENCES users(id) ON DELETE SET NULL,
  weight_kg numeric(14,2) NOT NULL CHECK(weight_kg>0),
  net_weight_kg numeric(14,2),
  waste_kg numeric(14,2),
  transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE(roll_id,stage)
);
CREATE INDEX IF NOT EXISTS factory_production_events_time ON factory_production_events(registered_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS factory_production_events_stage_time ON factory_production_events(stage,registered_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS factory_production_events_machine_time ON factory_production_events(machine_id,registered_at DESC,id DESC);
INSERT INTO factory_production_events(roll_id,stage,registered_at,machine_id,actor_id,weight_kg,net_weight_kg,waste_kg)
SELECT id,'film',created_at,film_machine_id,created_by,weight_kg,NULL::numeric,NULL::numeric FROM factory_rolls
UNION ALL
SELECT id,'printing',printed_at,printing_machine_id,printed_by,weight_kg,NULL::numeric,NULL::numeric FROM factory_rolls
WHERE printed_at IS NOT NULL AND printing_machine_id IS NOT NULL
UNION ALL
SELECT id,'cutting',cut_completed_at,cutting_machine_id,cut_by,weight_kg,net_weight_kg,waste_kg FROM factory_rolls
WHERE cut_completed_at IS NOT NULL AND cutting_machine_id IS NOT NULL AND net_weight_kg IS NOT NULL
ON CONFLICT(roll_id,stage) DO NOTHING;
CREATE OR REPLACE FUNCTION factory_record_production_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO factory_production_events(roll_id,stage,registered_at,machine_id,actor_id,weight_kg)
  VALUES(NEW.id,'film',NEW.created_at,NEW.film_machine_id,NEW.created_by,NEW.weight_kg)
  ON CONFLICT(roll_id,stage) DO NOTHING;
  IF NEW.printed_at IS NOT NULL AND NEW.printing_machine_id IS NOT NULL THEN
    INSERT INTO factory_production_events(roll_id,stage,registered_at,machine_id,actor_id,weight_kg)
    VALUES(NEW.id,'printing',NEW.printed_at,NEW.printing_machine_id,NEW.printed_by,NEW.weight_kg)
    ON CONFLICT(roll_id,stage) DO NOTHING;
  END IF;
  IF NEW.cut_completed_at IS NOT NULL AND NEW.cutting_machine_id IS NOT NULL AND NEW.net_weight_kg IS NOT NULL THEN
    INSERT INTO factory_production_events(roll_id,stage,registered_at,machine_id,actor_id,weight_kg,net_weight_kg,waste_kg)
    VALUES(NEW.id,'cutting',NEW.cut_completed_at,NEW.cutting_machine_id,NEW.cut_by,NEW.weight_kg,NEW.net_weight_kg,NEW.waste_kg)
    ON CONFLICT(roll_id,stage) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS factory_production_events_trigger ON factory_rolls;
CREATE TRIGGER factory_production_events_trigger AFTER INSERT OR UPDATE ON factory_rolls
FOR EACH ROW EXECUTE FUNCTION factory_record_production_events();
COMMIT;
