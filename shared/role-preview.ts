export type RolePreviewChoice = {
  id: number;
  name: string;
  name_ar: string | null;
};

/** Present only for an account whose real, database-backed role grants admin. */
export type RolePreviewState = {
  active: boolean;
  role_available: boolean;
  original_role: { id: number | null; name: string | null; name_ar: string | null };
};
