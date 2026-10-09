import { describe, expect, it } from "@jest/globals";
import { groupStageRolls, stageOperationSpecs, stageRollWeight } from "../client/src/lib/stage-operation-specs";
import type { ProductSnapshot, ProductionOrderRecord, ProductionRollRecord } from "../shared/production";

const product: ProductSnapshot = {
  id: 1, item_id: "ITM1", name: "Bag", name_ar: "كيس", customer_name: "Customer", customer_name_ar: "عميل",
  width: "21", left_facing: null, right_facing: null, universal_thickness: "60", cutting_length_cm: 30.25,
  raw_material: "HDPE", printing_cylinder: "16.5", punching: "بنانة", notes: null,
  front_print_colors: ["Red", "أزرق", "#12ABEF"], back_print_colors: [],
  size_caption: "21X30",
  plate_drawer_code: "D-12",
};
const order = (id: number, parent: number): ProductionOrderRecord => ({
  id, order_id: parent, order_number: `O0000${parent}`, production_order_number: `O0000${parent}-JO0${id}`,
  customer_product_id: 1, quantity_kg: "100", final_quantity_kg: "110", status: "active", order_status: "in_production",
  batch_number: null, product, started_at: "2026-10-01T00:00:00Z", film_closed_at: null, completed_at: null,
  is_printed: true, is_roll_product: false, stage: "film", produced_kg: "10", ready_kg: "0",
  received_kg: "0", remaining_kg: "0", waste_kg: "0", roll_count: 1, film_durations: [],
});
const roll = (id: number, parent: number): ProductionRollRecord => ({
  id, production_order_id: parent, roll_number: `PO-${parent}-R${id}`, weight_kg: "10.10",
  stage: "film", film_machine_id: "F1", created_by: 1, created_at: "2026-10-01T00:00:00Z",
  production_minutes: null, is_last_roll: false, printing_machine_id: null, printed_by: null, printed_at: null,
  cutting_machine_id: null, cut_by: null, cut_completed_at: null, net_weight_kg: null, waste_kg: "0",
  production_order_number: `PO-${parent}`, product, is_printed: true, is_roll_product: false,
});

describe("stage operator specifications", () => {
  it("shows cylinder, size, drawer and populated printing colors only", () => {
    const specs = stageOperationSpecs("printing", product, "en", "Unrecorded");
    expect(specs.map(spec => spec.key)).toEqual(["cylinder", "size", "plateDrawer", "frontColors"]);
    expect(specs.map(spec => spec.value)).toEqual(["16.5", "21X30", "D-12", "Red / Blue / #12ABEF"]);
    expect(stageOperationSpecs("printing", product, "ar", "غير مسجل").slice(0,3).map(spec=>spec.label))
      .toEqual(["السلندر", "المقاس", "درج الكليشة"]);
  });
  it("reads inch-marked database cylinders without changing saved data", () => {
    for (const cylinder of ['18"', "18″", "18 in", "١٨\"", "۱۸″"]) {
      const saved = {...product, printing_cylinder: cylinder};
      expect(stageOperationSpecs("printing", saved, "ar", "Missing")[0].value).toBe("18");
      expect(stageOperationSpecs("printing", saved, "en", "Missing")[0].value).toBe("18");
      expect(saved.printing_cylinder).toBe(cylinder);
    }
    expect(stageOperationSpecs("printing", {...product, printing_cylinder:'16.5"'}, "en", "Missing")[0].value).toBe("16.5");
    expect(stageOperationSpecs("printing", {...product, printing_cylinder:"بدون طباعة"}, "en", "Missing")[0].value).toBe("No printing");
  });
  it("hides missing, empty and whitespace-only colors independently", () => {
    for (const language of ["ar", "en"]) {
      for (const values of [null, [], ["", "  "]]) {
        const specs = stageOperationSpecs("printing", {...product, front_print_colors: values, back_print_colors: values}, language, "Missing");
        expect(specs.map(spec=>spec.key)).toEqual(["cylinder", "size", "plateDrawer"]);
      }
      const specs = stageOperationSpecs("printing", {...product, front_print_colors: [], back_print_colors: [" ", "Blue", ""]}, language, "Missing");
      expect(specs.map(spec=>spec.key)).toEqual(["cylinder", "size", "plateDrawer", "backColors"]);
      expect(specs[3].value).toBe(language==="en" ? "Blue" : "أزرق");
    }
  });
  it("shows cutting length, punching and material with exact machine settings", () => {
    const specs = stageOperationSpecs("cutting", product, "ar", "غير مسجل");
    expect(specs.map(spec => spec.key)).toEqual(["size", "cutLength", "punching", "material"]);
    expect(specs.map(spec => spec.value)).toEqual(["21X30", "30.25 سم", "بنانة", "HDPE"]);
    expect(stageOperationSpecs("cutting", product, "en", "Unrecorded")[2].value).toBe("Banana");
  });
  it("does not guess absent fields or mix Arabic into English fallbacks", () => {
    expect(stageOperationSpecs("printing", null, "en", "Unrecorded").every(spec => spec.value === "Unrecorded")).toBe(true);
    const unknown = { ...product, raw_material: "خامة خاصة", punching: "نوع خاص", front_print_colors: ["لون خاص"] };
    expect(stageOperationSpecs("printing", unknown, "en", "Unrecorded").find(spec=>spec.key==="frontColors")?.value).toBe("Unrecorded");
    expect(stageOperationSpecs("cutting", unknown, "en", "Unrecorded").slice(2).map(spec => spec.value)).toEqual(["Unrecorded", "Unrecorded"]);
    expect(stageOperationSpecs("printing", { ...product, printing_cylinder: "" }, "en", "Unrecorded")[0].value).toBe("Unrecorded");
  });
});

