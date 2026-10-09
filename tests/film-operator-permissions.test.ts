import { describe, expect, it, jest } from "@jest/globals";
import { ProductionExecutionService } from "../server/production/execution";
import { availableProductionViews } from "../client/src/lib/production-navigation";
import { hasProductionPermission, type ProductionUser } from "../shared/production";

const filmOperator: ProductionUser = {
  id: 7, role_name: "Extruder Operator", role_name_ar: "مشغل فيلم",
  permissions: ["view_home", "view_user_dashboard", "view_film_dashboard", "view_mixing", "view_production", "operate_film"],
};
const request = { request_id: "e67471a0-b01c-4d05-8f23-50814d850032" };

describe("full film operator authority without other stage grants", () => {
  it("enables film operation and only the film tab", () => {
    expect(hasProductionPermission(filmOperator, "operate_film")).toBe(true);
    expect(availableProductionViews(filmOperator).map(tab => tab.view)).toEqual(["film"]);
    for (const key of ["admin", "manage_production", "operate_printing", "operate_cutting", "receive_production"]) {
      expect(hasProductionPermission(filmOperator, key)).toBe(false);
    }
  });
  it("authorizes start, recording a roll and final-film closure before reaching storage", async () => {
    // Deliberately stop at storage: no actual production data is written.
    const storageBoundary = new Error("isolated test storage boundary");
    const connect = jest.fn(async () => { throw storageBoundary; });
    const service = new ProductionExecutionService({ connect });
    await expect(service.start(filmOperator, 1, request)).rejects.toBe(storageBoundary);
    await expect(service.film(filmOperator, 1, {
      ...request, machine_id: "F1", weight_kg: "125.00", is_last_roll: true, inline_printed: false,
    })).rejects.toBe(storageBoundary);
    await expect(service.closeFilm(filmOperator, 1, request)).rejects.toBe(storageBoundary);
    expect(connect).toHaveBeenCalledTimes(3);
  });
  it("still rejects independent printing and cutting before any storage access", () => {
    const connect = jest.fn(async () => { throw new Error("must not access storage"); });
    const service = new ProductionExecutionService({ connect });
    expect(() => service.print(filmOperator, 1, { ...request, machine_id: "P1" })).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => service.cut(filmOperator, 1, { ...request, machine_id: "C1", net_weight_kg: "100" })).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(["printing", "cutting"] as const)("grants full %s operation, but not other stages", async stage => {
    const actor: ProductionUser = {
      id: 8, role_name: stage === "printing" ? "Printing Operator" : "Cutting Operator",
      permissions: ["view_home", "view_user_dashboard", `view_${stage}_dashboard`, `operate_${stage}`],
    };
    const storageBoundary = new Error("isolated test storage boundary");
    const connect = jest.fn(async () => { throw storageBoundary; });
    const service = new ProductionExecutionService({ connect });
    expect(availableProductionViews(actor).map(tab => tab.view)).toEqual([stage]);
    const ownAction = stage === "printing"
      ? service.print(actor, 1, { ...request, machine_id: "P1" })
      : service.cut(actor, 1, { ...request, machine_id: "C1", net_weight_kg: "100" });
    await expect(ownAction).rejects.toBe(storageBoundary);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(() => service.start(actor, 1, request)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => service.film(actor, 1, { ...request, machine_id: "F1", weight_kg: "100", is_last_roll: true, inline_printed: false }))
      .toThrow(expect.objectContaining({ status: 403 }));
    if (stage === "printing") {
      expect(() => service.cut(actor, 1, { ...request, machine_id: "C1", net_weight_kg: "100" })).toThrow(expect.objectContaining({ status: 403 }));
    } else {
      expect(() => service.print(actor, 1, { ...request, machine_id: "P1" })).toThrow(expect.objectContaining({ status: 403 }));
    }
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
