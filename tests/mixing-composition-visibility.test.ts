import { describe, expect, it } from "@jest/globals";
import { canRecordMixing, canViewMixing, canViewSavedMixingComposition } from "../shared/raw-mixing";
import type { ProductionUser } from "../shared/production";

describe("saved mixing composition presentation", () => {
  it("hides composition from film operators without removing work or history access", () => {
    const user = { id: 7, permissions: ["operate_film", "view_mixing"] };
    expect(canViewSavedMixingComposition(user)).toBe(false);
    expect(canViewMixing(user)).toBe(true);
    expect(canRecordMixing(user)).toBe(true);
  });
  it("respects explicit film-role binding and does not infer admin from identity", () => {
    const user: ProductionUser = {
      id: 10, permissions: ["view_mixing"], production_role_binding: { mode: "operator", stages: ["film"] },
    };
    expect(canViewSavedMixingComposition(user)).toBe(false);
    expect(canViewMixing(user)).toBe(true);
    expect(canRecordMixing(user)).toBe(false);
  });
  it.each([["admin"], ["manage_production", "operate_film"], ["manage_mixing"], ["view_mixing"]])(
    "preserves composition for non-film-operator grants %j", (...permissions) => {
      expect(canViewSavedMixingComposition({ id: 7, permissions })).toBe(true);
    },
  );
  it("applies the preview's effective grants, not an original administrator's identity", () => {
    expect(canViewSavedMixingComposition({ id: 10, permissions: ["operate_film"] })).toBe(false);
  });
});
