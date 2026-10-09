# Roll QR labels

Approved by the user: Zebra printer, portrait 4 × 6 inch (101.6 ×
152.4 mm) labels, printed through the browser with one roll per page.

- Add single-roll label printing in the roll detail and batch selection in
  production operations. Do not change customer-order printing.
- Fetch current roll data and server-generated QR together from an
  authenticated, permission-checked endpoint. Never put credentials in QR
  or add public access. Fetching labels does not alter factory records.
- Show roll number, production-order number, film weight in kg and batch
  number when available. Use the interface language (Arabic or English).
- Open an isolated preview with explicit Zebra setup instructions: 4 × 6
  inches, portrait, actual size/100%, no browser headers/footers.
  Wait for fonts and QR images before enabling Print; do not print
  incomplete selections on any fetch or rendering failure.
- Use monochrome QR with standard quiet space. Preserve existing roll
  URLs and their login/permission checks.
- Verify selection and failures using fixture-only browser tests,
  endpoint authorization tests, and real Chromium PDF generation.
  Assert exact page size, one label per page, no empty trailing pages,
  intact identifiers and Arabic/English rendering. No test rolls or
  receipts may be inserted in working data.
- Physical Zebra feed/calibration cannot be verified remotely; state that
  limitation and provide the required printer settings.