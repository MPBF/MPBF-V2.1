const machineTypeAliases: Record<string, string> = {
  extruder: "extruder",
  printing: "printer",
  printer: "printer",
  cutting: "cutter",
  cutter: "cutter",
  quality_check: "quality_check",
};

export const MACHINE_CAPACITY_TYPES = ["extruder", "printer", "cutter"] as const;
export const MACHINE_RAW_MATERIAL_TYPES = ["HDPE", "LDPE", "HDPE\\LDPE", "Regrind"] as const;

export function canonicalMachineType(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return machineTypeAliases[normalized] || normalized;
}

export function machineTypeMatches(allowedTypes: string, actualType: unknown): boolean {
  const actual = canonicalMachineType(actualType);
  return allowedTypes.split("|").some((type) => canonicalMachineType(type) === actual);
}

export function eligibleInlinePrinterMachines<T extends { id?: unknown; type?: unknown }>(
  machines: T[],
  currentMachineId: unknown,
): T[] {
  return machines.filter((machine) =>
    canonicalMachineType(machine.type) === "printer" &&
    String(machine.id) !== String(currentMachineId),
  );
}

export function usesGeneratedAdminId(path: string): boolean {
  return [
    "/sections",
    "/machines",
    "/maintenance-component-catalog",
    "/categories",
    "/items",
    "/master-batch-colors",
  ].includes(path);
}

export function newAdminFormDefaults(path: string): Record<string, boolean | string> {
  if (path === "/categories") return { overrun_percentage: "0" };
  if (path === "/maintenance-component-catalog") return { enabled: true };
  if (path === "/master-batch-colors") {
    return { is_active: true, color_hex: "#FFFFFF", text_color: "#000000" };
  }
  return {};
}