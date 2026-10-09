export function isAdministrator(permissions: unknown): boolean {
  return Array.isArray(permissions) && permissions.includes("admin");
}

export function canGrantPermissions(actorPermissions: unknown, grant: unknown): boolean {
  if (isAdministrator(actorPermissions)) return true;
  if (!Array.isArray(actorPermissions) || !Array.isArray(grant)) return false;
  return grant.every((permission) =>
    typeof permission === "string" &&
    permission !== "admin" &&
    permission !== "*" &&
    (actorPermissions.includes("*") || actorPermissions.includes(permission)),
  );
}

export function plannedFinalQuantity(quantityKg: string, overrunPercentage: string): string {
  const planned = Number(quantityKg) * (1 + Number(overrunPercentage) / 100);
  return (Math.round((planned + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function isProtectedProductionOrder(
  status: unknown,
  batchNumber: unknown,
  previousStatus?: unknown,
): boolean {
  return status !== "pending" ||
    (previousStatus !== null && previousStatus !== undefined && previousStatus !== "pending") ||
    (typeof batchNumber === "string" && batchNumber.trim().length > 0);
}