export const monthlyReportCss = String.raw`
@page {
  size: A4 landscape;
  margin: 10mm;
}

:root {
  color-scheme: light;
  --report-ink: #263a37;
  --report-muted: #667773;
  --report-rule: #c5d2cd;
  --report-rule-strong: #82968f;
  --report-tint: #edf2ef;
  --report-paper: #fffefa;
  --report-accent: #345e50;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  color: var(--report-ink);
  background: var(--report-paper);
  font-family: Tahoma, "Noto Sans Arabic", Arial, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body[dir="rtl"] {
  direction: rtl;
  text-align: right;
}

body[dir="ltr"] {
  direction: ltr;
  text-align: left;
}

.report-document {
  width: 277mm;
  margin: 0 auto;
}

.report-page {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 277mm;
  height: 177mm;
  margin: 0 auto;
  padding: 0;
  break-after: page;
  page-break-after: always;
}

.report-page:last-child {
  break-after: auto;
  page-break-after: auto;
}

.report-header,
.report-heading,
.report-meta {
  flex-shrink: 0;
}

.report-header {
  display: grid;
  grid-template-columns: 23mm minmax(0, 1fr);
  align-items: center;
  column-gap: 5mm;
  min-height: 28mm;
  padding: 0 0 3mm;
  border-bottom: 1.2px solid var(--report-accent);
}

.report-logo {
  display: block;
  width: 21mm;
  height: 21mm;
  max-width: 21mm;
  max-height: 21mm;
  object-fit: contain;
  object-position: center;
}

.report-factory {
  min-width: 0;
  text-align: center;
  overflow-wrap: anywhere;
  line-height: 1.35;
}

.report-factory strong,
.report-factory span {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.report-factory strong {
  color: var(--report-ink);
  font-size: 14px;
  font-weight: 700;
}

.report-factory span {
  margin-top: 1mm;
  color: var(--report-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.035em;
  text-align: center;
}

.report-heading {
  min-width: 0;
  padding-top: 3mm;
  text-align: center;
  overflow-wrap: anywhere;
}

.report-heading h1 {
  margin: 0;
  color: var(--report-accent);
  font-size: 19px;
  font-weight: 700;
  line-height: 1.25;
}

.report-month {
  display: block;
  margin-top: 1.5mm;
  color: var(--report-muted);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.report-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2mm 6mm;
  min-height: 11mm;
  padding: 2.5mm 0;
  color: var(--report-muted);
  font-size: 10px;
}

.report-meta span {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.report-table {
  flex-shrink: 0;
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color: var(--report-ink);
  font-size: 11px;
  line-height: 1.3;
}

.report-table th,
.report-table td {
  padding: 2.2mm 2mm;
  border: 0.6px solid var(--report-rule);
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: normal;
}

.report-table thead {
  display: table-header-group;
}

.report-table th {
  padding-top: 2.4mm;
  padding-bottom: 2.4mm;
  border-color: var(--report-rule-strong);
  background: var(--report-tint);
  color: #304942;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}

.report-table th:first-child,
.report-table td:first-child {
  width: 25%;
}

.report-table th:nth-child(2),
.report-table td:nth-child(2) {
  width: 18%;
}

.report-table th:nth-child(3),
.report-table td:nth-child(3) {
  width: 16%;
}

.report-table th:nth-child(4),
.report-table td:nth-child(4) {
  width: 8%;
}

.report-table th:nth-child(5),
.report-table td:nth-child(5) {
  width: 10%;
}

.report-table th:nth-child(6),
.report-table td:nth-child(6) {
  width: 12%;
}

.report-table th:nth-child(7),
.report-table td:nth-child(7) {
  width: 11%;
}

.report-table td {
  text-align: start;
}

.report-table td:nth-child(n + 4) {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.report-table tbody tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.report-table tbody tr:nth-child(even) {
  background: #f8faf8;
}

.report-table td strong,
.report-table td small {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.report-table td strong {
  color: var(--report-ink);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.report-table td small {
  margin-top: 0.7mm;
  color: var(--report-muted);
  font-size: 9px;
  line-height: 1.3;
}

.report-footer {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5mm;
  margin-top: auto;
  padding-top: 2mm;
  border-top: 0.6px solid var(--report-rule);
  color: var(--report-muted);
  font-size: 9px;
}

.report-footer > * {
  min-width: 0;
  overflow-wrap: anywhere;
}

.report-footer .page-counter,
.report-footer .report-page-number {
  color: var(--report-ink);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.report-footer time,
.report-footer [dir="ltr"],
.report-month,
.report-table td:nth-child(n + 4) {
  font-variant-numeric: tabular-nums;
}

@media screen {
  body {
    background: #e8eeeb;
  }

  .report-page {
    margin: 10mm auto;
    padding: 0;
    background: var(--report-paper);
    box-shadow: 0 2mm 8mm rgb(38 58 55 / 12%);
  }
}

@media print {
  html,
  body {
    width: 277mm;
    min-height: 177mm;
    margin: 0;
    background: var(--report-paper);
  }

  .report-document,
  .report-page {
    width: 277mm;
    height: 177mm;
    margin: 0;
  }

  .report-page {
    box-shadow: none;
  }

  .report-table tr,
  .report-header,
  .report-meta,
  .report-footer {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;
