import { describe, expect, it } from "@jest/globals";
import type { ProductionUser } from "../shared/production";
import { canRecordMixing, canViewMixing, canViewRawInventory } from "../shared/raw-mixing";
import { availableProductionViews, canOpenProductionView } from "../client/src/lib/production-navigation";
import { availableWarehouseViews, canOpenWarehouseView } from "../client/src/lib/warehouse-navigation";

const user = (...permissions: string[]): ProductionUser => ({ id:7, permissions });
describe("actual raw mixing boundaries", () => {
  it("film operators can record mixes without needing a separate legacy mixing grant", () => {
    const film=user("operate_film");
    expect(canRecordMixing(film)).toBe(true);
    expect(canViewMixing(film)).toBe(true);
    expect(availableProductionViews(film).map(v=>v.view)).toEqual(["film","mixing"]);
    expect(canViewRawInventory(film)).toBe(false);
    expect(availableWarehouseViews(film)).toEqual([]);
  });
  it.each(["operate_printing","operate_cutting","view_film_dashboard","view_production","receive_production","view_finished_inventory","manage_raw_materials"])(
    "%s is not authority to record mixes", grant => expect(canRecordMixing(user(grant))).toBe(false));
  it("mixing read permission never becomes a write or production-roll permission", () => {
    const viewer=user("view_mixing");
    expect(canViewMixing(viewer)).toBe(true);
    expect(canRecordMixing(viewer)).toBe(false);
    expect(canOpenProductionView(viewer,"roll")).toBe(false);
    expect(availableProductionViews(viewer).map(v=>v.view)).toEqual(["mixing"]);
  });
  it("explicit mixing managers can record without other stage grants", () => {
    expect(canRecordMixing(user("manage_mixing"))).toBe(true);
    expect(canViewRawInventory(user("manage_mixing"))).toBe(false);
  });
  it("an operator binding still controls the film-derived mixing grant", () => {
    const printer:ProductionUser={...user("operate_film","operate_printing"),production_role_binding:{mode:"operator",stages:["printing"]}};
    expect(canRecordMixing(printer)).toBe(false);
    expect(canOpenProductionView(printer,"mixing")).toBe(false);
    expect(canRecordMixing({...printer,permissions:[...printer.permissions,"manage_mixing"]})).toBe(true);
  });
  it("raw inventory authority does not leak finished inventory or private roll access", () => {
    for (const grant of ["view_raw_inventory","manage_raw_materials"]) {
      const account=user(grant);
      expect(canViewRawInventory(account)).toBe(true);
      expect(availableWarehouseViews(account).map(v=>v.view)).toEqual(["raw"]);
      expect(canOpenWarehouseView(account,"roll")).toBe(false);
      expect(canOpenWarehouseView(account,"warehouse")).toBe(false);
      expect(canOpenProductionView(account,"roll")).toBe(false);
    }
  });
  it("administrator can use both modules; wildcard and role labels grant nothing", () => {
    expect(canRecordMixing(user("admin"))).toBe(true);
    expect(canViewRawInventory(user("admin"))).toBe(true);
    expect(canRecordMixing({...user("*"),role_name:"Administrator"})).toBe(false);
  });
});
