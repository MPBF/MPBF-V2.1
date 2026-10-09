import { describe, expect, it } from "@jest/globals";
import { productionActorName } from "../client/src/lib/production-actors";
import type { ProductionActor } from "../shared/production";

const actor = (changes: Partial<ProductionActor> = {}): ProductionActor => ({
  id: 5, display_name: "Display Name", display_name_ar: "الاسم العربي",
  full_name: "Full Name", username: "operator", ...changes,
});

describe("production actor names", () => {
  it("uses Arabic display name before full name", () => {
    expect(productionActorName(actor(), 5, "ar")).toBe("الاسم العربي");
  });
  it("trims names and skips blank Arabic display names", () => {
    expect(productionActorName(actor({ display_name_ar: "  ", full_name: " Full Name " }), 5, "ar")).toBe("Full Name");
  });
  it("uses English display name before full name", () => {
    expect(productionActorName(actor(), 5, "en")).toBe("Display Name");
  });
  it("rejects Arabic text in every English fallback", () => {
    expect(productionActorName(actor({ display_name: "اسم", full_name: "Full Name", username: "operator" }), 5, "en")).toBe("Full Name");
    expect(productionActorName(actor({ display_name: "اسم", full_name: "اسم كامل", username: " operator " }), 5, "en")).toBe("operator");
    expect(productionActorName(actor({ display_name: "Name اسم", full_name: "اسم", username: "عامل" }), 5, "en")).toBe("#5");
  });
  it.each(["ar", "en"])("retains the authoritative ID if no identity is found (%s)", language => {
    expect(productionActorName(null, 5, language)).toBe("#5");
    expect(productionActorName(undefined, 5, language)).toBe("#5");
    expect(productionActorName(actor({ display_name: "", display_name_ar: "", full_name: " ", username: null }), 5, language)).toBe("#5");
  });
  it("never guesses an unrecorded actor from a name", () => {
    expect(productionActorName(actor(), null, "ar")).toBe("غير مسجل");
    expect(productionActorName(actor(), null, "en")).toBe("Not recorded");
  });
  it("preserves username fallback without exposing extra fields", () => {
    expect(productionActorName(actor({ display_name_ar: null, full_name: null, display_name: null }), 5, "ar")).toBe("operator");
  });
});
