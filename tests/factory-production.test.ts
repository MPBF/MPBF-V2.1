import { describe, expect, it } from "@jest/globals";
import { eligibleForCutting, filmRollReachesTarget, hasProductionPermission, isPlasticRoll, kgHundredths, kgString, machineStage, stageAfterFilm, stageAfterPrinting } from "../shared/production";
import { initialProductionPath } from "../client/src/lib/production-navigation";

describe("factory production exact quantities and routing", () => {
  it("does not round imprecise, negative, exponent or grouped input", () => {
    for (const input of ["1.001", "-1", "1e2", "1,000", "", "NaN"]) expect(() => kgHundredths(input)).toThrow();
    expect(kgHundredths("0.01")).toBe(1n);
    expect(kgString(kgHundredths("999999999999.99"))).toBe("999999999999.99");
    expect(kgHundredths("0.1") + kgHundredths("0.2")).toBe(30n);
  });
  it.each([
    ["100.00", "80.00", "19.99", false],
    ["100.00", "80.00", "20.00", true],
    ["100.00", "80.00", "25.00", true],
    ["100.00", "0.00", "125.00", true],
    ["0.30", "0.10", "0.20", true],
    ["100.00", "100.00", "0.01", true],
    ["100.00", "100.00", "0.00", false],
  ])("marks planned=%s produced=%s roll=%s as final=%s", (planned, produced, weight, expected) => {
    expect(filmRollReachesTarget(planned, produced, weight)).toBe(expected);
  });
  it("does not classify invalid weight input as a valid final roll", () => {
    for (const weight of ["", "-1", "1.001", "1e2", "NaN"]) {
      expect(() => filmRollReachesTarget("100.00", "80.00", weight)).toThrow();
    }
  });
  it.each([[false, false, "film"], [true, false, "film"], [false, true, "done"], [true, true, "film"]] as const)(
    "routes printed=%s rollProduct=%s to %s", (printed, roll, stage) => expect(stageAfterFilm(printed, roll, false)).toBe(stage),
  );
  it("inline printing advances bags to cutting eligibility and plastic rolls to done", () => {
    expect(stageAfterFilm(true, false, true)).toBe("printing");
    expect(stageAfterFilm(true, true, true)).toBe("done");
    expect(stageAfterPrinting(false)).toBe("printing");
    expect(stageAfterPrinting(true)).toBe("done");
    expect(eligibleForCutting({ is_printed: true, is_roll_product: false, stage: "film", printed_at: null })).toBe(false);
    expect(eligibleForCutting({ is_printed: false, is_roll_product: false, stage: "film", printed_at: null })).toBe(true);
    expect(eligibleForCutting({ is_printed: true, is_roll_product: false, stage: "printing", printed_at: "now" })).toBe(true);
    expect(eligibleForCutting({ is_printed: false, is_roll_product: true, stage: "done", printed_at: null })).toBe(false);
  });
  it("detects by item name, not a category", () => {
    expect(isPlasticRoll("Plastic Roll", null)).toBe(true);
    expect(isPlasticRoll(null, "رولات بلاستيكية مطبوعة")).toBe(true);
    expect(isPlasticRoll("T-shirt bag", "أكياس علاقي")).toBe(false);
  });
  it.each(["Printer", "printer", "printing"])("normalizes %s", value => expect(machineStage(value)).toBe("printing"));
  it("uses explicit admin permission, not a role number or wildcard", () => {
    expect(hasProductionPermission({ id: 1, permissions: [] }, "operate_film")).toBe(false);
    expect(hasProductionPermission({ id: 10, permissions: ["admin"] }, "operate_film")).toBe(true);
    expect(hasProductionPermission({ id: 1, permissions: ["manage_production"] }, "operate_film")).toBe(false);
  });
  it("routes operator/warehouse-only users to their permitted surface", () => {
    expect(initialProductionPath({ id: 1, permissions: ["operate_film"] })).toBe("/production/film");
    // Warehouse views now belong to their own module, not production tabs.
    expect(initialProductionPath({ id: 1, permissions: ["receive_production"] })).toBeNull();
    expect(initialProductionPath({ id: 1, permissions: ["view_finished_inventory"] })).toBeNull();
    expect(initialProductionPath({ id: 1, permissions: ["*"] })).toBeNull();
  });
});