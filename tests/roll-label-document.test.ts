import { describe, expect, it } from "@jest/globals";
import type { ProductSnapshot } from "../shared/production";
import type { ProductionRollLabel } from "../client/src/lib/production-api";
import { buildRollLabelDocument } from "../client/src/pages/production/roll-label-document";

function fixture(overrides: Partial<ProductSnapshot> = {}, rollOverrides: Partial<ProductionRollLabel["roll"]> = {}): ProductionRollLabel {
  return {
    roll: {
      id: 7, production_order_id: 9, roll_number: "ROLL-77", production_order_number: "DO-NOT-PRINT-ORDER",
      weight_kg: "25.50", waste_kg: "0", stage: "done", film_machine_id: "F1", created_by: 1,
      created_at: "2026-10-16T06:00:00Z", production_minutes: null, is_last_roll: true,
      printing_machine_id: null, printed_by: null, printed_at: null,
      cutting_machine_id: null, cut_by: null, cut_completed_at: null, net_weight_kg: null,
      is_printed: false, is_roll_product: false, batch_number: "BATCH-7",
      product: {
        id: 11, item_id: "ITM11", name: "Film bag", name_ar: "كيس بلاستيك",
        customer_name: "Fixture Customer", customer_name_ar: "عميل تجريبي", size_caption: "40 × 60 cm",
        width: "40", left_facing: "5", right_facing: "5", universal_thickness: "30",
        cutting_length_cm: 60, raw_material: null, printing_cylinder: null, punching: null,
        notes: null, front_print_colors: null, back_print_colors: null, ...overrides,
      },
      ...rollOverrides,
    },
    qr: { url: "/production/rolls/7", image: "data:image/png;base64,AAAA" },
  };
}

const field = (html: string, className: string) =>
  html.match(new RegExp(`<strong class="${className}"[^>]*>([\\s\\S]*?)</strong>`))?.[1];

const actor = (id: number, username: string | null) => ({
  id, username, display_name: "Display name", display_name_ar: "اسم العرض", full_name: "Full name",
});
const stageRow = (html: string, stage: string) =>
  html.match(new RegExp(`<[^>]+class="[^"]*stage-actor-${stage}[^"]*"[^>]*>([\\s\\S]*?)</(?:div|p|li)>`))?.[1] ?? "";

describe("roll label stage usernames", () => {
  it.each(["ar", "en"] as const)("uses the account that recorded each stage, below weight (%s)", language => {
    const html = buildRollLabelDocument([fixture({}, {
      created_by: 11, created_actor: actor(11, "film.operator"),
      printed_by: 22, printed_actor: actor(22, "print.operator"),
      cut_by: 33, cut_actor: actor(33, "cut.operator"),
    })], language);
    expect(stageRow(html, "film")).toContain("film.operator");
    expect(stageRow(html, "printing")).toContain("print.operator");
    expect(stageRow(html, "cutting")).toContain("cut.operator");
    expect(html.indexOf('class="field weight"')).toBeLessThan(html.indexOf('class="stage-actors'));
    expect(html.indexOf('class="stage-actors')).toBeLessThan(html.indexOf('class="field batch"'));
    for (const text of language === "ar" ? ["فيلم", "طباعة", "تقطيع"] : ["Film", "Printing", "Cutting"])
      expect(html).toContain(text);
  });
  it("does not invent a user for an unrecorded stage", () => {
    const html = buildRollLabelDocument([fixture({}, {
      printed_by: null, printed_actor: actor(22, "do-not-show"),
      cut_by: null, cut_actor: null,
    })], "ar");
    expect(stageRow(html, "printing")).toContain("—");
    expect(stageRow(html, "printing")).not.toContain("do-not-show");
    expect(stageRow(html, "cutting")).toContain("—");
  });
  it("uses existing localized names when an old account has no username", () => {
    const label = fixture({}, { created_actor: actor(1, null) });
    expect(stageRow(buildRollLabelDocument([label], "ar"), "film")).toContain("اسم العرض");
    expect(stageRow(buildRollLabelDocument([label], "en"), "film")).toContain("Display name");
  });
  it("escapes stage usernames before inserting them into the document", () => {
    const html = buildRollLabelDocument([fixture({}, {
      created_actor: actor(1, '<img src=x onerror="evil()">'),
    })], "ar");
    expect(stageRow(html, "film")).toContain("&lt;img");
    expect(html).not.toContain('<img src=x onerror="evil()">');
  });
});

describe("roll label customer and product identity", () => {
  it.each(["ar", "en"] as const)("prints bilingual customer names in the requested order (%s)", language => {
    const html = buildRollLabelDocument([fixture()], language);
    expect(field(html, "customer-name-ar")).toBe("عميل تجريبي");
    expect(field(html, "customer-name-en")).toBe("Fixture Customer");
    expect(html.indexOf("عميل تجريبي")).toBeLessThan(html.indexOf("Fixture Customer"));
    expect(html.indexOf("Fixture Customer")).toBeLessThan(html.indexOf('class="item-size"'));
    expect(html).toContain('class="customer-name-ar" dir="rtl"');
    expect(html).toContain('class="customer-name-en" dir="ltr"');
    expect(field(html, "item-size")).toBe(`${language === "ar" ? "كيس بلاستيك" : "Film bag"} — 40 × 60 cm`);
    expect(html).not.toContain("DO-NOT-PRINT-ORDER");
    expect(html).not.toContain('class="field order');
  });

  it("keeps the original roll, weight, batch, QR and physical page size", () => {
    const html = buildRollLabelDocument([fixture()], "ar");
    for (const value of ["ROLL-77", "25.5", "BATCH-7", "data:image/png;base64,AAAA", "size: 4in 6in"])
      expect(html).toContain(value);
    expect((html.match(/<article /g) ?? []).length).toBe(1);
  });

  it.each([null, "", "اسم عربي في الحقل الإنجليزي"])("does not substitute Arabic into a missing English customer name (%s)", customer_name => {
    expect(field(buildRollLabelDocument([fixture({ customer_name })], "ar"), "customer-name-en")).toBe("—");
  });

  it("escapes customer, item and size values rather than executing markup", () => {
    const html = buildRollLabelDocument([fixture({
      customer_name_ar: "عميل <img src=x onerror=alert(1)>",
      customer_name: "Customer <script>alert(1)</script>",
      name_ar: "صنف <svg onload=alert(1)>", size_caption: '40"><script>alert(1)</script>',
    })], "ar");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<img src=x");
    expect(field(html, "customer-name-en")).toContain("&lt;script&gt;");
    expect(field(html, "item-size")).toContain("&lt;svg");
  });

  it("uses the existing size description rules when the stored caption is absent", () => {
    expect(field(buildRollLabelDocument([fixture({ size_caption: null })], "en"), "item-size"))
      .toBe("Film bag — 40 + 5 + 5 cm");
  });
});
