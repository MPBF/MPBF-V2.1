import type { TransferColumn, TransferTable } from "../../../shared/data-transfer";

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
