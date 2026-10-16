import { describe, expect, it, jest } from "@jest/globals";
import { machine } from "../server/production/machines";
import type { Connection } from "../server/production/core";
import type { ProductSnapshot, ProductionStage } from "../shared/production";

const product: ProductSnapshot = {
  id: 1, item_id: "ITM1", name: "Bag", name_ar: null, customer_name: null, customer_name_ar: null,
  width: "28", left_facing: "7", right_facing: "7", thickness: "16", universal_thickness: "40",
  cutting_length_cm: 35, printing_cylinder: '14"', raw_material: "HDPE", punching: null,
  notes: null, front_print_colors: ["Red"], back_print_colors: [],
};
const printer = {
  id: "P1", name: "Printer", type: "printer", status: "active",
  min_width_cm: "10", max_width_cm: "75", min_cylinder_inch: "8", max_cylinder_inch: "39",
  max_print_colors: 2, min_thickness: null, max_thickness: null, raw_material_type: null,
  min_length_cm: null, max_length_cm: null,
};
const txFor = (overrides: Record<string, unknown> = {}, legacyThickness: string | null = null): Connection => ({
  query: jest.fn<Connection["query"]>(async sql => ({ rows: sql.startsWith("SELECT * FROM machines")
    ? [{ ...printer, ...overrides }] : [{ thickness: legacyThickness }] })),
  release: () => {},
});

describe("production machine cylinder limits", () => {
  it.each(['14"', '28"', "14", "28", " 14.5 \" ", "14″", "14”", "14 in", "14 inch", "14 inches",
    "14 IN.", "١٤\"", "۱۴٫۵ بوصة", "14 إنش", "14 انش"])(
    "accepts a valid inch cylinder represented as %s", async cylinder => {
      const snapshot = { ...product, printing_cylinder: cylinder };
      await expect(machine(txFor(), "P1", "printing", snapshot)).resolves.toMatchObject({ id: "P1" });
      expect(snapshot.printing_cylinder).toBe(cylinder);
    },
  );
  it.each(['8"', '39"', "٨ بوصة"])("accepts exact capability boundaries %s", async cylinder => {
    await expect(machine(txFor(), "P1", "printing", { ...product, printing_cylinder: cylinder })).resolves.toMatchObject({ id: "P1" });
  });
  it.each(["7.99\"", "39.01\"", "0", "-14", "1e1", "14xyz", "14 cm", "14/28", "14 28",
    "", " ", "Infinity", "NaN", "14\" garbage", null])(
    "rejects missing, malformed or genuinely out-of-range cylinder %s", async cylinder => {
      await expect(machine(txFor(), "P1", "printing", { ...product, printing_cylinder: cylinder }))
        .rejects.toMatchObject({ status: 409 });
    },
  );
  it("does not convert centimetres to inches without an explicit data contract", async () => {
    await expect(machine(txFor(), "P1", "printing", { ...product, printing_cylinder: "35.56 cm" }))
      .rejects.toMatchObject({ status: 409 });
  });
  it("preserves genuinely fixed cylinder limits", async () => {
    await expect(machine(txFor({ min_cylinder_inch: "20", max_cylinder_inch: "20" }), "P1", "printing", { ...product, printing_cylinder: '20"' }))
      .resolves.toMatchObject({ id: "P1" });
    await expect(machine(txFor({ min_cylinder_inch: "20", max_cylinder_inch: "20" }), "P1", "printing", product))
      .rejects.toMatchObject({ status: 409 });
  });
  it("preserves legacy machines without cylinder restrictions", async () => {
    await expect(machine(txFor({ min_cylinder_inch: null, max_cylinder_inch: null }), "P1", "printing", { ...product, printing_cylinder: null }))
      .resolves.toMatchObject({ id: "P1" });
  });
  it.each(["printer", "Printer", "printing"])("keeps supported printer type aliases: %s", async type => {
    await expect(machine(txFor({ type }), "P1", "printing", product)).resolves.toMatchObject({ id: "P1" });
  });
  it("keeps width, color capacity, active state and stage safeguards", async () => {
    for (const snapshot of [{ ...product, width: "76" }, { ...product, front_print_colors: ["Red", "Blue", "Black"] }]) {
      await expect(machine(txFor(), "P1", "printing", snapshot)).rejects.toMatchObject({ status: 409 });
    }
    for (const overrides of [{ status: "down" }, { type: "extruder" }]) {
      await expect(machine(txFor(overrides), "P1", "printing", product)).rejects.toMatchObject({ status: 409 });
    }
  });
  it.each(["film", "cutting"] as const)("does not apply cylinder validation to %s", async (stage: ProductionStage) => {
    const overrides = stage === "film"
      ? { type: "extruder", min_thickness: "10", max_thickness: "20", raw_material_type: "HDPE" }
      : { type: "cutter", min_length_cm: "30", max_length_cm: "40" };
    await expect(machine(txFor(overrides), "P1", stage, { ...product, printing_cylinder: null })).resolves.toMatchObject({ id: "P1" });
  });
});

