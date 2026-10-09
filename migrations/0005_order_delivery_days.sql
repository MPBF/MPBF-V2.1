-- Historical planned delivery dates must remain editable after their date passes.
-- New and edited dates are derived from validated delivery_days by the order API.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS delivery_date_valid;