describe("stage roll work grouping", () => {
  const orders = [order(1, 1), order(2, 1), order(3, 2)];
  const rolls = [roll(4, 3), roll(2, 2), roll(1, 1), roll(3, 2)];
  it("groups customer orders and child rolls while preserving machine queue priority", () => {
    const groups = groupStageRolls(orders, rolls, "en", "", "Unrecorded");
    expect(groups.map(group => group.orderId)).toEqual([2, 1]);
    expect(groups[1].members.map(member => member.order.id)).toEqual([2, 1]);
    expect(groups[1].members[0].rolls.map(roll => roll.id)).toEqual([2, 3]);
    expect(rolls.map(roll => roll.id)).toEqual([4, 2, 1, 3]);
  });
  it("searches customer, customer order, production order and Arabic/Persian roll digits", () => {
    expect(groupStageRolls(orders, rolls, "ar", "عميل", "غير مسجل")).toHaveLength(2);
    const byOrder = groupStageRolls(orders, rolls, "en", "o00001", "Unrecorded");
    expect(byOrder).toHaveLength(1);
    expect(byOrder[0].members).toHaveLength(2);
    expect(groupStageRolls(orders, rolls, "en", "O00001-JO02", "Unrecorded")[0].members[0].rolls).toHaveLength(2);
    const byRoll = groupStageRolls(orders, rolls, "ar", "PO-٢-R۳", "غير مسجل");
    expect(byRoll[0].members[0].rolls.map(roll => roll.id)).toEqual([3]);
    expect(groupStageRolls(orders, rolls, "en", "nothing", "Unrecorded")).toEqual([]);
  });
  it("never introduces rolls outside the eligible feed or invents orphan parent groups", () => {
    expect(groupStageRolls(orders, [], "en", "", "Unrecorded")).toEqual([]);
    expect(groupStageRolls(orders, [roll(99, 999)], "en", "", "Unrecorded")).toEqual([]);
    expect(groupStageRolls(orders, [roll(2, 2)], "en", "", "Unrecorded")[0].members.map(member => member.order.id)).toEqual([2]);
  });
  it("uses frozen roll customer data and does not expose Arabic customer names in English", () => {
    const unknown = { ...rolls[0], product: { ...product, customer_name: "عميل", customer_name_ar: "عميل" } };
    expect(groupStageRolls(orders, [unknown], "en", "", "Unrecorded")[0].customerName).toBe("Unrecorded");
  });
  it("sums available roll weights exactly without rounding or fabricating invalid values", () => {
    expect(stageRollWeight([{ weight_kg: "0.10" }, { weight_kg: "0.20" }])).toBe("0.30");
    expect(stageRollWeight([{ weight_kg: "12.34" }, { weight_kg: "0.01" }])).toBe("12.35");
    expect(stageRollWeight([{ weight_kg: "bad" }])).toBeNull();
    expect(stageRollWeight([])).toBe("0.00");
  });
});
