import { describe, expect, it } from "@jest/globals";
import { filmOperationSpecs, filmRemainingQuantity, filmSearchTerm } from "../client/src/lib/film-operation-specs";
import { formatNumber, formatWholeNumber } from "../client/src/lib/format-number";
import type { ProductSnapshot } from "../shared/production";

const product: ProductSnapshot = {
  id: 1, item_id: "BAG", name: "Bag", name_ar: "كيس", customer_name: "Customer", customer_name_ar: "عميل",
  width: "28", left_facing: "7", right_facing: "7", universal_thickness: "35", cutting_length_cm: 40,
  raw_material: "HDPE", printing_cylinder: null, punching: null, notes: null,
  front_print_colors: ["Red"], back_print_colors: ["Black"],
  master_batch: { id: "BLUE", name: "Blue", name_ar: "أزرق", color_hex: "#2463EB" },
};
const format = (value: string | number | null | undefined) => String(value);
const specs = (changes: Partial<ProductSnapshot> = {}, language = "en") =>
  filmOperationSpecs({ ...product, ...changes }, language, format, language === "en" ? "Unrecorded" : "غير مسجل");

describe("film operation specs", () => {
  it("displays saved size, physical film thickness and material", () => {
    const value = specs({ size_caption: " 28 + 7 + 7 cm " });
    expect(value.size).toBe("28 + 7 + 7 cm");
    expect(value.material).toBe("HDPE");
    expect(value.thickness).toBe("35 µm");
  });
  it("displays master-batch film color, not printing ink colors", () => {
    expect(specs().batchName).toBe("Blue");
    expect(specs({}, "ar").batchName).toBe("أزرق");
  });
  it("uses frozen width and positive gussets when caption is missing", () => {
    expect(specs().size).toBe("28 + 7 + 7 cm");
    expect(specs({ left_facing: "0", right_facing: "0" }).size).toBe("28 cm");
    expect(specs({ left_facing: null }).size).toBe("28 + 7 cm");
    expect(specs({}, "ar").size).toBe("28 + 7 + 7 cm");
    expect(specs({size_caption:"العرض 28 cm · الكسرة 7 / 7 cm"}, "ar").size).toBe("28 cm · 7 / 7 cm");
  });
  it("does not invent dimensions or thickness from invalid numeric text", () => {
    const value = specs({ width: "broken", left_facing: null, right_facing: "0", universal_thickness: "" });
    expect(value.size).toBe("Unrecorded");
    expect(value.thickness).toBe("Unrecorded");
  });
  it("distinguishes transparent master batch from ordinary solid white", () => {
    expect(specs({ master_batch: { id: "TRANS", name: "Transparent", name_ar: "شفاف", color_hex: "#FFFFFF" } }).batchName).toBe("Transparent");
    expect(specs({ master_batch: { id: "WHITE", name: "White", name_ar: "أبيض", color_hex: "#FFFFFF" } }).batchName).toBe("White");
  });
  it("explicitly displays missing color instead of assuming white", () => {
    expect(specs({ master_batch: null }).batchName).toBe("Unrecorded");
    expect(specs({ master_batch: null }).batch).toBeNull();
  });
  it("English skips Arabic text and blanks throughout fallbacks", () => {
    const value = specs({ size_caption: "مقاس عربي", raw_material: "خامة عربية",
      master_batch: { id: "X", name: "اسم عربي", name_ar: "اسم", color_hex: "#2463EB" } });
    expect(value.size).toBe("28 + 7 + 7 cm");
    expect(value.material).toBe("Unrecorded");
    expect(value.batchName).toBe("#2463EB");
    expect(specs({ master_batch: { id: "X", name: " ", name_ar: " ", color_hex: "#fff" } }).batchName).toBe("#fff");
  });
  it("normalizes Arabic and Persian typed order digits for phone search", () => {
    expect(filmSearchTerm(" PO-٢ ")).toBe("po-2");
    expect(filmSearchTerm(" ORDER-۱۲۳ ")).toBe("order-123");
    expect(filmSearchTerm("عميل")).toBe("عميل");
  });
  it("handles absent products without guessing", () => {
    const value = filmOperationSpecs(null, "ar", format, "غير مسجل");
    expect(value.size).toBe("غير مسجل");
    expect(value.batchName).toBe("غير مسجل");
  });

  it("rounds film display to whole numbers while keeping normal display precision", () => {
    expect(formatWholeNumber("12.34")).toBe("12");
    expect(formatWholeNumber("12.50")).toBe("13");
    expect(formatWholeNumber("1234.56")).toBe("1,235");
    expect(formatNumber("12.34")).toBe("12.34");
    expect(formatWholeNumber(null)).toBe("—");
    expect(formatWholeNumber("broken")).toBe("—");
  });

  it("rounds numeric specs and decimal captions without mutating saved specs", () => {
    const saved = { ...product, size_caption: "28.5 + 7.25 + 7.25 cm", universal_thickness: "35.6" };
    const before = structuredClone(saved);
    const value = filmOperationSpecs(saved, "en", formatWholeNumber, "Unrecorded");
    expect(value.size).toBe("29 + 7 + 7 cm");
    expect(value.thickness).toBe("36 µm");
    expect(saved).toEqual(before);
    expect(filmOperationSpecs({ ...saved, size_caption: "٢٨٫٥ + ٧٫٢٥ سم" }, "ar",
      formatWholeNumber, "غير مسجل").size).toBe("29 + 7 سم");
  });

  it("computes remaining production from raw quantities before rounding the result", () => {
    expect(filmRemainingQuantity("110.49", "10.51")).toBe(99.98);
    expect(formatWholeNumber(filmRemainingQuantity("110.49", "10.51"))).toBe("100");
    expect(filmRemainingQuantity("100.10", "0.60")).toBe(99.5);
    expect(formatWholeNumber(filmRemainingQuantity("100.10", "0.60"))).toBe("100");
    expect(filmRemainingQuantity("10.00", "12.50")).toBe(0);
    expect(filmRemainingQuantity("10.00", "0.00")).toBe(10);
  });

  it("does not fabricate remaining quantities when raw data is missing or invalid", () => {
    for (const value of [null, undefined, "", "broken", "-1"]) {
      expect(filmRemainingQuantity(value, "1")).toBeNull();
      expect(filmRemainingQuantity("10", value)).toBeNull();
    }
  });
});
