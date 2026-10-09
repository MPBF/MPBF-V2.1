import { describe, expect, it, jest } from "@jest/globals";
import { machine } from "../server/production/machines";
import type { Connection } from "../server/production/core";
import type { ProductSnapshot, ProductionStage } from "../shared/production";

const product: ProductSnapshot = {
  id: 1, item_id: "ITM1", name: "Bag", name_ar: null, customer_name: null, customer_name_ar: null,
  width: "28", left_facing: "7", right_facing: "7", universal_thickness: "40",
  cutting_length_cm: 35, printing_cylinder: '14"', raw_material: "HDPE", punching: null,
  notes: null, front_print_colors: ["Red"], back_print_colors: [],
};
const printer = {
  id: "P1", name: "Printer", type: "printer", status: "active",
  min_width_cm: "10", max_width_cm: "75", min_cylinder_inch: "8", max_cylinder_inch: "39",
  max_print_colors: 2, min_thickness: null, max_thickness: null, raw_material_type: null,
  min_length_cm: null, max_length_cm: null,
};
const txFor = (overrides: Record<string, unknown> = {}): Connection => ({
  query: jest.fn<Connection["query"]>(async () => ({ rows: [{ ...printer, ...overrides }] })),
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
      ? { type: "extruder", min_thickness: "30", max_thickness: "50", raw_material_type: "HDPE" }
      : { type: "cutter", min_length_cm: "30", max_length_cm: "40" };
    await expect(machine(txFor(overrides), "P1", stage, { ...product, printing_cylinder: null })).resolves.toMatchObject({ id: "P1" });
  });
});
