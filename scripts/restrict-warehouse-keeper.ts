import { eq, or } from "drizzle-orm";
import { db, pool, sessionPool } from "../server/db";
import { roles } from "../shared/schema";
import { warehouseKeeperPermissions } from "../shared/warehouse-access";

if (process.env.NODE_ENV === "production") throw new Error("Development-only role update; production requires separate approval.");
try {
  await db.transaction(async tx => {
    const matches = await tx.select().from(roles).where(or(
      eq(roles.name, "Warehouse Keeper"), eq(roles.name_ar, "أمين المستودع"),
    )).for("update");
    if (matches.length !== 1) throw new Error("Expected exactly one warehouse keeper role; no changes applied.");
    const role = matches[0];
    if (role.permissions?.includes("admin")) throw new Error("Refusing to modify an administrator role.");
    const permissions = warehouseKeeperPermissions(role.permissions ?? []);
    await tx.update(roles).set({ permissions }).where(eq(roles.id, role.id));
    console.log(JSON.stringify({ role_id: role.id, permissions }));
  });
} finally {
  await pool.end();
  await sessionPool.end();
}
