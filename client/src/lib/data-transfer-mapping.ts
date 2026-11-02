import type { TransferColumn, TransferTable } from "../../../shared/data-transfer";

export function exactMappingSuggestions(headers: string[], table: TransferTable): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.trim().toLocaleLowerCase();
    const matches = table.columns.filter(column =>
      column.writable && [column.name, column.labelAr, column.labelEn]
        .some(candidate => candidate.trim().toLocaleLowerCase() === normalized),
    );
    if (matches.length === 1) result[header] = matches[0].name;
  }
  return result;
}

// Reconcile cached/template bindings with this file and the current schema.
// Invalid destinations become an explicit skip, never a guessed replacement.
export function writableMappingColumns(
  headers: string[], table: TransferTable, columns: Record<string, string>,
): Record<string, string> {
  const sources = new Set(headers);
  const targets = new Set(table.columns.filter(column => column.writable).map(column => column.name));
  return Object.fromEntries(Object.entries(columns)
    .filter(([source]) => sources.has(source))
    .map(([source, target]) => [source, targets.has(target) ? target : ""]));
}

// Clearing is explicit and only meaningful for a writable mapped destination.
export function clearableMappingColumns(
  table: TransferTable | null,
  columns: Record<string, string>,
): TransferColumn[] {
  const targets = new Set(Object.values(columns).filter(Boolean));
  return table?.columns.filter(column =>
    targets.has(column.name) && column.writable && column.nullable && !column.generated,
  ) ?? [];
}

export function mappedNullColumns(
  table: TransferTable | null,
  columns: Record<string, string>,
  selected: string[],
): string[] {
  const allowed = new Set(clearableMappingColumns(table, columns).map(column => column.name));
  return [...new Set(selected)].filter(name => allowed.has(name));
}
