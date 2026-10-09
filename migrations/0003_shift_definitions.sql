-- Add missing shift tables to existing databases without changing stored attendance.
CREATE TABLE IF NOT EXISTS shift_definitions (
  id varchar(80) PRIMARY KEY,
  name_ar varchar(120) NOT NULL,
  name_en varchar(120),
  start_time varchar(5) NOT NULL,
  end_time varchar(5) NOT NULL,
  next_day_checkin_time varchar(5) NOT NULL DEFAULT '06:00',
  early_checkin_minutes integer NOT NULL DEFAULT 15,
  late_checkout_minutes integer NOT NULL DEFAULT 15,
  break_minutes integer NOT NULL DEFAULT 30,
  geofence_enabled boolean NOT NULL DEFAULT true,
  geofence_center_lat numeric(9, 6),
  geofence_center_lng numeric(9, 6),
  geofence_radius_meters integer NOT NULL DEFAULT 200,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_definitions_active ON shift_definitions (is_active);

CREATE TABLE IF NOT EXISTS user_shift_assignments (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id varchar(80) NOT NULL REFERENCES shift_definitions(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  assigned_by integer REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_shift_assignments_user_history ON user_shift_assignments (user_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_user_shift_assignments_shift_active ON user_shift_assignments (shift_id, unassigned_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_active_shift ON user_shift_assignments (user_id) WHERE unassigned_at IS NULL;

ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS shift_assignment_id integer REFERENCES user_shift_assignments(id) ON DELETE SET NULL;