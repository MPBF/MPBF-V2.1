-- Additive self-service tables; safe to apply to an existing database.
CREATE TABLE IF NOT EXISTS attendance_events (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action varchar(20) NOT NULL CHECK (action IN ('check_in', 'break_start', 'break_end', 'check_out')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy numeric(10, 2) NOT NULL CHECK (accuracy BETWEEN 0 AND 10000)
);
CREATE INDEX IF NOT EXISTS idx_attendance_events_user_time ON attendance_events (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS internal_messages (
  id serial PRIMARY KEY,
  sender_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  reply_to_id integer REFERENCES internal_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_internal_messages_sender_created ON internal_messages (sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_internal_messages_recipient_created ON internal_messages (recipient_id, created_at);

CREATE TABLE IF NOT EXISTS administrative_requests (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL CHECK (type IN ('leave', 'permission', 'other')),
  title varchar(200) NOT NULL,
  details text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_administrative_requests_user_created ON administrative_requests (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_administrative_requests_status_created ON administrative_requests (status, created_at);

CREATE TABLE IF NOT EXISTS user_violations (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  details text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_user_violations_user_created ON user_violations (user_id, created_at);