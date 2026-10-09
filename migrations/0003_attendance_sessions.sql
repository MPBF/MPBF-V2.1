-- Additive session model. Legacy attendance events remain untouched; null session_id marks legacy rows.
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_assignment_id integer REFERENCES user_shift_assignments(id) ON DELETE SET NULL,
  shift_id varchar(80) NOT NULL,
  shift_date date NOT NULL,
  shift_start_at timestamptz NOT NULL,
  shift_end_at timestamptz NOT NULL,
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,
  expected_minutes integer NOT NULL,
  check_in_at timestamptz NOT NULL,
  check_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_session_time_check CHECK (shift_start_at < shift_end_at AND window_start_at <= shift_start_at AND window_end_at >= shift_end_at),
  CONSTRAINT attendance_session_checkout_check CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_session_occurrence ON attendance_sessions (user_id, shift_start_at);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_user_date ON attendance_sessions (user_id, shift_date);
ALTER TABLE attendance_events ADD COLUMN IF NOT EXISTS session_id integer REFERENCES attendance_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_events_session ON attendance_events (session_id, id);