export type DatabaseBackupTableSummary = {
  name: string;
  currentRows: number;
  backupRows: number;
};
export type DatabaseBackupPreview = {
  id: string;
  createdAt: string;
  expiresAt: string;
  environment: "development" | "production";
  tables: DatabaseBackupTableSummary[];
  excludedTables: string[];
  totalRows: number;
  safetyReady: boolean;
};
export type DatabaseRestoreResult = {
  id: string;
  restoredTables: number;
  restoredRows: number;
  restoredAt: string;
  requiresLogin: true;
};
