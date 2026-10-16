BEGIN;
ALTER TABLE administrative_requests
  ADD COLUMN IF NOT EXISTS leave_start_date date,
  ADD COLUMN IF NOT EXISTS leave_end_date date;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'administrative_requests_leave_dates_check'
      AND conrelid = 'administrative_requests'::regclass
  ) THEN
    ALTER TABLE administrative_requests ADD CONSTRAINT administrative_requests_leave_dates_check
      CHECK (
        (leave_start_date IS NULL AND leave_end_date IS NULL)
        OR (type = 'leave' AND leave_start_date IS NOT NULL AND leave_end_date IS NOT NULL
          AND leave_start_date <= leave_end_date)
      );
  END IF;
END $$;
COMMIT;
