import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { machine } from "../server/production/machines";
import { ProductionError, type Connection } from "../server/production/core";
import type { ProductSnapshot, ProductionStage } from "../shared/production";
import i18n from "../client/src/i18n";
import { confirmedProductionRejection, productionApi } from "../client/src/lib/production-api";

jest.mock("../client/src/i18n", () => ({ __esModule: true, default: { language: "ar" } }));

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("operator machine rejection feedback", () => {
  it.each([
    ["film", "extruder", "ar", "عرض"],
    ["film", "extruder", "en", "Width"],
    ["printing", "printer", "ar", "سلندر الطباعة"],
    ["printing", "printer", "en", "Printing cylinder"],
    ["cutting", "cutter", "ar", "طول القص"],
    ["cutting", "cutter", "en", "Cutting length"],
  ] as const)("passes the %s rejection through to the %s operator in %s", async (stage, type, language, label) => {
    i18n.language = language;
    const product: ProductSnapshot = {
      id: 1, item_id: "ITM1", name: "Bag", name_ar: null, customer_name: null, customer_name_ar: null,
      width: stage === "film" ? "80" : "28", thickness: "16", universal_thickness: "98765",
      left_facing: null, right_facing: null, cutting_length_cm: 50, printing_cylinder: '40"',
      raw_material: "HDPE", punching: null, notes: null, front_print_colors: [], back_print_colors: [],
    };
    const tx: Connection = {
      query: async () => ({ rows: [{
        id: "M1", type, status: "active", min_width_cm: "10", max_width_cm: "75",
        min_thickness: "10", max_thickness: "20", min_cylinder_inch: "8", max_cylinder_inch: "39",
        min_length_cm: "30", max_length_cm: "40", raw_material_type: "HDPE", max_print_colors: 2,
      }] }),
      release: () => {},
    };
    let rejection: ProductionError | undefined;
    try { await machine(tx, "M1", stage as ProductionStage, product); }
    catch (cause) {
      if (!(cause instanceof ProductionError)) throw cause;
      rejection = cause;
    }
    expect(rejection).toBeDefined();
    const error = rejection!;
    globalThis.fetch = jest.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ message: error.message, message_en: error.message_en }),
      { status: error.status, headers: { "Content-Type": "application/json" } },
    ));
    const action = stage === "film"
      ? () => productionApi.film(1, { request_id: "req", machine_id: "M1", weight_kg: "10", is_last_roll: false, inline_printed: false })
      : stage === "printing" ? () => productionApi.print(1, "M1", "req")
      : () => productionApi.cut(1, "M1", "10", "req");
    await expect(action()).rejects.toMatchObject({
      status: 409, message: language === "ar" ? error.message : error.message_en,
    });
    try { await action(); }
    catch (cause) {
      expect(confirmedProductionRejection(cause)).toBe(true);
      expect((cause as Error).message).toContain(label);
      expect((cause as Error).message).not.toMatch(/universal|عالمية|98765/);
    }
  });
});
