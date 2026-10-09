import { eq } from "drizzle-orm";
import { categories, customer_products, insertCategorySchema } from "../shared/schema";
import { plannedFinalQuantity } from "./audit-rules";
import type { db } from "./db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Snapshot the product category's percentage only when creating a new order.
 * Existing orders retain their saved percentage, even if their category changes.
 */
export async function categoryProductionPlan(
  tx: Pick<Transaction, "select">,
  productId: number | null | undefined,
  quantityKg: string,
): Promise<{ overrun_percentage: string; final_quantity_kg: string }> {
  let percentage = 0;
  if (productId != null) {
    const [product] = await tx.select({ category_id: customer_products.category_id })
      .from(customer_products).where(eq(customer_products.id, productId)).limit(1);
    if (!product) throw Object.assign(new Error("المنتج المحدد غير موجود"), { status: 400 });
    if (product.category_id != null) {
      const [category] = await tx.select({ overrun_percentage: categories.overrun_percentage })
        .from(categories).where(eq(categories.id, product.category_id)).limit(1);
      if (!category) throw Object.assign(new Error("تصنيف المنتج غير موجود"), { status: 400 });
      percentage = insertCategorySchema.shape.overrun_percentage.unwrap().parse(category.overrun_percentage);
    }
  }
  const finalQuantity = plannedFinalQuantity(quantityKg, String(percentage));
  if (!/^\d{1,8}\.\d{2}$/.test(finalQuantity) || Number(finalQuantity) <= 0) {
    throw Object.assign(new Error("الكمية النهائية تتجاوز الحد المسموح"), { status: 400 });
  }
  return {
    overrun_percentage: String(percentage),
    final_quantity_kg: finalQuantity,
  };
}