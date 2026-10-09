import { describe, expect, it } from "@jest/globals";

import {
  canonicalMachineType,
  eligibleInlinePrinterMachines,
  MACHINE_CAPACITY_TYPES,
  MACHINE_RAW_MATERIAL_TYPES,
  machineTypeMatches,
  newAdminFormDefaults,
  usesGeneratedAdminId,
} from "../client/src/lib/admin-form-review";

describe("administration form review helpers", () => {
  it("maps legacy machine-type spellings to the matching UI type", () => {
    expect(["extruder", "printing", "cutting", "Printer", "Cutter"].map(canonicalMachineType))
      .toEqual(["extruder", "printer", "cutter", "printer", "cutter"]);
    expect(machineTypeMatches("printer", "printing")).toBe(true);
    expect(machineTypeMatches("cutter", "Cutter")).toBe(true);
    expect(machineTypeMatches("extruder|printer", "printing")).toBe(true);
    expect(machineTypeMatches(MACHINE_CAPACITY_TYPES.join("|"), "cutting")).toBe(true);
  });

  it("offers legacy printer spellings for inline printers but excludes the current machine", () => {
    const machines = [
      { id: "MAC01", type: "printing" },
      { id: "MAC02", type: "Printer" },
      { id: "MAC03", type: "cutting" },
      { id: "MAC04", type: "printer" },
    ];

    expect(eligibleInlinePrinterMachines(machines, "MAC02").map(({ id }) => id))
      .toEqual(["MAC01", "MAC04"]);
  });

  it("scopes generated IDs to the approved administration records", () => {
    expect(usesGeneratedAdminId("/machines")).toBe(true);
    expect(usesGeneratedAdminId("/master-batch-colors")).toBe(true);
    expect(usesGeneratedAdminId("/customers")).toBe(false);
  });

  it("starts new components and masterbatch colors with schema-friendly defaults", () => {
    expect(newAdminFormDefaults("/maintenance-component-catalog")).toEqual({ enabled: true });
    expect(newAdminFormDefaults("/master-batch-colors")).toEqual({
      is_active: true,
      color_hex: "#FFFFFF",
      text_color: "#000000",
    });
  });

  it("includes the existing HDPE/LDPE blend in machine material choices", () => {
    expect(MACHINE_RAW_MATERIAL_TYPES).toContain("HDPE\\LDPE");
  });

  it("defaults new categories to zero production overrun", () => {
    expect(newAdminFormDefaults("/categories")).toEqual({ overrun_percentage: "0" });
  });
});