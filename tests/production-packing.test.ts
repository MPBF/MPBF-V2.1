import { describe, expect, it } from "@jest/globals";
import { calculatePacking, PackingError, type ReceiptPacking } from "../shared/production-packing";

describe("server-authoritative unit packing conversion", () => {
  it.each([
    [{unit:"kg",method:"unit_weight",quantity:"12.34"}, "12.34", "12.34"],
    [{unit:"packet",method:"unit_weight",quantity:"5",unit_weight_kg:"20"}, "100.00", "5"],
    [{unit:"roll",method:"piece_weight",quantity:"10",pieces_per_unit:20,piece_weight_grams:"500"}, "100.00", "10"],
    [{unit:"piece",method:"unit_weight",quantity:"200",unit_weight_kg:"0.005"}, "1.00", "200"],
    [{unit:"piece",method:"piece_weight",quantity:"1",pieces_per_unit:1,piece_weight_grams:"5"}, "0.01", "1"],
    [{unit:"packet",method:"unit_weight",quantity:"3",unit_weight_kg:"0.333333"}, "1.00", "3"],
  ])("calculates exact count and kilogram equivalent", (packing, weight, count) => {
    const result = calculatePacking(packing as ReceiptPacking);
    expect(result.quantity_kg).toBe(weight);
    expect(result.unit_quantity).toBe(count);
  });
  it("groups equivalent specifications but never different weights or units", () => {
    const packet: ReceiptPacking={unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"20"};
    const first=calculatePacking(packet);
    expect(calculatePacking({...packet,quantity:"05",unit_weight_kg:"020.000000"}).packing_key).toBe(first.packing_key);
    expect(calculatePacking({...packet,unit_weight_kg:"10"}).packing_key).not.toBe(first.packing_key);
    expect(calculatePacking({...packet,unit:"roll"}).packing_key).not.toBe(first.packing_key);
  });
  it.each([
    {unit:"box",method:"unit_weight",quantity:"1",unit_weight_kg:"1"},
    {unit:"kg",method:"piece_weight",quantity:"1",pieces_per_unit:1,piece_weight_grams:"1000"},
    {unit:"kg",method:"unit_weight",quantity:"1",unit_weight_kg:"2"},
    {unit:"piece",method:"unit_weight",quantity:"1.5",unit_weight_kg:"1"},
    {unit:"packet",method:"unit_weight",quantity:"0",unit_weight_kg:"1"},
    {unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"0"},
    {unit:"roll",method:"piece_weight",quantity:"1",pieces_per_unit:0,piece_weight_grams:"10"},
    {unit:"roll",method:"piece_weight",quantity:"1",pieces_per_unit:1.5,piece_weight_grams:"10"},
    {unit:"roll",method:"piece_weight",quantity:"1",pieces_per_unit:1,piece_weight_grams:"0"},
    {unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"0.000001"},
    {unit:"packet",method:"unit_weight",quantity:"999999999999",unit_weight_kg:"99999999"},
    {unit:"packet",method:"unit_weight",quantity:"1",unit_weight_kg:"1",pieces_per_unit:1},
    {unit:"packet",method:"piece_weight",quantity:"1",unit_weight_kg:"1",pieces_per_unit:1,piece_weight_grams:"1"},
    {unit:"packet",method:"unit_weight",quantity:"NaN",unit_weight_kg:"1"},
  ])("rejects invalid or ambiguous packing explicitly", packing => {
    expect(()=>calculatePacking(packing as ReceiptPacking)).toThrow(PackingError);
  });
});
