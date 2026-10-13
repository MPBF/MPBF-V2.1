import type { TransferColumn, TransferFile, TransferMapping, TransferPreviewRow, TransferRow, TransferSchema } from "../../shared/data-transfer";
import { approved, hash, type Snapshot } from "./schema";
import { fail, MAX_ROWS } from "./policy";

export function valueFor(column: TransferColumn, value: unknown): string | null {
  if (value === null) {
    if (!column.nullable) fail("Required field cannot be cleared");
    return null;
  }
  if (typeof value !== "string" || value.includes("\0") || value.length > 10000) fail("Value must be bounded text without null bytes");
  if (column.maxLength !== null && [...value].length > column.maxLength) fail("Text exceeds column length");
  if (["smallint", "integer", "bigint"].includes(column.type)) {
    if (!/^-?\d+$/.test(value)) fail("Whole number required");
    const limits = column.type === "smallint" ? [-32768n, 32767n] :
      column.type === "integer" ? [-2147483648n, 2147483647n] : [-9223372036854775808n, 9223372036854775807n];
    const number = BigInt(value);
    if (number < limits[0] || number > limits[1]) fail("Integer out of range");
    return number.toString();
  }
  if (column.type === "numeric") {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) fail("Exact decimal text required");
    const [whole, decimal = ""] = value.replace(/^-/, "").split(".");
    if (column.scale !== null && decimal.length > column.scale) fail("Decimal scale exceeded; rounding is not allowed");
    if (column.precision !== null && whole.replace(/^0+/, "").length > column.precision - (column.scale ?? 0)) fail("Decimal precision exceeded");
  }
  if (column.type === "boolean" && !["true", "false"].includes(value)) fail("Boolean must be true or false");
  if (column.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) fail("Invalid ISO date");
  }
  if (column.type.startsWith("timestamp") && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) fail("Invalid ISO timestamp");
  return value;
}
const same = (a: string | null | undefined, b: string | null | undefined) => a === b;
export function makePreview(schema: TransferSchema, file: TransferFile, mappings: TransferMapping[], graph: Snapshot): TransferPreviewRow[] {
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 10 ||
    new Set(mappings.map(m => m.fileTable)).size !== mappings.length ||
    new Set(mappings.map(m => m.table)).size !== mappings.length) fail("Choose one mapping per unique table");
  if (file.tables.reduce((n, t) => n + t.rows.length, 0) > MAX_ROWS) fail("Row limit");
  const rows: TransferPreviewRow[] = [];
  for (const mapping of mappings) {
    const table = approved(schema, mapping.table, true);
    const input = file.tables.find(t => t.name === mapping.fileTable);
    if (!input) fail("File table not found");
    if (!Array.isArray(mapping.matchKey) || !table.keys.some(k => hash(k) === hash(mapping.matchKey)) ||
      mapping.matchKey.some(k => !table.columns.find(c => c.name === k)?.writable)) fail("Select an approved reliable match key");
    if (!mapping.columns || typeof mapping.columns !== "object" || Array.isArray(mapping.columns)) fail("Invalid mapping");
    const targets = Object.values(mapping.columns).filter(Boolean);
    if (new Set(targets).size !== targets.length) fail("Ambiguous duplicate column mapping");
    for (const [from, to] of Object.entries(mapping.columns)) {
      if (!input.headers.includes(from) || (to && !table.columns.find(c => c.name === to)?.writable)) fail("Mapping contains protected or unknown column");
    }
    if (!Array.isArray(mapping.nullColumns) || mapping.nullColumns.some(c => !targets.includes(c) || !table.columns.find(x => x.name === c)?.nullable)) fail("Invalid explicit empty-value choice");
    const seen = new Set<string>();
    for (const raw of input.rows) {
      const row: TransferPreviewRow = { index: rows.length, table: table.name, status: "new", values: {}, old: null, changes: [], errors: [] };
      for (const [source, target] of Object.entries(mapping.columns)) {
        if (!target) continue;
        const rawValue = raw[source];
        if (rawValue === undefined || rawValue === "" || rawValue === null) {
          if (mapping.nullColumns.includes(target)) row.values[target] = null;
          continue;
        }
        try {
          const column = table.columns.find(c => c.name === target)!;
          if (file.source !== "same-database" && table.relations.some(r => r.columns.includes(target)) &&
            (["integer", "bigint", "smallint"].includes(column.type) || /^\d+$/.test(rawValue))) fail("Numeric foreign IDs from another source are not trusted");
          row.values[target] = valueFor(column, rawValue);
        } catch (e) { row.errors.push({ column: target, message: (e as Error).message }); }
      }
      for (const key of mapping.matchKey) {
        if (row.values[key] == null || row.values[key] === "") row.errors.push({ column: key, message: "Match key is required" });
        if (file.source !== "same-database" && key === "id" && /^\d+$/.test(row.values[key] ?? ""))
          row.errors.push({ column:key,message:"Numeric IDs from another source are not trusted; use a stable business code or a verified local JSON package" });
      }
      const key = hash(mapping.matchKey.map(k => row.values[k]));
      if (seen.has(key)) { row.status = "conflict"; row.errors.push({ column: mapping.matchKey.join(","), message: "Duplicate match key in file" }); }
      seen.add(key);
      const matches = (graph[table.name] ?? []).filter(r => mapping.matchKey.every(k => same(r[k], row.values[k])));
      if (matches.length > 1) { row.status = "conflict"; row.errors.push({ column: "", message: "Ambiguous database match" }); }
      if (matches.length === 1) {
        row.old = matches[0];
        if (row.status !== "conflict") row.status = "existing";
        for (const [column, value] of Object.entries(row.values)) {
          if (!same(row.old[column], value)) {
            if (table.keys.some(k => k.includes(column))) row.errors.push({ column, message: "Existing identifiers cannot be changed" });
            else row.changes.push({ column, old: row.old[column], new: value });
          }
        }
      } else {
        for (const c of table.columns.filter(c => !c.generated && !c.nullable && !c.default)) {
          if (row.values[c.name] == null) row.errors.push({ column: c.name, message: "Required field missing for new row" });
        }
      }
      if (row.errors.length && row.status !== "conflict") row.status = "invalid";
      rows.push(row);
    }
  }
  const projected = project(graph, rows);
  for (const row of rows) {
    const merged = { ...row.old, ...row.values };
    try {
      validateBusiness(row.table, merged, projected);
      const table = approved(schema, row.table, true);
      for (const relation of table.relations) {
        if (relation.columns.every(c => merged[c] != null) &&
          !projected[relation.table]?.some(r => relation.columns.every((c, i) => r[relation.targets[i]] === merged[c])))
          fail("Foreign relationship is missing");
      }
      for (const key of table.keys) {
        if (key.every(k => merged[k] != null) &&
          projected[row.table].filter(r => key.every(k => r[k] === merged[k])).length > 1) {
          row.status = "conflict"; fail("Duplicate unique key");
        }
      }
    }
    catch (e) { row.errors.push({ column: "", message: (e as Error).message }); if (row.status !== "conflict") row.status = "invalid"; }
  }
  return rows;
}
export function project(graph: Snapshot, rows: TransferPreviewRow[]): Snapshot {
  const result: Snapshot = structuredClone(graph);
  for (const row of rows) {
    if (!result[row.table]) result[row.table] = [];
    if (row.old) {
      const i = result[row.table].findIndex(r => hash(r) === hash(row.old));
      if (i >= 0) result[row.table][i] = { ...row.old, ...row.values };
    } else result[row.table].push(row.values);
  }
  return result;
}
export function validateBusiness(table: string, row: TransferRow, graph: Snapshot) {
  const has = (table: string, value: string) => graph[table]?.some(r => r.id === value);
  if (["customers", "categories"].includes(table) && !row.name?.trim()) fail("English name is required");
  if (table === "customers") {
    if (row.tax_number != null && !/^\d{10,20}$/.test(row.tax_number)) fail("Tax number must contain 10–20 digits");
    if (row.unified_number != null && !/^7\d{9}$/.test(row.unified_number)) fail("Unified number must be 10 digits starting with 7");
  }
  if (table === "categories") {
    if (row.overrun_percentage != null && !["0", "5", "10", "20"].includes(row.overrun_percentage)) fail("Overrun must be 0, 5, 10 or 20");
    if (row.parent_id && !has("categories", row.parent_id)) fail("Parent category does not exist");
    const visited = new Set([row.id]);
    let current = row.parent_id;
    while (current) {
      if (visited.has(current)) fail("Category cycle is not allowed");
      visited.add(current);
      current = graph.categories.find(r => r.id === current)?.parent_id ?? null;
    }
  }
  if (table === "items") {
    if (row.category_id && !has("categories", row.category_id)) fail("Item category does not exist");
    if (row.status != null && !["active", "inactive"].includes(row.status)) fail("Invalid item status");
  }
}
