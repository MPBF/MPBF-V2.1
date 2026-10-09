-- Adds traceability for HR-created and HR-edited attendance records.
ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_events_source_check') THEN
    ALTER TABLE attendance_events
      ADD CONSTRAINT attendance_events_source_check CHECK (source IN ('employee', 'manual'));
  END IF;
END $$;
