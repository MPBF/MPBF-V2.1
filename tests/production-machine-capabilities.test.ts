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

describe("field-specific bilingual capability feedback", () => {
  const dimensions: {
    name: string; stage: ProductionStage; type: string; field: keyof ProductSnapshot;
    min: string; max: string; ar: string; en: string; arUnit: string; enUnit: string;
  }[] = [
    { name: "film width", stage: "film", type: "extruder", field: "width", min: "min_width_cm", max: "max_width_cm", ar: "العرض", en: "Width", arUnit: " سم", enUnit: " cm" },
    { name: "printing width", stage: "printing", type: "printer", field: "width", min: "min_width_cm", max: "max_width_cm", ar: "العرض", en: "Width", arUnit: " سم", enUnit: " cm" },
    { name: "original thickness", stage: "film", type: "extruder", field: "thickness", min: "min_thickness", max: "max_thickness", ar: "السماكة الأصلية", en: "Original thickness", arUnit: "", enUnit: "" },
    { name: "cutting length", stage: "cutting", type: "cutter", field: "cutting_length_cm", min: "min_length_cm", max: "max_length_cm", ar: "طول القص", en: "Cutting length", arUnit: " سم", enUnit: " cm" },
    { name: "printing cylinder", stage: "printing", type: "printer", field: "printing_cylinder", min: "min_cylinder_inch", max: "max_cylinder_inch", ar: "سلندر الطباعة", en: "Printing cylinder", arUnit: " بوصة", enUnit: " in" },
  ];
  describe.each(dimensions)("$name", dimension => {
    const limits = { type: dimension.type, [dimension.min]: "10", [dimension.max]: "20" };
    const snapshot = (value: unknown) => ({ ...product, [dimension.field]: value }) as ProductSnapshot;
    it.each([["9.999", "below"], ["20.001", "above"]])("explains value %s and the failed %s limit", async (value, side) => {
      const below = side === "below", limit = below ? "10" : "20";
      const saved = Object.freeze(snapshot(value));
      await expect(machine(txFor(limits), "M1", dimension.stage, saved)).rejects.toMatchObject({
        status: 409,
        message: `${dimension.ar} ${value}${dimension.arUnit} ${below ? "أقل من الحد الأدنى" : "أعلى من الحد الأقصى"} ${limit}${dimension.arUnit}.`,
        message_en: `${dimension.en} ${value}${dimension.enUnit} ${below ? "is below the minimum" : "exceeds the maximum"} ${limit}${dimension.enUnit}.`,
      });
      expect(saved[dimension.field]).toBe(value);
    });
    it.each([null, "", " ", "invalid", "Infinity", "NaN"])("names the missing or invalid field (%s) and both limits", async value => {
      await expect(machine(txFor(limits), "M1", dimension.stage, snapshot(value))).rejects.toMatchObject({
        status: 409,
        message: `قيمة ${dimension.ar} غير مسجلة أو غير صالحة. حدود الماكينة: 10${dimension.arUnit} – 20${dimension.arUnit}.`,
        message_en: `${dimension.en} is missing or invalid. Machine limits: 10${dimension.enUnit} – 20${dimension.enUnit}.`,
      });
    });
    it.each(["10", "15", "20"])("accepts value %s including exact boundaries", async value => {
      await expect(machine(txFor(limits), "M1", dimension.stage, snapshot(value))).resolves.toMatchObject({ status: "active" });
    });
    it.each(["min", "max"])("explains and preserves a one-sided %s limit", async side => {
      const minimum = side === "min";
      const overrides = { ...limits, [minimum ? dimension.max : dimension.min]: null };
      await expect(machine(txFor(overrides), "M1", dimension.stage, snapshot(null))).rejects.toMatchObject({
        message: `قيمة ${dimension.ar} غير مسجلة أو غير صالحة. ${minimum ? "الحد الأدنى: 10" : "الحد الأقصى: 20"}${dimension.arUnit}.`,
        message_en: `${dimension.en} is missing or invalid. ${minimum ? "Minimum: 10" : "Maximum: 20"}${dimension.enUnit}.`,
      });
      await expect(machine(txFor(overrides), "M1", dimension.stage, snapshot(minimum ? "9" : "21"))).rejects.toMatchObject({ status: 409 });
      await expect(machine(txFor(overrides), "M1", dimension.stage, snapshot(minimum ? "21" : "9"))).resolves.toMatchObject({ status: "active" });
    });
    it("does not require the field when neither machine limit is configured", async () => {
      await expect(machine(txFor({ ...limits, [dimension.min]: null, [dimension.max]: null }),
        "M1", dimension.stage, snapshot(null))).resolves.toMatchObject({ status: "active" });
    });
  });
  it("keeps the first failed field in the existing width-before-thickness order", async () => {
    await expect(machine(txFor({ type: "extruder", min_thickness: "10", max_thickness: "20" }),
      "F1", "film", { ...product, width: "76", thickness: null })).rejects.toMatchObject({
      message: "العرض 76 سم أعلى من الحد الأقصى 75 سم.",
      message_en: "Width 76 cm exceeds the maximum 75 cm.",
    });
  });
  it("never exposes or substitutes universal thickness when original thickness is missing", async () => {
    await expect(machine(txFor({ type: "extruder", min_thickness: "10", max_thickness: "20" }),
      "F1", "film", { ...product, thickness: null, universal_thickness: "98765" })).rejects.toMatchObject({
      message: "قيمة السماكة الأصلية غير مسجلة أو غير صالحة. حدود الماكينة: 10 – 20.",
      message_en: "Original thickness is missing or invalid. Machine limits: 10 – 20.",
    });
  });
  it("explains unrecoverable legacy thickness without rewriting the saved snapshot", async () => {
    const { thickness: _raw, ...legacy } = product;
    const saved = Object.freeze(legacy);
    const tx = txFor({ type: "extruder", min_thickness: "10", max_thickness: "20" });
    await expect(machine(tx, "F1", "film", saved)).rejects.toMatchObject({
      message_en: "Original thickness is missing or invalid. Machine limits: 10 – 20.",
    });
    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(saved).not.toHaveProperty("thickness");
  });
  it("does not apply width or thickness restrictions at the cutting stage", async () => {
    await expect(machine(txFor({ type: "cutter", min_thickness: "10", max_thickness: "20", min_length_cm: "30", max_length_cm: "40" }),
      "C1", "cutting", { ...product, width: null, thickness: null })).resolves.toMatchObject({ status: "active" });
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
