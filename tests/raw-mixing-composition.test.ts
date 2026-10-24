import { describe, expect, it } from "@jest/globals";
import { mixingComposition } from "../client/src/lib/raw-mixing-composition";
const line = (material_id: number, quantity_kg: string) => ({ material_id, quantity_kg, name: "Resin", name_ar: "خام" });
const calculate = (lines: ReturnType<typeof line>[]) => mixingComposition(lines, (ar,en) => `${ar} / ${en}`);
describe("latest-mix weight composition", () => {
  it("merges repeated materials using kilograms, not average percentages or ABA ratios", () => {
    const result = calculate([line(1,"9"),line(2,"1"),line(1,"2"),line(2,"18")]);
    expect(result.total).toBe(30);
    expect(result.rows.map(r=>[r.key,r.kg])).toEqual([[1,11],[2,19]]);
    expect(result.rows[0].percent).toBeCloseTo(36.6666666667,9);
    expect(result.rows[1].percent).toBeCloseTo(63.3333333333,9);
  });
  it("single-screw and partial totals use only available mix", () => {
    expect(calculate([line(1,"9"),line(2,"1")]).rows.map(r=>r.percent)).toEqual([90,10]);
    expect(calculate([])).toEqual({total:null,rows:[]});
  });
  it("draft substitution leaves the other screw unchanged", () => {
    const result = calculate([line(1,"10"),line(1,"2"),line(2,"18")]);
    expect(result.rows.map(r=>r.percent)).toEqual([40,60]);
  });
  it.each(["","0","-1","NaN","Infinity","1.234","2e3"])("invalid weight %s invalidates the whole summary", quantity => {
    expect(calculate([line(1,"5"),line(2,quantity)])).toEqual({total:null,rows:[]});
  });
  it("retains decimal precision before display and bilingual labels", () => {
    const result=calculate([line(1,"0.10"),line(1,"0.20"),line(2,"0.70")]);
    expect(result.total).toBe(1);
    expect(result.rows[0]).toEqual({key:1,name:"خام / Resin",kg:0.3,percent:30});
  });
});
