import { z } from "zod";

// Presentation metadata only: this never grants read or write permissions.
export const productionRoleBindingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("general"), stages: z.array(z.enum(["film", "printing", "cutting"])).max(0) }).strict(),
  z.object({ mode: z.literal("operator"), stages: z.array(z.enum(["film", "printing", "cutting"])).max(3)
    .refine(stages => new Set(stages).size === stages.length, "Duplicate stages") }).strict(),
]);
export type ProductionRoleBinding = z.infer<typeof productionRoleBindingSchema>;

/** One-time conversion for existing roles, never used by client navigation. */
export function initialProductionRoleBinding(role: {
  name?: string | null; name_ar?: string | null; permissions?: string[] | null;
}): ProductionRoleBinding {
  const grants = role.permissions ?? [];
  if (grants.includes("admin") || grants.includes("manage_production")) return { mode: "general", stages: [] };
  const stages = (["film", "printing", "cutting"] as const).filter(stage => grants.includes(`operate_${stage}`));
  if (stages.length) return { mode: "operator", stages };
  const names = [role.name, role.name_ar].map(name =>
    (name ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "));
  const patterns = {
    film: /^(extruder operator|film operator|مشغل (ال)?فيلم)$/,
    printing: /^(printing operator|مشغل (ال)?طباعة)$/,
    cutting: /^(cutting operator|مشغل (ال)?تقطيع|مشغل (ال)?قص)$/,
  };
  const legacy = (["film", "printing", "cutting"] as const).filter(stage => names.some(name => patterns[stage].test(name)));
  return legacy.length ? { mode: "operator", stages: legacy } : { mode: "general", stages: [] };
}
