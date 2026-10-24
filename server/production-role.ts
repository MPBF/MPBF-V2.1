import { eq } from "drizzle-orm";
import { db } from "./db";
import { roles, system_settings } from "../shared/schema";
import { initialProductionRoleBinding, productionRoleBindingSchema, type ProductionRoleBinding } from "../shared/production-role";

export const productionRoleSettingPrefix = "production_role_binding:";
const settingKey = (id: number) => `${productionRoleSettingPrefix}${id}`;
type Connection = Pick<typeof db, "select" | "insert">;
type Role = typeof roles.$inferSelect;

// Call while holding the role row lock, so a concurrent rename cannot initialize
// from the new display name. The unique setting key also prevents duplicates.
export async function ensureProductionRoleBinding(connection: Connection, role: Role): Promise<ProductionRoleBinding> {
  const [saved] = await connection.select().from(system_settings).where(eq(system_settings.setting_key, settingKey(role.id))).limit(1);
  if (saved) return productionRoleBindingSchema.parse(JSON.parse(saved.setting_value ?? "null"));
  const binding = initialProductionRoleBinding(role);
  await connection.insert(system_settings).values({
    setting_key: settingKey(role.id), setting_value: JSON.stringify(binding),
    setting_type: "json", is_editable: false,
  }).onConflictDoNothing({ target: system_settings.setting_key });
  const [persisted] = await connection.select().from(system_settings).where(eq(system_settings.setting_key, settingKey(role.id))).limit(1);
  return productionRoleBindingSchema.parse(JSON.parse(persisted.setting_value ?? "null"));
}

export async function resolveProductionRoleBinding(roleId: number): Promise<ProductionRoleBinding> {
  const [saved] = await db.select().from(system_settings).where(eq(system_settings.setting_key, settingKey(roleId))).limit(1);
  if (saved) return productionRoleBindingSchema.parse(JSON.parse(saved.setting_value ?? "null"));
  return db.transaction(async tx => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).for("update").limit(1);
    if (!role) return { mode: "operator", stages: [] };
    return ensureProductionRoleBinding(tx, role);
  });
}

export async function saveProductionRoleBinding(connection: Connection, roleId: number, binding: ProductionRoleBinding) {
  await connection.insert(system_settings).values({
    setting_key: settingKey(roleId), setting_value: JSON.stringify(binding),
    setting_type: "json", is_editable: false,
  }).onConflictDoUpdate({
    target: system_settings.setting_key,
    set: { setting_value: JSON.stringify(binding), is_editable: false, updated_at: new Date() },
  });
}
