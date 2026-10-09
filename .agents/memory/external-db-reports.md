---
name: External-DB formatted reports
description: How saved external-SQL-Server report templates (account statement / sales invoice) are structured and where the formatting lives.
---

# External-DB formatted reports (كشف حساب / فاتورة مبيعات)

Built on top of the external SQL Server feature (read-only mssql query runner).

- Saved report definitions live in `external_db_reports` (connection_id FK,
  template_type = table|account_statement|sales_invoice, sql_text,
  `column_mapping` jsonb = template-field → result-column, `header_info` jsonb =
  static header values). Routes are in `server/external-db/routes.ts`; the run
  endpoint reuses the existing read-only `runQuery` (never trust client SQL for
  writes — validateSelectOnly still applies).
- **The whole formatted template (HTML, totals, print window, and PDF) is
  client-side** in `client/src/pages/external-db-reports.tsx`. `renderReportInner`
  builds one HTML string used by both print (new window + window.print) and PDF
  (html2canvas → jsPDF, paginated A4). Logo comes from `useCompanyLogo`.
- Totals are computed in the browser from the mapped numeric columns: statement =
  Σdebit, Σcredit, closing balance (last mapped balance row, else debit−credit);
  invoice = Σtotal (or Σ qty×price), VAT (header_info.tax_rate, default 15), grand.

**Why:** keeps backend thin (just query + persistence) and matches the existing
CSV/print pattern that was already client-side.

**How to apply:** any new template type means adding to `TEMPLATE_META` (fields +
header) and a totals branch in `renderReportInner`. The DB table is only in
schema.ts + the external-DB ensure-block in `server/index.ts` (drizzle-kit push
doesn't run on existing DBs), so new columns/tables must be added there too or
queries 500 on existing databases.
