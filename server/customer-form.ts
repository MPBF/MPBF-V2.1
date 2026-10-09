import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { insertCustomerSchema, roles, users } from "@shared/schema";

export const customerFormSchema = insertCustomerSchema.omit({ id: true }).extend({
  name: z.string().trim().min(1, "الاسم بالإنجليزية مطلوب").max(200),
  name_ar: z.string().trim().max(200).nullable().optional(),
  sales_rep_id: z.number().int().positive().nullable().optional(),
}).strict();

// Identify the business role by its name, not a deployment-specific role ID.
export const salesRepresentativeRoleCondition = or(
  inArray(sql<string>`lower(trim(regexp_replace(${roles.name}, '[_-]+', ' ', 'g')))`,
    ["sales representative", "sales rep"]),
  inArray(roles.name_ar, ["مندوب مبيعات", "مندوب"]),
)!;

export async function validateCustomerSalesRepresentative(tx: any, id: number | null | undefined) {
  if (id == null) return;
  const [representative] = await tx.select({ id: users.id }).from(users)
    .innerJoin(roles, eq(users.role_id, roles.id))
    .where(and(eq(users.id, id), salesRepresentativeRoleCondition))
    .for("share").limit(1);
  if (!representative) {
    throw Object.assign(new Error("المندوب المحدد غير موجود أو ليس مندوب مبيعات"), { status: 400 });
  }
}

/** Continue the existing CID001 series, keeping legacy padding as it grows. */
export function nextCustomerId(lastNumber: string | null, suffixWidth: number | null): string {
  if (lastNumber !== null && !/^\d+$/.test(lastNumber)) {
    throw new Error("آخر رمز عميل غير صالح");
  }
  const number = (BigInt(lastNumber ?? "0") + 1n).toString();
  const width = Math.max(3, suffixWidth ?? 3);
  if (Math.max(number.length, width) > 17) {
    throw new Error("تعذر إنشاء رمز عميل جديد: بلغ التسلسل الحد الأقصى");
  }
  return `CID${number.padStart(width, "0")}`;
}