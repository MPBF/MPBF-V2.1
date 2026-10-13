export type TransferRow = Record<string, string | null>;
export type TransferColumn = {
  name: string; labelAr: string; labelEn: string; type: string; nullable: boolean;
  default: string | null; generated: boolean; writable: boolean; maxLength: number | null;
  precision: number | null; scale: number | null; identity?: boolean;
};
export type TransferRelation = { columns: string[]; table: string; targets: string[] };
export type TransferTable = {
  name: string; labelAr: string; labelEn: string; group: string; approved: boolean;
  exportable: boolean; importable: boolean; reasonAr: string; reasonEn: string;
  columns: TransferColumn[]; keys: string[][]; relations: TransferRelation[];
};
export type TransferSchema = {
  version: string; environment: string; tables: TransferTable[]; ready: boolean;
  limits: { bytes: number; rows: number; retentionDays: number };
};
export type TransferFile = {
  tables: { name: string; headers: string[]; rows: TransferRow[] }[];
  source: "external" | "same-database"; schemaVersion?: string;
  receipt?: string;
};
export type TransferMapping = {
  table: string; fileTable: string; columns: Record<string, string>;
  matchKey: string[]; nullColumns: string[];
};
export type TransferDiff = { column: string; old: string | null; new: string | null };
export type TransferPreviewRow = {
  index: number; table: string; status: "new" | "existing" | "conflict" | "invalid";
  values: TransferRow; old: TransferRow | null; changes: TransferDiff[];
  errors: { column: string; message: string }[];
};
export type TransferPreview = {
  id: string; version: string; expiresAt: string; rows: TransferPreviewRow[];
  kind: "import" | "restore"; retainedInserts?: number; requiresAdminConfirmation?: boolean;
};
export type TransferApproval = { index: number; columns: string[] };
export type TransferOperation = {
  id: string; actor: number; kind: string; status: string; createdAt: string;
  counts: { inserted?: number; updated?: number; rows?: number }; backup: boolean;
};
export type TransferTemplate = { id: string; name: string; version: string; mappings: TransferMapping[] };
