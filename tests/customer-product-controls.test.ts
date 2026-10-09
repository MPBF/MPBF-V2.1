import { describe, expect, it } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRODUCT_SELECT_VALUES, ProductValueSelect, unitWeightLabel } from "../client/src/components/customer-product-controls";

describe("customer product dropdowns", () => {
  it.each([
    ["facing", 0, 50],
    ["width", 10, 100],
    ["thickness", 1, 60],
    ["cuttingLength", 0, 300],
    ["packageQuantity", 1, 25],
  ] as const)("includes every integer in the requested %s range", (key, min, max) => {
    expect(PRODUCT_SELECT_VALUES[key]).toEqual(Array.from({ length: max - min + 1 }, (_, index) => String(min + index)));
  });

  it("offers only the three requested densities", () => {
    expect(PRODUCT_SELECT_VALUES.density).toEqual(["0.95", "1", "1.15"]);
  });

  it("offers the requested units in order", () => {
    expect(PRODUCT_SELECT_VALUES.cuttingUnit).toEqual(["كيلو", "رول", "باكت", "كيس", "كرتون"]);
  });
  it("offers every 50-gram weight from 100 to 3000, with kilogram payload values", () => {
    expect(PRODUCT_SELECT_VALUES.unitWeightKg.map(Number)).toEqual(Array.from({ length: 59 }, (_, index) => (100 + index * 50) / 1000));
    expect(PRODUCT_SELECT_VALUES.unitWeightKg.map(unitWeightLabel)).toEqual(Array.from({ length: 59 }, (_, index) => `${100 + index * 50} جرام`));
  });
  it("displays both stored and historical weights in grams without changing their kilogram values", () => {
    const renderWeight = (value: string) => renderToStaticMarkup(createElement(ProductValueSelect, {
      id: "weight", label: "وزن الوحدة (جرام)", value, values: PRODUCT_SELECT_VALUES.unitWeightKg, labelForValue: unitWeightLabel, onChange: () => {},
    }));
    expect(renderWeight("0.150")).toContain('<option value="0.15" selected="">150 جرام</option>');
    expect(renderWeight("4.125")).toContain('<option value="4.125" selected="">القيمة الحالية: 4125 جرام</option>');
  });

  const render = (value: unknown, values: string[], zeroMeansUnset = false) => renderToStaticMarkup(createElement(ProductValueSelect, {
    id: "test-value", label: "القيمة", value, values, zeroMeansUnset, onChange: () => {},
  }));
  it("keeps out-of-range historical values selected", () => {
    expect(render("150", PRODUCT_SELECT_VALUES.width)).toContain('<option value="150" selected="">القيمة الحالية: 150</option>');
  });
  it("matches historical numeric formatting without adding duplicate options", () => {
    const html = render("1.000", PRODUCT_SELECT_VALUES.density);
    expect(html).toContain('<option value="1" selected="">1</option>');
    expect(html).not.toContain("القيمة الحالية");
  });
  it("represents an unset cutting length with zero, without changing other blank fields to zero", () => {
    expect(render(null, PRODUCT_SELECT_VALUES.cuttingLength, true)).toContain('<option value="0" selected="">0 — غير محدد</option>');
    expect(render(null, PRODUCT_SELECT_VALUES.facing)).toContain('<option value="" selected="">غير محدد</option>');
  });
});