describe("film limits use original product thickness", () => {
  const film = { type: "extruder", min_thickness: "4", max_thickness: "50", raw_material_type: "HDPE" };
  it("accepts raw thickness inside the range even when universal thickness exceeds it", async () => {
    await expect(machine(txFor(film), "F1", "film", { ...product, thickness: "32", universal_thickness: "80" }))
      .resolves.toMatchObject({ type: "extruder" });
  });
  it("rejects raw thickness outside the range even when universal thickness fits", async () => {
    await expect(machine(txFor(film), "F1", "film", { ...product, thickness: "60", universal_thickness: "40" }))
      .rejects.toMatchObject({ status: 409 });
  });
  it.each(["4", "50"])("accepts exact original-thickness boundary %s", async thickness => {
    await expect(machine(txFor(film), "F1", "film", { ...product, thickness })).resolves.toMatchObject({ status: "active" });
  });
  it.each(["3.999", "50.001", "", " ", "invalid", null])("rejects out-of-range or missing original thickness %s", async thickness => {
    await expect(machine(txFor(film), "F1", "film", { ...product, thickness })).rejects.toMatchObject({ status: 409 });
  });
  it("resolves missing legacy raw thickness through the guarded read-only projection", async () => {
    const { thickness: _raw, ...legacy } = product;
    const tx = txFor(film, "16");
    await expect(machine(tx, "F1", "film", legacy)).resolves.toMatchObject({ status: "active" });
    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(tx.query).toHaveBeenLastCalledWith(expect.stringContaining("IS NOT DISTINCT FROM cp.universal_thickness::text"),
      [JSON.stringify(legacy), product.id]);
    expect(legacy).not.toHaveProperty("thickness");
  });
  it("fails closed when legacy original thickness cannot be safely recovered", async () => {
    const { thickness: _raw, ...legacy } = product;
    await expect(machine(txFor(film, null), "F1", "film", legacy)).rejects.toMatchObject({ status: 409 });
  });
  it("does not replace deliberately saved missing raw thickness with live data", async () => {
    const tx = txFor(film, "16");
    await expect(machine(tx, "F1", "film", { ...product, thickness: null })).rejects.toMatchObject({ status: 409 });
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
});

describe("film machine material capabilities", () => {
  it.each([
    ["HDPE\\LDPE", "HDPE"], ["HDPE\\LDPE", "LDPE"],
    ["HDPE/LDPE", "HDPE"], ["HDPE/LDPE", "LDPE"],
    [" hdpe \\ ldpe ", " ldpe "], [" HDPE ", "hdpe"],
    ["LDPE", "ldpe"], ["Regrind", " regrind "],
  ])("accepts supported material %s → %s", async (machineMaterial, rawMaterial) => {
    await expect(machine(txFor({ type: "extruder", raw_material_type: machineMaterial }), "F1", "film",
      { ...product, raw_material: rawMaterial })).resolves.toMatchObject({ status: "active" });
  });
  it.each([
    ["HDPE\\LDPE", "Regrind"], ["HDPE\\LDPE", "HDPE-PLUS"],
    ["HDPE\\LDPE", "PE"], ["HDPE\\LDPE", ""], ["HDPE\\LDPE", null],
    ["HDPE", "LDPE"], ["LDPE", "HDPE"], ["Regrind", "HDPE"],
  ])("rejects unsupported or missing material %s → %s", async (machineMaterial, rawMaterial) => {
    await expect(machine(txFor({ type: "extruder", raw_material_type: machineMaterial }), "F1", "film",
      { ...product, raw_material: rawMaterial })).rejects.toMatchObject({
        status: 409, message: "المادة الخام لا تطابق الماكينة",
      });
  });
  it.each([null, "", "MIX", " mix "])("preserves the existing unrestricted material capability %s", async machineMaterial => {
    await expect(machine(txFor({ type: "extruder", raw_material_type: machineMaterial }), "F1", "film",
      { ...product, raw_material: "Regrind" })).resolves.toMatchObject({ status: "active" });
  });
  it.each(["printing", "cutting"] as const)("does not apply film-material limits to %s", async stage => {
    await expect(machine(txFor({ type: stage === "printing" ? "printer" : "cutter", raw_material_type: "HDPE" }),
      "P1", stage, { ...product, raw_material: "LDPE" })).resolves.toMatchObject({ status: "active" });
  });
});
